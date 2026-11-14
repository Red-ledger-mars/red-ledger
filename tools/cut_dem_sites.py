"""Cut the elevation windows needed to compute how much sky the terrain blocks
(terrain shielding of radiation) at five Curiosity RAD validation sites and
over the walk area.

Source: MSL Gale Merged DEM, 1 m, version 3 (Parker and Calef), USGS
Astrogeology. Read from the companion ".ovr" file with HTTP range requests:
every overview level in that file is uncompressed little-endian Float32 in
128 x 128 tiles (header read on 14 Nov 2026), so the standard library can
read it directly.

For each place this writes:
  - a near window from the 4 m level, at least 1.6 km past the point (or past
    the walk-area crop) in every direction;
and once, shared by all places:
  - a far window from the 32 m level, covering every place plus 20 km, clipped
    to the edge of the DEM. The DEM is only about 33 km wide (east-west), so
    20 km is not reached to the east and west; the JSON says where it ends.

Storage: uint16 little-endian, row-major from the north-west corner,
metres = base_m + value * scale_m, 65535 = no data. scale_m is 0.01 (cm) for
the near windows, as in data/dem_boxwork_4m.bin, or the next coarser step
(0.02 m, ...) when a window spans more than 655 m of height; the far window
uses 0.1 m.

Credit: NASA/JPL-Caltech/University of Arizona/USGS
Usage: python3 tools/cut_dem_sites.py   (tiles are cached under /tmp)
"""
import json
import math
import struct
import urllib.request
from array import array
from pathlib import Path

URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif.ovr"
R = 3396190.0
X0 = 8127993.4928          # left edge of the full 1 m DEM (projected metres)
Y0 = -244781.0752          # top edge
FULL_W, FULL_H = 32980, 57440   # size of the full 1 m DEM in pixels
TILE = 128
NODATA_IN = -32767.0
NODATA_OUT = 65535
CACHE = Path("/tmp/red-ledger-ovr-cache")
OUT = Path(__file__).resolve().parent.parent / "data" / "shielding"

# Overview levels in the .ovr file (read from the TIFF header, 14 Nov 2026).
# name: (width, height, tile-offset table byte position, tile count)
LEVELS = {
    "4m": (8245, 14360, 109976, 7345),
    "8m": (4123, 7180, 481508982, 1881),
    "16m": (2062, 3590, 604791876, 493),
    "32m": (1031, 1795, 637103818, 135),
    "64m": (516, 898, 645952060, 40),
    "128m": (258, 449, 648573890, 12),
    "256m": (129, 225, 649360568, 4),
}

# Validation sites: rover positions from NASA's MSL_waypoints.json, as listed
# in brief/research/2026-11-14-radiation-method.md section D. The window is
# centred on the first period of each site.
SITES = [
    {"id": "tower_buttes", "name": "Tower Buttes (P1, P2)", "lon": 137.3808990, "lat": -4.7365847},
    {"id": "bloodstone_hill", "name": "Bloodstone Hill (P3)", "lon": 137.3881905, "lat": -4.7336628},
    {"id": "mt_mercou", "name": "Mont Mercou (P4, P5)", "lon": 137.4125303, "lat": -4.7354500},
    {"id": "maria_gordon_notch", "name": "Maria Gordon Notch (P6)", "lon": 137.3943118, "lat": -4.7476563},
    {"id": "paraitepuy", "name": "Paraitepuy (P7, P8)", "lon": 137.3988594, "lat": -4.7590454},
]
NEAR_HALF_M = 1600.0
FAR_RADIUS_M = 20000.0
fetched_bytes = 0


