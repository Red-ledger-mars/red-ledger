"""Fetch Curiosity REMS weather for the boxwork-region sols (4540 to 4852).

Source: https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
Credit: REMS weather station on Curiosity. NASA/JPL-Caltech/CAB (CSIC-INTA)
The feed says it is for outreach use only; the sentence is copied into the output.

Standard library only. Writes data/rems_boxwork.json (compact JSON).
"""
import json, re, statistics, urllib.request, pathlib

URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "rems_boxwork.json"
SOL_MIN, SOL_MAX = 4540, 4852
CREDIT = "REMS weather station on Curiosity. NASA/JPL-Caltech/CAB (CSIC-INTA)"


def num(v):
    try:
        return float(v) if "." in v else int(v)
    except (TypeError, ValueError):
        return None


def txt(v):
    return None if v in (None, "", "--") else v


def stats(vals):
    v = [x for x in vals if x is not None]
    if not v:
        return {"min": None, "median": None, "max": None, "n": 0}
    return {"min": min(v), "median": statistics.median(v), "max": max(v), "n": len(v)}


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "red-ledger-fetch"})
    data = json.load(urllib.request.urlopen(req, timeout=60))
    raw = re.sub(r"\s+", " ", data["descriptions"]["disclaimer_en"]).strip()
    m = re.search(r"The information contained.*?Any other use is discouraged\.", raw)
    disclaimer = m.group(0)  # whitespace collapsed only (feed wraps lines)
    rows = {}
    for s in data["soles"]:
        sol = num(s["sol"])
        if sol is None or not SOL_MIN <= sol <= SOL_MAX:
            continue
        rows[sol] = {
            "sol": sol, "date": s["terrestrial_date"], "ls": num(s["ls"]),
            "air_min_c": num(s["min_temp"]), "air_max_c": num(s["max_temp"]),
            "ground_min_c": num(s["min_gts_temp"]), "ground_max_c": num(s["max_gts_temp"]),
            "pressure_pa": num(s["pressure"]), "uv": txt(s["local_uv_irradiance_index"]),
            "sunrise": txt(s["sunrise"]), "sunset": txt(s["sunset"]),
        }
    sols = [rows[k] for k in sorted(rows)]
    uv = {}
    for r in sols:
        uv[r["uv"] or "missing"] = uv.get(r["uv"] or "missing", 0) + 1
    summary = {k: stats([r[k] for r in sols]) for k in
               ("air_min_c", "air_max_c", "ground_min_c", "ground_max_c", "pressure_pa")}
    summary["uv_counts"] = uv
    out = {"source": URL, "credit": CREDIT, "disclaimer": disclaimer,
           "sols": sols, "summary": summary}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(len(sols), "sols written to", OUT)


if __name__ == "__main__":
    main()
