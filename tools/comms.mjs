// Comms shadow for the walk area: when each Mars relay orbiter is above the
// local terrain horizon, per 16 m grid point, over one sol.
//
// Orbiter and Sun positions: NASA/JPL Horizons API (ssd.jpl.nasa.gov),
// fetched by tools/comms_fetch.py (quantities 4: airless apparent azimuth and
// elevation, azimuth clockwise from north; 20: range; 21: one-way light time).
// Elevation: NASA/JPL-Caltech/University of Arizona/USGS (MSL Gale Merged DEM
// 1 m v3), horizon maths from tools/shielding.mjs.
// Mars time: Allison & McEwen (2000), Planet. Space Sci. 48, 215, as used in
// NASA GISS Mars24 (https://www.giss.nasa.gov/tools/mars24/help/algorithm.html).
//
// Usage: node tools/comms.mjs [raw_dir]   (default /tmp/red-ledger-comms-raw)
// Node 22, no packages. Run time about 20 s on the team laptop.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGrid, horizonProfile, lonLatToXY, MARS_R } from './shielding.mjs';
import { horizonAt, visible } from '../js/comms.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RAW = process.argv[2] ?? '/tmp/red-ledger-comms-raw';
const OUT = join(ROOT, 'data', 'comms');
const DEG = Math.PI / 180;

const SOL = 4752;
const START_UTC = Date.UTC(2025, 11, 18, 0, 0); // 2025-12-18 00:00 UTC, the REMS Earth date of sol 4752
const SOL_SECONDS = 88775.244; // Allison & McEwen 2000
const EARTH_MIN_PER_MARS_HOUR = SOL_SECONDS / 24 / 60; // 61.65
const SAMPLES = 1480; // whole minutes 0..1479 cover one sol (1479.6 min)
const SITE = { lon: 137.381, lat: -4.808 }; // the site used in the Horizons requests

const ORBITERS = [
  { id: 'mro', name: 'MRO', full: 'Mars Reconnaissance Orbiter', horizons: -74 },
  { id: 'odyssey', name: 'Odyssey', full: 'Mars Odyssey', horizons: -53 },
  // MAVEN is left out: NASA's last contact with it was on 6 December 2025,
  // twelve days before this sol, so it could not have relayed anything.
  { id: 'tgo', name: 'TGO', full: 'ExoMars Trace Gas Orbiter', horizons: -143 },
  { id: 'mex', name: 'Mars Express', full: 'Mars Express', horizons: -41 },
];

// Grid settings. 5 deg azimuths as asked; ray steps as in the sky-blocked map.
const VIEW_HEIGHT = 1.7; // m, ASSUMPTION: antenna of a standing walker
const AZ_STEP = 5;
const RAY = { azStepDeg: AZ_STEP, viewHeight: VIEW_HEIGHT, nearStep: 4, farStep: 32, growth: 0.01, maxDist: 20000 };
const RAY_FINE = { azStepDeg: 0.5, viewHeight: VIEW_HEIGHT, nearStep: 2, farStep: 16, growth: 0, maxDist: 20000 };

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/** Rows of a Horizons CSV table: { minute, az, el, rangeKm, lightMin }. */
function readTable(name) {
  const path = join(RAW, `${name}.txt`);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  if (!text.includes('$$SOE')) return null;
  const body = text.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n');
  return body.map((line) => {
    const f = line.split(',').map((s) => s.trim());
    const [d, hm] = f[0].split(' ');
    const [y, mon, day] = d.split('-');
    const [hh, mm] = hm.split(':');
    const t = Date.UTC(+y, MONTHS[mon], +day, +hh, +mm);
    return {
      minute: Math.round((t - START_UTC) / 60000),
      az: +f[3], el: +f[4],
      rangeKm: +f[5] * 149597870.7, // AU -> km (1 au as printed in the Horizons header)
      lightMin: f[7] ? +f[7] : null,
    };
  });
}

