"""Cut a small elevation crop for the walk area out of the USGS Gale crater
terrain model and store it in the repo, so the page needs no live server.

Source: MSL Gale Merged DEM, 1 m, version 3 (Parker and Calef), served by the
USGS Astrogeology Science Center. This script reads the 4 m overview level
from the companion ".ovr" file with HTTP range requests (64 KB per tile), so
nothing large is downloaded.

Credit: NASA/JPL-Caltech/University of Arizona/USGS

Usage: python3 tools/cut_dem.py
"""
import json
import math
import struct
import urllib.request
from array import array
from pathlib import Path

URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif.ovr"

# Layout of the 4 m level, read from the file header on 14 Nov 2026.
R = 3396190.0            # Mars radius used by the model, metres
X0 = 8127993.4928        # projected x of the left edge, metres
Y0 = -244781.0752        # projected y of the top edge, metres
PX = 4.0                 # pixel size, metres
TILE = 128               # tile edge, pixels
TILES_PER_ROW = 65
OFFSET_TABLE = 109976    # byte position of the tile-offset table
TILE_COUNT = 7345
NODATA_IN = -32767.0

# The boxwork region with room for a habitat and for routes around the ridges.
LON_MIN, LON_MAX = 137.3700, 137.3960
LAT_MIN, LAT_MAX = -4.8220, -4.7900

OUT_DIR = Path(__file__).resolve().parent.parent / "data"
NAME = "dem_boxwork_4m"
NODATA_OUT = 65535


def fetch(start, length):
    req = urllib.request.Request(URL, headers={
        "Range": f"bytes={start}-{start + length - 1}",
        "User-Agent": "red-ledger-spaceapps/1.0",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if len(data) != length:
        raise RuntimeError(f"wanted {length} bytes at {start}, got {len(data)}")
    return data


def main():
    col0 = math.floor((R * math.radians(LON_MIN) - X0) / PX)
    col1 = math.ceil((R * math.radians(LON_MAX) - X0) / PX)
    row0 = math.floor((Y0 - R * math.radians(LAT_MAX)) / PX)
    row1 = math.ceil((Y0 - R * math.radians(LAT_MIN)) / PX)
    cols, rows = col1 - col0, row1 - row0

    offsets = struct.unpack(f"<{TILE_COUNT}I", fetch(OFFSET_TABLE, 4 * TILE_COUNT))

    grid = array("f", [NODATA_IN]) * (cols * rows)
    for ty in range(row0 // TILE, (row1 - 1) // TILE + 1):
        for tx in range(col0 // TILE, (col1 - 1) // TILE + 1):
            tile = array("f")
            tile.frombytes(fetch(offsets[ty * TILES_PER_ROW + tx], TILE * TILE * 4))
            for r in range(max(row0, ty * TILE), min(row1, (ty + 1) * TILE)):
                src = (r - ty * TILE) * TILE
                c_start = max(col0, tx * TILE)
                c_end = min(col1, (tx + 1) * TILE)
                dst = (r - row0) * cols + (c_start - col0)
                grid[dst:dst + (c_end - c_start)] = tile[src + c_start - tx * TILE: src + c_end - tx * TILE]
            print(f"tile {tx},{ty} read")

    valid = [v for v in grid if v != NODATA_IN]
    base = math.floor(min(valid))
    # Stored as whole centimetres above `base`, two bytes per pixel. Unsigned,
    # because the crop climbs more than 327 m from north to south.
    if (max(valid) - base) * 100 >= NODATA_OUT:
        raise RuntimeError("elevation range too large for 16-bit centimetres")
    out = array("H", (NODATA_OUT if v == NODATA_IN else round((v - base) * 100) for v in grid))

    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / f"{NAME}.bin").write_bytes(out.tobytes())
    (OUT_DIR / f"{NAME}.json").write_text(json.dumps({
        "source": "MSL Gale Merged DEM 1 m v3, 4 m overview level",
        "source_url": "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m",
        "credit": "NASA/JPL-Caltech/University of Arizona/USGS",
        "file": f"{NAME}.bin",
        "encoding": "uint16 little-endian, row-major from the north-west corner; metres = base_m + value / 100",
        "cols": cols,
        "rows": rows,
        "pixel_m": PX,
        "base_m": base,
        "nodata": NODATA_OUT,
        "radius_m": R,
        "x_left_m": X0 + col0 * PX,
        "y_top_m": Y0 - row0 * PX,
        "west": math.degrees((X0 + col0 * PX) / R),
        "east": math.degrees((X0 + col1 * PX) / R),
        "north": math.degrees((Y0 - row0 * PX) / R),
        "south": math.degrees((Y0 - row1 * PX) / R),
        "min_m": round(min(valid), 2),
        "max_m": round(max(valid), 2),
    }, indent=1))
    print(f"{cols} x {rows} pixels, {min(valid):.1f} to {max(valid):.1f} m, "
          f"{len(valid)} valid of {len(grid)}, {(OUT_DIR / (NAME + '.bin')).stat().st_size} bytes")


if __name__ == "__main__":
    main()
