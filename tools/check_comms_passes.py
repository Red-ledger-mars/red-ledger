#!/usr/bin/env python3
"""Independent check of data/comms/passes.json.

The orbiter passes in data/comms/passes.json come from the Horizons observer
table (tools/comms_fetch.py). This script computes the same passes a second
way, sharing no code with the first: Horizons state VECTORS (ICRF, centred on
Mars), rotated into the Mars body-fixed frame with the IAU 2015 pole and prime
meridian, then turned into azimuth and elevation at the site. It prints the
pass-by-pass differences for several ways of placing the observer. The result
of the run on 14 Nov 2026 is recorded in data/comms/check_passes.json.

Written by an AI agent that was not shown tools/comms_fetch.py or
tools/comms.mjs. Plain standard library only.

Usage: python3 tools/check_comms_passes.py <repo_root> [cache_folder]
The Horizons replies are kept in the cache folder (a new temporary folder if
none is given), never in the repository.
"""
import json, math, sys, tempfile, time, urllib.parse, urllib.request, os

REPO = sys.argv[1]
HERE = sys.argv[2] if len(sys.argv) > 2 else tempfile.mkdtemp(prefix="red-ledger-comms-check-")
SITE_LON, SITE_LAT = 137.381, -4.808
R_EQ, R_POL = 3396.19, 3376.2          # km (IAU 2015 Mars radii)
R_SPHERE = 3396.19                      # km, what the project uses (3,396,190 m)
N = 1480
TT_MINUS_UTC = 69.184                   # s; leap seconds 37 + 32.184. Horizons uses this constant for 2025-12 ("UT~")
IDS = {"mro": "-74", "odyssey": "-53", "tgo": "-143", "mex": "-41"}
NAMES = {"mro": "MRO", "odyssey": "Mars Odyssey", "tgo": "ExoMars TGO", "mex": "Mars Express"}
d2r = math.pi / 180


def fetch(cid, corr):
    cache = os.path.join(HERE, f"vec_{cid}_{corr}.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    p = {"format": "json", "COMMAND": f"'{cid}'", "OBJ_DATA": "NO", "MAKE_EPHEM": "YES",
         "EPHEM_TYPE": "VECTORS", "CENTER": "'500@499'",
         "START_TIME": "'2025-12-18 00:00'", "STOP_TIME": f"'2025-12-18 {(N-1)//60:02d}:{(N-1)%60:02d}'",
         "STEP_SIZE": "'1 min'", "VEC_TABLE": "1", "VEC_CORR": f"'{corr}'",
         "REF_SYSTEM": "'ICRF'", "REF_PLANE": "'FRAME'", "OUT_UNITS": "'KM-S'",
         "CSV_FORMAT": "YES", "TIME_TYPE": "'UT'"}
    # the stop time must be 23:59 + ... ; 1480 samples = 0..1479 min -> 24:39 next day
    p["STOP_TIME"] = "'2025-12-19 00:39'"
    u = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(p)
    txt = json.loads(urllib.request.urlopen(u, timeout=120).read().decode())
    res = txt.get("result", "")
    if "$$SOE" not in res:
        out = {"error": res[:1500]}
    else:
        body = res.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
        rows = []
        for ln in body:
            c = [x.strip() for x in ln.split(",")]
            rows.append([float(c[0]), float(c[2]), float(c[3]), float(c[4])])
        out = {"rows": rows}
    json.dump(out, open(cache, "w"))
    time.sleep(1)
    return out


def mars_orient(jd_tdb):
    d = jd_tdb - 2451545.0
    T = d / 36525.0
    s = lambda a, b: math.sin((a + b * T) * d2r)
    c = lambda a, b: math.cos((a + b * T) * d2r)
    M = 0.5042615
    a0 = (317.269202 - 0.10927547 * T + 0.000068 * s(198.991226, 19139.4819985)
          + 0.000238 * s(226.292679, 38280.8511281) + 0.000052 * s(249.663391, 57420.7251593)
          + 0.000009 * s(266.183510, 76560.6367950) + 0.419057 * s(79.398797, M))
    de = (54.432516 - 0.05827105 * T + 0.000051 * c(122.433576, 19139.9407476)
          + 0.000141 * c(43.058401, 38280.8753272) + 0.000031 * c(57.663379, 57420.7517205)
          + 0.000005 * c(79.476401, 76560.6495004) + 1.591274 * c(166.325722, M))
    W = (176.049863 + 350.891982443297 * d + 0.000145 * s(129.071773, 19140.0328244)
         + 0.000157 * s(36.352167, 38281.0473591) + 0.000040 * s(56.668646, 57420.9295360)
         + 0.000001 * s(67.364003, 76560.2552215) + 0.000001 * s(104.792680, 95700.4387578)
         + 0.584542 * s(95.391654, M))
    return a0 * d2r, de * d2r, (W % 360) * d2r