// ---------------------------------------------------------------- Mars time
function marsTime(utcMs, lonEast) {
  const jdUT = utcMs / 86400000 + 2440587.5;
  const jdTT = jdUT + (37 + 32.184) / 86400; // TAI-UTC = 37 s since 2017
  const dt = jdTT - 2451545.0;
  const msd = (dt - 4.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const mtc = (((24 * msd) % 24) + 24) % 24;
  const lmst = (((mtc + lonEast / 15) % 24) + 24) % 24;
  // Equation of time (perturbations from other planets left out; they are under 0.02 deg).
  const M = (19.3871 + 0.52402073 * dt) * DEG;
  const aFMS = 270.3871 + 0.524038496 * dt;
  const nuM = (10.691 + 3.0e-7 * dt) * Math.sin(M) + 0.623 * Math.sin(2 * M) + 0.050 * Math.sin(3 * M)
    + 0.005 * Math.sin(4 * M) + 0.0005 * Math.sin(5 * M);
  const ls = (((aFMS + nuM) % 360) + 360) % 360;
  const eot = 2.861 * Math.sin(2 * ls * DEG) - 0.071 * Math.sin(4 * ls * DEG) + 0.002 * Math.sin(6 * ls * DEG) - nuM;
  const ltst = (((lmst + eot / 15) % 24) + 24) % 24;
  return { lmst, ltst, ls, eotMin: eot * 4 };
}

const hhmm = (h) => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const hours = (s) => { const [h, m] = s.split(':').map(Number); return h + m / 60; };

/** Times (fractional minutes) where el crosses 0 going up (rise) and down (set). */
function crossings(rows, level = 0) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if ((a.el <= level) !== (b.el <= level)) {
      const t = (level - a.el) / (b.el - a.el);
      out.push({ kind: b.el > level ? 'rise' : 'set', minute: a.minute + t * (b.minute - a.minute), az: a.az + t * (b.az - a.az) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- step 2: conventions
function checkSun(sun) {
  const rems = JSON.parse(readFileSync(join(ROOT, 'data', 'rems_boxwork.json'), 'utf8')).sols.find((s) => s.sol === SOL);
  const cr = crossings(sun);
  const rise = cr.find((c) => c.kind === 'rise');
  const set = cr.find((c) => c.kind === 'set' && c.minute > rise.minute);
  const above = sun.filter((r) => r.el > 0).length; // minutes above the flat horizon in this sol window
  const dayMin = set.minute - rise.minute;
  const remsDayMin = (hours(rems.sunset) - hours(rems.sunrise)) * EARTH_MIN_PER_MARS_HOUR;
  const tRise = marsTime(START_UTC + rise.minute * 60000, SITE.lon);
  const tSet = marsTime(START_UTC + set.minute * 60000, SITE.lon);
  const noon = sun.reduce((b, r) => (r.el > b.el ? r : b));
  const tNoon = marsTime(START_UTC + noon.minute * 60000, SITE.lon);
  const res = {
    what: 'Sun (Horizons 10) from the same site, same sol. Azimuth read as clockwise from north (Horizons header: North(0) -> East(90) -> South(180) -> West(270)).',
    sunrise_utc_minute: r1(rise.minute), sunrise_azimuth_deg: r1(rise.az),
    sunset_utc_minute: r1(set.minute), sunset_azimuth_deg: r1(set.az),
    highest: { minute: noon.minute, azimuth_deg: r1(noon.az), elevation_deg: r1(noon.el), ltst: hhmm(tNoon.ltst), lmst: hhmm(tNoon.lmst) },
    day_length_horizons_min: r1(dayMin), minutes_above_flat_horizon_in_window: above,
    rems: { sunrise: rems.sunrise, sunset: rems.sunset, ls: rems.ls, day_length_min: r1(remsDayMin), note: 'REMS times are Mars local hours; 1 Mars hour = 61.65 Earth minutes. Whether REMS uses mean or true solar time is not stated in the file (UNVERIFIED).' },
    day_length_difference_min: r1(dayMin - remsDayMin),
    sunrise_local: { lmst: hhmm(tRise.lmst), ltst: hhmm(tRise.ltst) },
    sunset_local: { lmst: hhmm(tSet.lmst), ltst: hhmm(tSet.ltst) },
    ls_computed_deg: r1(tRise.ls),
    equation_of_time_min: r1(tRise.eotMin),
    note: 'Horizons elevation is the centre of the Sun over the flat reference surface, no air. The Sun is 0.19 deg in radius from Mars, about 0.8 min of motion at each end.',
  };
  const remsRise = hours(rems.sunrise), remsSet = hours(rems.sunset);
  const off = (a, b) => Math.abs(((a - b + 36) % 24) - 12) * 60; // minutes, wrap-safe
  res.sunrise_offset_vs_rems_min = { lmst: r1(off(tRise.lmst, remsRise)), ltst: r1(off(tRise.ltst, remsRise)) };
  res.sunset_offset_vs_rems_min = { lmst: r1(off(tSet.lmst, remsSet)), ltst: r1(off(tSet.ltst, remsSet)) };
  const checks = {
    rises_in_east: rise.az > 0 && rise.az < 180,
    sets_in_west: set.az > 180 && set.az < 360,
    highest_near_north_or_south_meridian: Math.abs(((noon.az + 360) % 180)) < 20 || Math.abs(((noon.az + 360) % 180) - 180) < 20,
    day_length_within_15_min: Math.abs(dayMin - remsDayMin) < 15,
    local_time_of_rise_within_30_min: Math.min(res.sunrise_offset_vs_rems_min.lmst, res.sunrise_offset_vs_rems_min.ltst) < 30,
    ls_within_2_deg_of_rems: Math.abs(tRise.ls - rems.ls) < 2,
  };
  res.checks = checks;
  res.passed = Object.values(checks).every(Boolean);
  return res;
}

// ---------------------------------------------------------------- grid
function gridPoints() {
  const g = JSON.parse(readFileSync(join(ROOT, 'data', 'shielding', 'boxwork_sky_blocked.json'), 'utf8'));
  const pts = [];
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) pts.push([g.origin_x_m + i * g.spacing_m, g.origin_y_m - j * g.spacing_m]);
  return { g, pts };
}

const toInt8 = (deg) => Math.max(-128, Math.min(127, Math.round(deg * 2)));

/** Minute-by-minute flags (Uint8Array, 1 = some orbiter in view) for one horizon cell. */
function contactFlags(horizon, cell, nAz, orbs, minElev) {
  const f = new Uint8Array(SAMPLES);
  for (const o of orbs) for (const s of o.samples) {
    if (s.minute < 0 || s.minute >= SAMPLES || f[s.minute]) continue;
    if (visible(s.el, horizonAt(horizon, cell, s.az, nAz), minElev)) f[s.minute] = 1;
  }
  return f;
}

/** Longest run of zeros (minutes); also says if it touches the edge of the sol window. */
function longestGap(flags) {
  let best = { minutes: 0, start: null, end: null }, start = null;
  for (let m = 0; m <= flags.length; m++) {
    if (m < flags.length && !flags[m]) { if (start == null) start = m; }
    else if (start != null) {
      if (m - start > best.minutes) best = { minutes: m - start, start, end: m };
      start = null;
    }
  }
  best.touches_window_edge = best.start === 0 || best.end === flags.length;
  return best;
}

/** Passes of one orbiter at one cell: runs of visible minutes. */
function passesAt(horizon, cell, nAz, o, minElev) {
  const out = [];
  let cur = null;
  for (const s of o.samples) {
    if (s.minute < 0 || s.minute >= SAMPLES) continue;
    const vis = visible(s.el, horizonAt(horizon, cell, s.az, nAz), minElev);
    if (vis && cur && s.minute === cur.last + 1) { cur.last = s.minute; cur.maxEl = Math.max(cur.maxEl, s.el); }
    else if (vis) { cur = { first: s.minute, last: s.minute, maxEl: s.el }; out.push(cur); }
    else cur = null;
  }
  return out;
}

function main() {
  const sun = readTable('sun');
  if (!sun) throw new Error(`no Sun table in ${RAW}; run tools/comms_fetch.py first`);
  const sunCheck = checkSun(sun);
  console.log('Sun check:', JSON.stringify(sunCheck, null, 1));
  if (!sunCheck.passed) {
    console.error('Conventions do not check out. Nothing written.');
    process.exit(1);
  }

  const used = [], missing = [];
  for (const o of ORBITERS) {
    const rows = readTable(o.id);
    if (!rows) { missing.push(o.name); continue; }
    // Round once, as stored in passes.json, so the page recomputes exactly the same grid values.
    const samples = rows.filter((r) => r.el > -5 && r.minute < SAMPLES).map((r) => ({ ...r, az: r2(r.az), el: r2(r.el), rangeKm: Math.round(r.rangeKm) }));
    used.push({ ...o, rows, samples });
  }
  const earth = readTable('earth');

  // Step 3: terrain horizon per grid point.
  const near = loadGrid(join(ROOT, 'data', 'shielding', 'near_boxwork_4m.json'));
  const far = loadGrid(join(ROOT, 'data', 'shielding', 'far_32m.json'));
  const { g, pts } = gridPoints();
  const nAz = 360 / AZ_STEP;
  const horizon = new Int8Array(pts.length * nAz);
  const t0 = Date.now();
  let shortRays = 0;
  pts.forEach(([x, y], i) => {
    const p = horizonProfile(near, far, x, y, RAY);
    for (let k = 0; k < nAz; k++) { horizon[i * nAz + k] = toInt8(p.elev[k]); if (p.endDist[k] < RAY.maxDist) shortRays++; }
  });
  const horizonSecs = (Date.now() - t0) / 1000;
  console.log(`horizon grid: ${pts.length} points x ${nAz} azimuths in ${horizonSecs} s`);
  let hMin = Infinity, hMax = -Infinity;
  for (const v of horizon) { hMin = Math.min(hMin, v / 2); hMax = Math.max(hMax, v / 2); }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'horizon.bin'), horizon);
  const credit = 'Elevation: NASA/JPL-Caltech/University of Arizona/USGS (MSL Gale Merged DEM 1 m v3)';
  writeFileSync(join(OUT, 'horizon.json'), JSON.stringify({
    what: 'Terrain horizon elevation angle per azimuth at each point of the 16 m walk-area grid (same grid as data/shielding/boxwork_sky_blocked.json), including the curvature of Mars.',
    file: 'horizon.bin',
    encoding: 'int8, degrees = value / 2 (half-degree steps, clipped to -64..63.5); point-major: index = (row * cols + col) * azimuths + k, azimuth = k * 5 deg clockwise from north; rows go south from the north-west point',
    cols: g.cols, rows: g.rows, spacing_m: g.spacing_m, azimuths: nAz, az_step_deg: AZ_STEP,
    origin: g.origin, origin_x_m: g.origin_x_m, origin_y_m: g.origin_y_m, origin_lon: g.origin_lon, origin_lat: g.origin_lat,
    projection: g.projection,
    settings: { ...RAY, view_height_note: 'ASSUMPTION: 1.7 m, the antenna height of a standing walker', near: 'data/shielding/near_boxwork_4m (4 m)', far: 'data/shielding/far_32m (32 m)' },
    min_deg: hMin, max_deg: hMax,
    rays_ending_before_20km_fraction: r2(shortRays / horizon.length),
    compute_seconds: horizonSecs,
    limits: 'The elevation model ends 14 to 17 km east and west of the walk area, and the summit of Mount Sharp lies outside it, so the horizon to the south-east is a lower bound. 5 deg azimuth sampling can miss narrow peaks.',
    credit,
  }, null, 1));

  // Step 4: contact per grid point for two masks.
  const t1 = Date.now();
  const grids = {};
  for (const minElev of [0, 10]) {
    const minutes = new Uint16Array(pts.length);
    for (let i = 0; i < pts.length; i++) minutes[i] = contactFlags(horizon, i, nAz, used, minElev).reduce((s, v) => s + v, 0);
    const flat = new Uint8Array(SAMPLES);
    for (const o of used) for (const s of o.samples) if (s.el > minElev) flat[s.minute] = 1;
    const flatMin = flat.reduce((s, v) => s + v, 0);
    let mn = Infinity, mx = -Infinity, sum = 0, worst = 0;
    minutes.forEach((v, i) => { sum += v; if (v < mn) { mn = v; worst = i; } mx = Math.max(mx, v); });
    grids[minElev] = { minutes, flatMin, min: mn, max: mx, mean: r1(sum / minutes.length), worst };
    const file = minElev === 0 ? 'in_view_minutes.bin' : 'in_view_minutes_10deg.bin';
    writeFileSync(join(OUT, file), Buffer.from(minutes.buffer));
    grids[minElev].file = file;
  }
  console.log(`contact grids in ${(Date.now() - t1) / 1000} s`);
  const cellXY = (i) => { const [x, y] = pts[i]; return { lat: Math.round(y / MARS_R / DEG * 1e6) / 1e6, lon: Math.round(x / MARS_R / DEG * 1e6) / 1e6 }; };
  writeFileSync(join(OUT, 'in_view_minutes.json'), JSON.stringify({
    what: 'Minutes per sol (sol 4752, from 2025-12-18 00:00 UTC, 1480 whole minutes) with at least one relay orbiter above both the terrain horizon and the elevation mask, per grid point. Geometric line of sight only: real relay sessions are scheduled and need antenna pointing and link margin.',
    encoding: 'uint16 little-endian, row-major from the north-west point, same grid as horizon.json',
    cols: g.cols, rows: g.rows,
    orbiters: used.map((o) => o.name),
    grids: Object.fromEntries(Object.entries(grids).map(([k, v]) => [k, {
      file: v.file, min_elevation_deg: +k, min: v.min, max: v.max, mean: v.mean,
      flat_horizon_minutes: v.flatMin,
      worst_point: { ...cellXY(v.worst), minutes: v.min, minutes_removed_by_terrain: v.flatMin - v.min },
    }])),
    sources: ['Orbiter positions: NASA/JPL Horizons API (ssd.jpl.nasa.gov)', credit],
  }, null, 1));

  // Step 5: passes.json (samples above -5 deg) and the time base.
  const t0Mars = marsTime(START_UTC, SITE.lon);
  writeFileSync(join(OUT, 'passes.json'), JSON.stringify({
    what: 'Relay orbiter positions seen from the ridges stop (lon 137.381 E, lat -4.808), one sample per minute, only where elevation > -5 deg. Each sample: [minute of the sol, azimuth deg clockwise from north, elevation deg, range km].',
    source: 'NASA/JPL Horizons API (ssd.jpl.nasa.gov), observer table, quantities 4 (airless apparent azimuth/elevation) and 20 (range)',
    time: {
      start_utc: '2025-12-18T00:00Z', sol: SOL, samples: SAMPLES,
      earth_minutes_per_mars_hour: r2(EARTH_MIN_PER_MARS_HOUR),
      lmst_at_minute0_h: Math.round(t0Mars.lmst * 1e4) / 1e4,
      ltst_at_minute0_h: Math.round(t0Mars.ltst * 1e4) / 1e4,
      note: 'Local mean solar time at the site from the Mars24 algorithm (Allison & McEwen 2000).',
    },
    missing_orbiters: missing,
    orbiters: used.map((o) => ({ id: o.id, name: o.name, full_name: o.full, horizons_id: o.horizons, samples: o.samples.map((s) => [s.minute, r2(s.az), r2(s.el), Math.round(s.rangeKm)]) })),
  }));

  // Summary at the habitat and stops.
  const walk = JSON.parse(readFileSync(join(ROOT, 'data', 'walk.json'), 'utf8'));
  const places = [walk.habitat, ...walk.stops.filter((s) => ['ridges', 'west'].includes(s.id))];
  const cellOf = (lat, lon) => {
    const [x, y] = lonLatToXY(lon, lat);
    const c = Math.round((x - g.origin_x_m) / g.spacing_m), r = Math.round((g.origin_y_m - y) / g.spacing_m);
    return r * g.cols + c;
  };
  const localOf = (minute) => hhmm(marsTime(START_UTC + minute * 60000, SITE.lon).lmst);
  const utcOf = (minute) => new Date(START_UTC + minute * 60000).toISOString().slice(0, 16) + 'Z';
  const placeSummary = (p) => {
    const cell = cellOf(p.lat, p.lon);
    const out = { id: p.id, name: p.name, lat: p.lat, lon: p.lon };
    for (const minElev of [0, 10]) {
      const flags = contactFlags(horizon, cell, nAz, used, minElev);
      const gap = longestGap(flags);
      const noMaven = longestGap(contactFlags(horizon, cell, nAz, used.filter((o) => o.id !== 'maven'), minElev));
      out[`mask_${minElev}deg`] = {
        minutes_in_view: flags.reduce((s, v) => s + v, 0),
        passes: used.flatMap((o) => passesAt(horizon, cell, nAz, o, minElev).map((q) => ({
          orbiter: o.name, start_minute: q.first, end_minute: q.last + 1, minutes: q.last + 1 - q.first,
          start_utc: utcOf(q.first), start_lmst: localOf(q.first), max_elevation_deg: r1(q.maxEl),
        }))).sort((a, b) => a.start_minute - b.start_minute),
        longest_gap: { ...gap, start_lmst: gap.start != null ? localOf(gap.start) : null, end_lmst: gap.end != null ? localOf(gap.end) : null },
        longest_gap_without_maven_min: noMaven.minutes,
        minutes_in_view_without_maven: contactFlags(horizon, cell, nAz, used.filter((o) => o.id !== 'maven'), minElev).reduce((s, v) => s + v, 0),
      };
    }
    // Same point with a fine horizon (0.5 deg, 2 m / 16 m steps): how much the grid settings change it.
    const [x, y] = lonLatToXY(p.lon, p.lat);
    const fine = horizonProfile(near, far, x, y, RAY_FINE);
    const fineH = Int8Array.from(fine.elev, toInt8);
    out.fine_horizon_check = {
      settings: RAY_FINE,
      minutes_in_view_0deg_fine: contactFlags(fineH, 0, fine.elev.length, used, 0).reduce((s, v) => s + v, 0),
      minutes_in_view_0deg_grid: out.mask_0deg.minutes_in_view,
      note: 'Fine horizon at the exact point; grid value at the nearest 16 m point.',
    };
    return out;
  };
  const placeRows = places.map(placeSummary);

  // How far the orbiter angles can be off at the edge of the grid, because all
  // angles are taken from one site: about distance / range radians.
  const corners = [pts[0], pts[g.cols - 1], pts[pts.length - g.cols], pts[pts.length - 1]];
  const [sx, sy] = lonLatToXY(SITE.lon, SITE.lat);
  const maxOffset = Math.max(...corners.map(([x, y]) => Math.hypot((x - sx) * Math.cos(SITE.lat * DEG), y - sy)));
  const minRange = Math.min(...used.flatMap((o) => o.samples.filter((s) => s.el > 0).map((s) => s.rangeKm)));

  const earthRow = earth?.find((r) => r.minute === 0);
  const lt = earth?.map((r) => r.lightMin).filter((v) => v != null) ?? [];
  const summary = {
    what: 'Comms shadow over the walk area: when a walker 1.7 m above the ground has a line of sight to a Mars relay orbiter over the terrain.',
    date_utc: '2025-12-18', sol: SOL, window: '2025-12-18 00:00 UTC + 1480 min (one sol is 1479.6 min)',
    why_this_date: 'Earth date of sol 4752 in data/rems_boxwork.json; Curiosity was parked at the ridges stop from sol 4752.',
    orbiters_used: used.map((o) => `${o.full} (Horizons ${o.horizons})`),
    orbiters_missing: missing,
    maven_note: 'MAVEN is not counted. NASA lost contact with it on 6 December 2025, twelve days before this sol, and later ended the mission. Horizons still gives its trajectory, which is why it has to be left out by hand.',
    sun_check: sunCheck,
    assumptions: {
      view_height_m: VIEW_HEIGHT, view_height_note: 'ASSUMPTION: antenna of a standing walker.',
      single_site: `All orbiter angles are taken from the ridges stop. The farthest grid point is ${r1(maxOffset / 1000)} km away and the closest orbiter in view is ${Math.round(minRange)} km away, so angles at the grid edge can be off by up to about ${r2(maxOffset / 1000 / minRange / DEG)} deg.`,
      geometric_only: 'Line of sight only. Real relay sessions are scheduled, need the orbiter antenna pointed at the surface and need link margin; a 0 deg mask is optimistic, so a 10 deg mask is also given.',
    },
    grid_settings: { ...RAY, horizon_compute_seconds: horizonSecs },
    grid: Object.fromEntries(Object.entries(grids).map(([k, v]) => [`mask_${k}deg`, {
      flat_horizon_minutes: v.flatMin, min: v.min, max: v.max, mean: v.mean,
      worst_point: { ...cellXY(v.worst), minutes: v.min, minutes_removed_by_terrain: v.flatMin - v.min },
    }])),
    places: placeRows,
    light_time: {
      one_way_minutes_at_start: earthRow?.lightMin ?? null,
      range_km_at_start: earthRow ? Math.round(earthRow.rangeKm) : null,
      one_way_minutes_range_over_window: lt.length ? [r2(Math.min(...lt)), r2(Math.max(...lt))] : null,
      source: 'NASA/JPL Horizons, Earth (399) seen from the site, quantity 21 (one-way down-leg light time) and 20 (range).',
      earth_in_sky: earth ? `Earth above the flat horizon for ${earth.filter((r) => r.el > 0).length} of ${earth.length} hourly samples` : null,
    },
    sources: ['Orbiter and Sun positions: NASA/JPL Horizons API (ssd.jpl.nasa.gov)', credit, 'Mars time: Allison & McEwen 2000 (Mars24 algorithm, NASA GISS)'],
  };
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ grid: summary.grid, light: summary.light_time, assumptions: summary.assumptions }, null, 1));
  for (const p of placeRows) console.log(p.id, p.mask_0deg.minutes_in_view, p.mask_10deg.minutes_in_view, p.mask_0deg.longest_gap, p.fine_horizon_check);
}

main();
