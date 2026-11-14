"""Download the whole-Mars data used by globe.html.

Sources
  Textures: NASA Mars Trek WMTS tiles (equirectangular, 256 px, 2 x 1 tiles at
  zoom 0, origin at lon -180 lat 90), https://trek.nasa.gov/tiles/Mars/EQ/
    viking  Mars_Viking_MDIM21_ClrMosaic_global_232m   jpg
            Viking Orbiter mosaic, NASA/JPL-Caltech/USGS
    mola    Mars_MGS_MOLA_ClrShade_merge_global_463m   jpg
            MOLA, Mars Global Surveyor, NASA/GSFC
    themis  THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018   png (65 S to 65 N)
            THEMIS, Mars Odyssey, NASA/JPL-Caltech/Arizona State University
  Elevation numbers: MOLA gridded topography, 4 pixels per degree,
  megt90n000cb.img from NASA's Planetary Data System Geosciences Node,
  https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/
  The .lbl file gives 1440 x 720 samples, MSB_INTEGER 16 bit, unit METER,
  east longitude, row 0 at 90 N, column 0 at 0 E. The script checks this
  and writes a little-endian copy.

Output: tiles/global/<layer>/<z>/<row>/<col>.<ext>, data/global/mola_4ppd.bin,
data/global/mola_4ppd.json.

Usage: python3 tools/fetch_global.py [zoom]   (default zoom 2)
Python standard library only.
"""
import json
import os
import struct
import sys
import time
import urllib.request

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{row}/{col}.{ext}"
LAYERS = {
    "viking": ("Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg"),
    "mola": ("Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg"),
    "themis": ("THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", "png"),
}
PDS = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/megt90n000cb"


def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception as e:  # retry, then give up loudly
            if attempt == 2:
                raise
            time.sleep(1.5)


def fetch_tiles(z):
    cols, rows = 2 << z, 1 << z
    for short, (layer, ext) in LAYERS.items():
        total = 0
        for row in range(rows):
            for col in range(cols):
                path = os.path.join(ROOT, "tiles", "global", short, str(z), str(row), f"{col}.{ext}")
                if not os.path.exists(path):
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    data = get(TREK.format(layer=layer, z=z, row=row, col=col, ext=ext))
                    with open(path, "wb") as f:
                        f.write(data)
                    time.sleep(0.05)
                total += os.path.getsize(path)
        print(f"{short}: {rows * cols} tiles, {total / 1e6:.2f} MB")


def fetch_mola():
    lbl = get(PDS + ".lbl").decode("latin-1")
    for needle in ("LINES                        = 720", "LINE_SAMPLES                 = 1440",
                   "MSB_INTEGER", "UNIT                         = METER"):
        assert needle in lbl, "label does not match the expected layout: " + needle
    raw = get(PDS + ".img")
    assert len(raw) == 1440 * 720 * 2, len(raw)
    vals = struct.unpack(">%dh" % (1440 * 720), raw)
    out = os.path.join(ROOT, "data", "global")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "mola_4ppd.bin"), "wb") as f:
        f.write(struct.pack("<%dh" % len(vals), *vals))
    meta = {
        "file": "mola_4ppd.bin", "width": 1440, "height": 720, "format": "int16 little-endian",
        "unit": "metres relative to the areoid",
        "pixelsPerDegree": 4, "firstSample": "centre of the top-left cell: lat 89.875 N, lon 0.125 E",
        "longitude": "east positive, 0 to 360, column 0 starts at 0 E",
        "latitude": "row 0 starts at 90 N",
        "source": "MOLA MEGDR gridded topography, megt90n000cb, NASA PDS Geosciences Node",
        "sourceUrl": PDS + ".img",
        "credit": "MOLA, Mars Global Surveyor, NASA/GSFC",
    }
    with open(os.path.join(out, "mola_4ppd.json"), "w") as f:
        json.dump(meta, f, indent=2)

    def at(lat, lon):
        return vals[min(719, int((90 - lat) * 4)) * 1440 + int((lon % 360) * 4) % 1440]
    for name, lat, lon in (("Olympus Mons summit", 18.65, 226.2), ("Hellas basin floor", -42.4, 70.5),
                           ("Gale crater floor", -4.59, 137.44)):
        print(f"{name}: {at(lat, lon)} m")


if __name__ == "__main__":
    fetch_mola()
    fetch_tiles(int(sys.argv[1]) if len(sys.argv) > 1 else 2)