def rz(a):
    c, s = math.cos(a), math.sin(a)
    return [[c, s, 0], [-s, c, 0], [0, 0, 1]]


def rx(a):
    c, s = math.cos(a), math.sin(a)
    return [[1, 0, 0], [0, c, s], [0, -s, c]]


def mm(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def mv(A, v):
    return [sum(A[i][k] * v[k] for k in range(3)) for i in range(3)]


def icrf_to_fixed(jd_tdb):
    a0, de, W = mars_orient(jd_tdb)
    return mm(rz(W), mm(rx(math.pi / 2 - de), rz(math.pi / 2 + a0)))


def observer(mode, h):
    """mode 'sphere': planetocentric lat on a sphere R_SPHERE + h.
    mode 'ellipsoid': lat is planetodetic on the IAU ellipsoid (3396.19 x 3376.2 km), height h above it."""
    lon, lat = SITE_LON * d2r, SITE_LAT * d2r
    if mode == "sphere":
        R = R_SPHERE + h
        P = [R * math.cos(lat) * math.cos(lon), R * math.cos(lat) * math.sin(lon), R * math.sin(lat)]
    else:
        e2 = 1 - (R_POL / R_EQ) ** 2
        Nn = R_EQ / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        P = [(Nn + h) * math.cos(lat) * math.cos(lon), (Nn + h) * math.cos(lat) * math.sin(lon),
             (Nn * (1 - e2) + h) * math.sin(lat)]
    up = [math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)]
    east = [-math.sin(lon), math.cos(lon), 0]
    north = [-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat)]
    return P, east, north, up


def azel(rows, mode, h=0.0):
    P, e, n, u = observer(mode, h)
    out = []
    for jdut, x, y, z in rows:
        jd_tdb = jdut + TT_MINUS_UTC / 86400.0
        v = mv(icrf_to_fixed(jd_tdb), [x, y, z])
        dvec = [v[i] - P[i] for i in range(3)]
        rng = math.sqrt(sum(t * t for t in dvec))
        E = sum(dvec[i] * e[i] for i in range(3))
        Nn = sum(dvec[i] * n[i] for i in range(3))
        U = sum(dvec[i] * u[i] for i in range(3))
        out.append(((math.degrees(math.atan2(E, Nn))) % 360, math.degrees(math.asin(U / rng)), rng))
    return out


def runs(el, thr=0.0):
    r, i = [], 0
    while i < len(el):
        if el[i] > thr:
            j = i
            while j + 1 < len(el) and el[j + 1] > thr:
                j += 1
            r.append((i, j))
            i = j + 1
        else:
            i += 1
    return r


def crossing(el, i, j):
    """interpolated (linear) rise and set minute for a run i..j"""
    rise = float(i)
    if i > 0:
        rise = (i - 1) + (0 - el[i - 1]) / (el[i] - el[i - 1])
    sett = float(j)
    if j < len(el) - 1:
        sett = j + (el[j]) / (el[j] - el[j + 1])
    return rise, sett


