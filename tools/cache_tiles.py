"""Save a local copy of the Mars map tiles for the walk area.

Source: NASA MMGIS MSL tile services at mars.nasa.gov/mmgis-maps/MSL/Layers/
  - HiRISE colour: MSL_Gale_HiRISE-LRGB_78quads (native zoom 10 to 18)
  - CTX 6 m:       MSL_CTX_ortho_mosaic_6m (native zoom 6 to 13)
Credit: HiRISE: NASA/JPL-Caltech/University of Arizona.
        CTX: NASA/JPL-Caltech/MSSS.

Tiles are 256 px PNG, Web Mercator, TMS row order. Files are saved under
tiles/<layer>/{z}/{x}/{y}.png using the same z, x and y as the source URL
(y is the TMS row), so the page only needs a different base address.

Before each HiRISE zoom, the size is estimated from the tile count and the
average tile size so far. The script stops before everything saved would
pass the size cap.

Usage: python3 tools/cache_tiles.py
"""
import math
import os
import sys
import time
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tiles")
ROOT = os.path.normpath(ROOT)
LAT_MIN, LAT_MAX = -4.8260, -4.7860
LON_MIN, LON_MAX = 137.3660, 137.4000
CAP_BYTES = 22 * 1024 * 1024  # "22 MB" read as 22 MiB
PAUSE = 0.15
RETRIES = 2
UA = "red-ledger-spaceapps/1.0"
BASE = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/"
LAYERS = [
    ("ctx", "MSL_CTX_ortho_mosaic_6m", range(10, 14)),
    ("hirise", "MSL_Gale_HiRISE-LRGB_78quads", range(13, 19)),
]


def xy(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lr = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lr)) / math.pi) / 2.0 * n)
    return x, y


def tiles(z):
    x0, y0 = xy(LAT_MAX, LON_MIN, z)  # north-west corner (y_xyz smallest)
    x1, y1 = xy(LAT_MIN, LON_MAX, z)
    n = 2 ** z
    return [(x, n - 1 - y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def dir_size():
    total = 0
    for d, _, fs in os.walk(ROOT):
        for f in fs:
            total += os.path.getsize(os.path.join(d, f))
    return total


def fetch(url, path):
    for attempt in range(RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            if not data.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("not a PNG")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
            return len(data)
        except Exception as e:
            err = e
            time.sleep(1)
    print("FAILED", url, err)
    return None


def main():
    failed = []
    for name, svc, zooms in LAYERS:
        sizes = []
        for z in zooms:
            tl = tiles(z)
            if name == "hirise" and sizes:
                est = len(tl) * (sum(sizes) / len(sizes))
                if dir_size() + est > CAP_BYTES:
                    print(f"{name} z{z}: {len(tl)} tiles, est {est/1e6:.1f} MB, would pass cap. Stop.")
                    break
            saved = 0
            for x, y in tl:
                path = os.path.join(ROOT, name, str(z), str(x), f"{y}.png")
                if os.path.exists(path):
                    sizes.append(os.path.getsize(path))
                    continue
                url = f"{BASE}{svc}/{z}/{x}/{y}.png"
                n = fetch(url, path)
                time.sleep(PAUSE)
                if n is None:
                    failed.append(url)
                else:
                    sizes.append(n)
                    saved += n
            print(f"{name} z{z}: {len(tl)} tiles, downloaded {saved/1e6:.2f} MB, total on disk {dir_size()/1e6:.2f} MB")
    print("failed:", len(failed))
    for u in failed:
        print(u)


if __name__ == "__main__":
    sys.exit(main())