def fetch(start, length):
    global fetched_bytes
    req = urllib.request.Request(URL, headers={
        "Range": f"bytes={start}-{start + length - 1}",
        "User-Agent": "red-ledger-spaceapps/1.0",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if len(data) != length:
        raise RuntimeError(f"wanted {length} bytes at {start}, got {len(data)}")
    fetched_bytes += length
    return data


def cached(name, start, length):
    path = CACHE / name
    if path.exists() and path.stat().st_size == length:
        return path.read_bytes()
    data = fetch(start, length)
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


class Level:
    def __init__(self, name):
        self.name = name
        self.w, self.h, table, count = LEVELS[name]
        # Overview pixel size = full extent / overview size (GDAL convention).
        self.px = FULL_W / self.w
        self.py = FULL_H / self.h
        self.tiles_per_row = math.ceil(self.w / TILE)
        self.offsets = struct.unpack(f"<{count}I", cached(f"{name}_offsets", table, 4 * count))

    def tile(self, tx, ty):
        off = self.offsets[ty * self.tiles_per_row + tx]
        t = array("f")
        t.frombytes(cached(f"{self.name}_{tx}_{ty}", off, TILE * TILE * 4))
        return t

    def prefetch(self, col0, row0, cols, rows):
        """Download the tiles of a window in parallel (8 at a time) into the cache."""
        from concurrent.futures import ThreadPoolExecutor
        c_lo, c_hi = max(col0, 0), min(col0 + cols, self.w)
        r_lo, r_hi = max(row0, 0), min(row0 + rows, self.h)
        jobs = [(tx, ty) for ty in range(r_lo // TILE, (r_hi - 1) // TILE + 1)
                for tx in range(c_lo // TILE, (c_hi - 1) // TILE + 1)]
        with ThreadPoolExecutor(8) as pool:
            list(pool.map(lambda j: self.tile(*j), jobs))

    def read(self, col0, row0, cols, rows):
        """Return Float32 grid [rows x cols]; pixels outside the level are no data."""
        grid = array("f", [NODATA_IN]) * (cols * rows)
        self.prefetch(col0, row0, cols, rows)
        c_lo, c_hi = max(col0, 0), min(col0 + cols, self.w)
        r_lo, r_hi = max(row0, 0), min(row0 + rows, self.h)
        for ty in range(r_lo // TILE, (r_hi - 1) // TILE + 1):
            for tx in range(c_lo // TILE, (c_hi - 1) // TILE + 1):
                t = self.tile(tx, ty)
                cs, ce = max(c_lo, tx * TILE), min(c_hi, (tx + 1) * TILE)
                for r in range(max(r_lo, ty * TILE), min(r_hi, (ty + 1) * TILE)):
                    src = (r - ty * TILE) * TILE
                    dst = (r - row0) * cols + (cs - col0)
                    grid[dst:dst + (ce - cs)] = t[src + cs - tx * TILE: src + ce - tx * TILE]
        return grid

    def col_of(self, lon):
        return (R * math.radians(lon) - X0) / self.px

    def row_of(self, lat):
        return (Y0 - R * math.radians(lat)) / self.py


def save(name, level, col0, row0, cols, rows, scale, extra):
    grid = level.read(col0, row0, cols, rows)
    valid = [v for v in grid if v != NODATA_IN]
    base = math.floor(min(valid))
    # Use the finest step that fits the height range in 16 bits.
    for scale in (scale, 0.02, 0.05, 0.1, 0.2):
        if (max(valid) - base) / scale < NODATA_OUT:
            break
    else:
        raise RuntimeError(f"{name}: elevation range too large for uint16")
    out = array("H", (NODATA_OUT if v == NODATA_IN else round((v - base) / scale) for v in grid))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.bin").write_bytes(out.tobytes())
    x_left = X0 + col0 * level.px
    y_top = Y0 - row0 * level.py
    header = {
        "source": f"MSL Gale Merged DEM 1 m v3, {level.name} overview level of the .ovr file",
        "source_url": "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m",
        "credit": "NASA/JPL-Caltech/University of Arizona/USGS",
        "file": f"{name}.bin",
        "encoding": "uint16 little-endian, row-major from the north-west corner; metres = base_m + value * scale_m",
        "cols": cols,
        "rows": rows,
        "pixel_x_m": level.px,
        "pixel_y_m": level.py,
        "base_m": base,
        "scale_m": scale,
        "nodata": NODATA_OUT,
        "radius_m": R,
        "projection": "equirectangular, centre longitude 0, sphere R = 3396190 m: x = R * lon_rad, y = R * lat_rad",
        "x_left_m": x_left,
        "y_top_m": y_top,
        "west": math.degrees(x_left / R),
        "east": math.degrees((x_left + cols * level.px) / R),
        "north": math.degrees(y_top / R),
        "south": math.degrees((y_top - rows * level.py) / R),
        "min_m": round(min(valid), 2),
        "max_m": round(max(valid), 2),
        "nodata_fraction": round(1 - len(valid) / len(grid), 4),
    }
    header.update(extra)
    (OUT / f"{name}.json").write_text(json.dumps(header, indent=1))
    print(f"{name}: {cols} x {rows}, {header['min_m']} to {header['max_m']} m, "
          f"no data {header['nodata_fraction']:.1%}, {(OUT / (name + '.bin')).stat().st_size} bytes")
    return header


def main():
    near = Level("4m")
    far = Level("32m")
    half = round(NEAR_HALF_M / near.px)
    places = []
    for s in SITES:
        c, r = math.floor(near.col_of(s["lon"])), math.floor(near.row_of(s["lat"]))
        save(f"near_{s['id']}_4m", near, c - half, r - half, 2 * half + 1, 2 * half + 1, 0.01,
             {"place": s["name"], "centre_lon": s["lon"], "centre_lat": s["lat"],
              "half_width_m": half * near.px})
        places.append((s["id"], s["lon"], s["lat"], s["lon"], s["lat"]))

    # Walk area: the 4 m crop of data/dem_boxwork_4m.json plus the same margin.
    crop = json.loads((OUT.parent / "dem_boxwork_4m.json").read_text())
    c0 = round((crop["x_left_m"] - X0) / near.px)
    r0 = round((Y0 - crop["y_top_m"]) / near.py)
    save("near_boxwork_4m", near, c0 - half, r0 - half, crop["cols"] + 2 * half, crop["rows"] + 2 * half, 0.01,
         {"place": "Walk area (boxwork)", "margin_m": half * near.px,
          "crop_offset_cols": half, "crop_offset_rows": half,
          "note": "Contains data/dem_boxwork_4m.bin at (crop_offset_cols, crop_offset_rows)."})
    places.append(("boxwork", crop["west"], crop["south"], crop["east"], crop["north"]))

    # One far window for all places: union of bounding boxes plus 20 km.
    deg = math.degrees(FAR_RADIUS_M / R)
    west = min(p[1] for p in places) - deg / math.cos(math.radians(4.75))
    east = max(p[3] for p in places) + deg / math.cos(math.radians(4.75))
    south = min(p[2] for p in places) - deg
    north = max(p[4] for p in places) + deg
    fc0 = max(0, math.floor(far.col_of(west)))
    fc1 = min(far.w, math.ceil(far.col_of(east)))
    fr0 = max(0, math.floor(far.row_of(north)))
    fr1 = min(far.h, math.ceil(far.row_of(south)))
    dem_w = math.degrees(X0 / R)
    dem_e = math.degrees((X0 + FULL_W) / R)
    dem_n = math.degrees(Y0 / R)
    dem_s = math.degrees((Y0 - FULL_H) / R)
    reach = {}
    coslat = math.cos(math.radians(4.75))
    for pid, w, s, e, n in places:
        reach[pid] = {
            "to_west_edge_km": round(math.radians(w - dem_w) * R * coslat / 1000, 1),
            "to_east_edge_km": round(math.radians(dem_e - e) * R * coslat / 1000, 1),
            "to_north_edge_km": round(math.radians(dem_n - n) * R / 1000, 1),
            "to_south_edge_km": round(math.radians(s - dem_s) * R / 1000, 1),
        }
    save("far_32m", far, fc0, fr0, fc1 - fc0, fr1 - fr0, 0.1,
         {"place": "All validation sites and the walk area, plus 20 km, clipped to the DEM",
          "requested_radius_km": FAR_RADIUS_M / 1000,
          "dem_extent": {"west": dem_w, "east": dem_e, "north": dem_n, "south": dem_s},
          "distance_to_dem_edge": reach,
          "where_data_ends": "The DEM rectangle ends 14 to 18 km east and west of every place and 16 to 22 km "
                             "to the south (distance_to_dem_edge), so the 20 km radius is not reached there. "
                             "Inside the rectangle the valid data is narrower still: the west and south-east "
                             "margins are no data (nodata_fraction). Beyond either, no terrain is counted. "
                             "The summit of Mount Sharp lies east of the DEM and is not included. "
                             "tools/shielding.mjs reports, per point, the distance at which each ray ran out of data."})
    print(f"downloaded this run: {fetched_bytes / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