def adiff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def main():
    old = json.load(open(os.path.join(REPO, "data/comms/passes.json")))
    # sanity check of the rotation: body-fixed Z axis must map back to the pole
    R = icrf_to_fixed(2451545.0)
    print("pole in ICRF at J2000 (should be ~ (0.1, -0.3?, 0.9?)):", [round(R[2][i], 5) for i in range(3)])

    results = {}
    variants = {"A_sphere_h0": ("NONE", "sphere", 0.0),
                "B_sphere_h-4": ("NONE", "sphere", -4.0),
                "C_ellipsoid_h0": ("NONE", "ellipsoid", 0.0),
                "D_ellipsoid_h-4": ("NONE", "ellipsoid", -4.0),
                "E_ellipsoid_h-4_lighttime": ("LT", "ellipsoid", -4.0)}
    missing = []
    series = {}
    vecrows = {}
    for oid, cid in IDS.items():
        for corr in ("NONE", "LT"):
            r = fetch(cid, corr)
            if "rows" not in r or len(r["rows"]) != N:
                print(oid, corr, "problem:", r.get("error", f"rows={len(r.get('rows', []))}")[:300])
                if oid not in missing:
                    missing.append(oid)
                continue
            for vname, (vc, mode, h) in variants.items():
                if vc == corr:
                    series[(oid, vname)] = azel(r["rows"], mode, h)
            if corr == "NONE":
                vecrows[oid] = r["rows"]
    allout = {}
    for vname in variants:
        passes = []
        maxdaz = 0
        maxdel_over5 = 0
        maxdaz_over5 = 0
        npairs = 0
        for orb in old["orbiters"]:
            oid = orb["id"]
            if (oid, vname) not in series:
                continue
            new = series[(oid, vname)]
            nel = [t[1] for t in new]
            old_az = [None] * N
            old_el = [-90.0] * N
            for m, az, el, rg in orb["samples"]:
                old_az[m] = az
                old_el[m] = el
            # all-sample comparison where both have elevation > 5 deg
            for m in range(N):
                if old_el[m] > 5 and nel[m] > 5:
                    npairs += 1
                    maxdel_over5 = max(maxdel_over5, abs(old_el[m] - nel[m]))
                    maxdaz_over5 = max(maxdaz_over5, adiff(old_az[m], new[m][0]))
            ro = runs(old_el)
            rn = runs(nel)
            used = set()
            for (i, j) in ro:
                match = None
                for k, (a, b) in enumerate(rn):
                    if k not in used and a <= j + 2 and b >= i - 2:
                        match = k
                        break
                po = max(old_el[i:j + 1])
                ro_rise, ro_set = crossing(old_el, i, j)
                ent = {"orbiter": NAMES[oid],
                       "old": {"rise_min": i, "set_min": j, "rise_interp_min": round(ro_rise, 2),
                               "set_interp_min": round(ro_set, 2), "peak_elev_deg": po,
                               "peak_min": i + old_el[i:j + 1].index(po)}}
                if match is None:
                    ent["new"] = None
                    ent["note"] = "no matching pass in the new computation"
                else:
                    used.add(match)
                    a, b = rn[match]
                    pn = max(nel[a:b + 1])
                    nr, ns = crossing(nel, a, b)
                    ent["new"] = {"rise_min": a, "set_min": b, "rise_interp_min": round(nr, 2),
                                  "set_interp_min": round(ns, 2), "peak_elev_deg": round(pn, 2),
                                  "peak_min": a + nel[a:b + 1].index(pn)}
                    ent["diff"] = {"rise_min": a - i, "set_min": b - j,
                                   "rise_interp_min": round(nr - ro_rise, 2),
                                   "set_interp_min": round(ns - ro_set, 2),
                                   "peak_elev_deg": round(pn - po, 2),
                                   "peak_min": ent["new"]["peak_min"] - ent["old"]["peak_min"]}
                    ent["touches_window_edge"] = bool(i == 0 or j == N - 1 or a == 0 or b == N - 1)
                passes.append(ent)
            for k, (a, b) in enumerate(rn):
                if k not in used:
                    passes.append({"orbiter": NAMES[oid], "old": None,
                                   "new": {"rise_min": a, "set_min": b, "peak_elev_deg": round(max(nel[a:b + 1]), 2)},
                                   "note": "pass only in the new computation"})
        allout[vname] = {"passes": passes, "maxdel_over5": maxdel_over5, "maxdaz_over5": maxdaz_over5,
                         "npairs": npairs}
    # diagnostic: ellipsoid height that minimises the largest elevation difference (el>5 in both)
    fit = []
    for k in range(-80, 21):
        h = k * 0.1
        worst = 0
        for orb in old["orbiters"]:
            oid = orb["id"]
            if oid not in vecrows:
                continue
            new = azel(vecrows[oid], "ellipsoid", h)
            for m, az, el, rg in orb["samples"]:
                if el > 5 and new[m][1] > 5:
                    worst = max(worst, abs(new[m][1] - el))
        fit.append((worst, h))
    fit.sort()
    allout["fit_height_km"] = {"best_h_km": round(fit[0][1], 2), "max_elev_diff_deg": round(fit[0][0], 3)}
    print("fit", allout["fit_height_km"])
    json.dump({"missing": missing, "out": allout}, open(os.path.join(HERE, "result.json"), "w"), indent=1)
    for vname, v in allout.items():
        if vname == "fit_height_km":
            continue
        m = [p for p in v["passes"] if p.get("new") and p.get("old")]
        print(vname, "passes", len(v["passes"]), "matched", len(m),
              "max rise/set int diff",
              max([max(abs(p["diff"]["rise_min"]), abs(p["diff"]["set_min"])) for p in m] or [None]),
              "interp", max([max(abs(p["diff"]["rise_interp_min"]), abs(p["diff"]["set_interp_min"])) for p in m] or [None]),
              "peak diff", max([abs(p["diff"]["peak_elev_deg"]) for p in m] or [None]),
              "el>5 max dEl", round(v["maxdel_over5"], 3), "max dAz", round(v["maxdaz_over5"], 3), "n", v["npairs"])


main()
