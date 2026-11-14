"""Download orbiter, Sun and Earth positions over the walk area for one sol.

Orbiter and Sun positions: NASA/JPL Horizons API (ssd.jpl.nasa.gov),
https://ssd-api.jpl.nasa.gov/doc/horizons.html

Each table is the airless apparent azimuth and elevation (Horizons quantity 4)
and the range (quantity 20) of a body as seen from one site on Mars, every
minute for one sol. Earth also gets quantity 21, the one-way light time.
Seven small text files, one request each, so the service is not loaded.

Usage:  python3 tools/comms_fetch.py [out_dir]   (default /tmp/red-ledger-comms-raw)
Then:   node tools/comms.mjs [out_dir]
Python standard library only.
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"

# The "ridges" stop in data/walk.json, where Curiosity was parked on sol 4752.
# Horizons wants east longitude as a negative number for Mars (its header shows
# the value back as west longitude 222.619). Altitude -3.6 km is a rounded value
# above the reference ellipsoid; it changes the angles by far less than 0.01 deg.
SITE = "-137.381,-4.808,-3.6"

# Earth date of sol 4752 in data/rems_boxwork.json. One sol is 24 h 39.6 min,
# so the table runs to 00:40 the next day (1481 rows at 1 minute).
START = "2025-12-18 00:00"
STOP = "2025-12-19 00:40"

BODIES = [
    ("sun", "10", "1 m", "4,20"),
    ("mro", "-74", "1 m", "4,20"),
    ("odyssey", "-53", "1 m", "4,20"),
    ("maven", "-202", "1 m", "4,20"),
    ("tgo", "-143", "1 m", "4,20"),
    ("mex", "-41", "1 m", "4,20"),
    ("earth", "399", "60 m", "4,20,21"),
]


def fetch(command, step, quantities):
    params = {
        "format": "text",
        "COMMAND": f"'{command}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@499'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{SITE}'",
        "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{STOP}'",
        "STEP_SIZE": f"'{step}'",
        "QUANTITIES": f"'{quantities}'",
        "CSV_FORMAT": "'YES'",
        "ANG_FORMAT": "'DEG'",
    }
    url = API + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/red-ledger-comms-raw")
    out.mkdir(parents=True, exist_ok=True)
    log = {"api": API, "site": SITE, "start_utc": START, "stop_utc": STOP, "bodies": {}}
    for name, command, step, q in BODIES:
        path = out / f"{name}.txt"
        if path.exists() and "$$SOE" in path.read_text():
            print(f"{name}: already have {path}")
        else:
            text = fetch(command, step, q)
            path.write_text(text)
            time.sleep(2)  # be polite to the service
        text = path.read_text()
        ok = "$$SOE" in text
        log["bodies"][name] = {"command": command, "step": step, "quantities": q, "file": path.name, "has_table": ok}
        if not ok:
            # No ephemeris for that date (or another error): keep the reply, carry on.
            print(f"{name}: NO TABLE. First lines of the reply:")
            print("\n".join(text.splitlines()[:15]))
        else:
            rows = text.split("$$SOE")[1].split("$$EOE")[0].strip().count("\n") + 1
            print(f"{name}: {rows} rows")
    (out / "fetch_log.json").write_text(json.dumps(log, indent=1))


if __name__ == "__main__":
    main()
