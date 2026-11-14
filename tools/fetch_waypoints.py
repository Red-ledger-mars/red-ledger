"""Fetch Curiosity's end-of-drive waypoints from NASA's rover location map and
keep a small copy for the walk area, so the page does not depend on a live
server.

Source: https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json
Credit: NASA/JPL-Caltech

Usage: python3 tools/fetch_waypoints.py
"""
import json
import urllib.request
from pathlib import Path

URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
OUT = Path(__file__).resolve().parent.parent / "data" / "msl_waypoints.json"
MIN_SOL = 4300  # the approach to the boxwork region and everything after it


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "red-ledger-spaceapps/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        source = json.load(resp)

    points = []
    for feature in source["features"]:
        p = feature["properties"]
        if int(p["sol"]) < MIN_SOL:
            continue
        points.append({
            "sol": int(p["sol"]),
            "lon": round(float(p["lon"]), 6),
            "lat": round(float(p["lat"]), 6),
            "elev": round(float(p["elev_geoid"]), 2),
            "dist_total_m": round(float(p["dist_total_m"]), 1),
        })
    points.sort(key=lambda w: (w["sol"], w["dist_total_m"]))

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        "source": URL,
        "credit": "NASA/JPL-Caltech",
        "note": "Curiosity end-of-drive positions, sol %d onward. Elevation is metres relative to the Mars areoid." % MIN_SOL,
        "waypoints": points,
    }, separators=(",", ":")))
    print(f"{len(points)} waypoints, sols {points[0]['sol']} to {points[-1]['sol']}, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
