// How much of the sky the terrain blocks at a point ("sky blocked", S).
//
// Follows the definition of Guo et al. (2026, JGR Planets 131, e2026JE009704,
// section 3): horizon elevation angle per azimuth, seen from a viewpoint 1 m
// above the ground, out to 20 km; the blocked fraction of each 1 degree zenith
// ring; total weighted by solid angle over the upper hemisphere (2 pi sr).
// The exact weighting formula is not printed in the paper; ours is
// S = sum over rings of ROS(theta) * (cos theta_lo - cos theta_hi), which is
// the same as the mean over azimuth of max(0, sin h). UNVERIFIED as the
// paper's exact formula (it matches the paper's wording and its Figure 5).
//
// Elevation: MSL Gale Merged DEM 1 m v3 (USGS), 4 m and 32 m overview levels,
// cut by tools/cut_dem_sites.py. Node 22, no packages.
//
// Use as a module:   import { loadGrid, horizonProfile, skyBlocked } from './shielding.mjs'
// Or from the shell: node tools/shielding.mjs validate | sensitivity | map

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARS_R = 3396190; // m, the sphere of the DEM's projection
const DEG = Math.PI / 180;

/** Load a grid written by cut_dem_sites.py (or cut_dem.py). Elevation in metres, NaN = no data. */
export function loadGrid(jsonPath) {
  const h = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const buf = readFileSync(join(dirname(jsonPath), h.file));
  const raw = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const scale = h.scale_m ?? 0.01;
  const z = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) z[i] = raw[i] === h.nodata ? NaN : h.base_m + raw[i] * scale;
  return {
    z, cols: h.cols, rows: h.rows,
    px: h.pixel_x_m ?? h.pixel_m, py: h.pixel_y_m ?? h.pixel_m,
    xLeft: h.x_left_m, yTop: h.y_top_m, header: h,
  };
}

/** Make a coarser grid by averaging f x f blocks (no-data blocks stay no data). */
export function blockAverage(g, f) {
  const cols = Math.floor(g.cols / f), rows = Math.floor(g.rows / f);
  const z = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let i = 0; i < f; i++) for (let j = 0; j < f; j++) s += g.z[(r * f + i) * g.cols + c * f + j];
    z[r * cols + c] = s / (f * f);
  }
  return { z, cols, rows, px: g.px * f, py: g.py * f, xLeft: g.xLeft, yTop: g.yTop, header: g.header };
}

/** Bilinear elevation at projected (x, y) in metres; NaN outside the grid or on no data. */
export function sample(g, x, y) {
  const fc = (x - g.xLeft) / g.px - 0.5, fr = (g.yTop - y) / g.py - 0.5;
  const c = Math.floor(fc), r = Math.floor(fr);
  if (c < 0 || r < 0 || c >= g.cols - 1 || r >= g.rows - 1) return NaN;
  const tx = fc - c, ty = fr - r, i = r * g.cols + c, z = g.z;
  return (z[i] * (1 - tx) + z[i + 1] * tx) * (1 - ty) + (z[i + g.cols] * (1 - tx) + z[i + g.cols + 1] * tx) * ty;
}

export const lonLatToXY = (lon, lat) => [MARS_R * lon * DEG, MARS_R * lat * DEG];

/**
 * Horizon profile at projected point (x, y).
 * opts: azStepDeg (0.25), viewHeight (1 m), maxDist (20000 m),
 *       nearStep (2 m) used inside the near grid, farStep (16 m) on the far grid,
 *       growth (0): step = max(base step, growth * distance), to speed up maps.
 * Returns { az, elev (deg, can be negative), endDist (m, where the ray stopped), z0 }.
 */
export function horizonProfile(near, far, x, y, opts = {}) {
  const { azStepDeg = 0.25, viewHeight = 1, maxDist = 20000, nearStep = 2, farStep = 16, growth = 0 } = opts;
  const ground = sample(near, x, y);
  if (Number.isNaN(ground)) throw new Error('point is outside the near grid');
  const z0 = ground + viewHeight;
  const lat = y / MARS_R;
  const kx = 1 / Math.cos(lat); // ground metres east -> projected metres
  const n = Math.round(360 / azStepDeg);
  const az = new Float64Array(n), elev = new Float64Array(n), endDist = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = k * azStepDeg * DEG;
    const ux = Math.sin(a) * kx, uy = Math.cos(a);
    let best = -Infinity, d = nearStep, onNear = true, end = maxDist;
    while (d <= maxDist) {
      const px = x + ux * d, py = y + uy * d;
      let z = NaN;
      if (onNear) { z = sample(near, px, py); if (Number.isNaN(z)) onNear = false; }
      if (!onNear) {
        z = sample(far, px, py);
        if (Number.isNaN(z)) { end = d; break; }
      }
      const t = (z - d * d / (2 * MARS_R) - z0) / d; // tan of elevation angle, with curvature drop
      if (t > best) best = t;
      d += Math.max(onNear ? nearStep : farStep, growth * d);
    }
    az[k] = k * azStepDeg; elev[k] = Math.atan(best) / DEG; endDist[k] = end;
  }
  return { az, elev, endDist, z0 };
}

/**
 * Sky blocked from a horizon profile.
 * ros[i] = blocked fraction of the zenith ring i..i+1 degrees (exact share of the ring that lies
 * below the horizon, averaged over azimuth). S = sum ros[i] * (cos i - cos(i+1)), i = 0..89.
 * S_exact = mean over azimuth of max(0, sin h); it equals S up to rounding inside each ring.
 */
export function skyBlocked(elev) {
  const n = elev.length, ros = new Float64Array(90);
  let sExact = 0;
  for (let k = 0; k < n; k++) {
    const h = elev[k];
    if (h > 0) sExact += Math.sin(h * DEG);
    const oza = 90 - h; // obstructed zenith angle
    for (let i = Math.max(0, Math.floor(oza)); i < 90; i++) ros[i] += Math.min(1, Math.max(0, i + 1 - oza));
  }
  let S = 0;
  for (let i = 0; i < 90; i++) { ros[i] /= n; S += ros[i] * (Math.cos(i * DEG) - Math.cos((i + 1) * DEG)); }
  return { S, sExact: sExact / n, ros };
}

/** S over a regular grid of points. points: array of [x, y]. Returns Float64Array of S. */
export function skyBlockedMap(near, far, points, opts) {
  const out = new Float64Array(points.length);
  points.forEach(([x, y], i) => { out[i] = skyBlocked(horizonProfile(near, far, x, y, opts).elev).S; });
  return out;
}

// ---------------------------------------------------------------- command line
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data', 'shielding');

// Guo et al. 2026 Table 1 (via brief/research/2026-11-14-radiation-method.md section C) and rover
// positions from NASA MSL_waypoints.json (section D). The sol-to-waypoint matching rule is ours.
const PERIODS = [
  { p: 'P1', site: 'tower_buttes', place: 'Tower Buttes', sols: '2664.5-2691.5', lon: 137.3808990, lat: -4.7365847, paperS: 13.7, bg: 'BG1', paperBgS: 7.9, measured: 4.0 },
  { p: 'P2', site: 'tower_buttes', place: 'Tower Buttes', sols: '2734.5-2742.5', lon: 137.3805497, lat: -4.7364160, paperS: 14.8, bg: 'BG2', paperBgS: 5.4, measured: 7.1 },
  { p: 'P3', site: 'bloodstone_hill', place: 'Bloodstone Hill', sols: '2797.6-2800.6', lon: 137.3881905, lat: -4.7336628, paperS: 12.7, bg: 'BG3', paperBgS: 7.2, measured: 6.5 },
  { p: 'P4', site: 'mt_mercou', place: 'Mont Mercou', sols: '3072.6-3074.6', lon: 137.4125303, lat: -4.7354500, paperS: 14.4, bg: 'BG4/5', paperBgS: 11.8, measured: 3.8 },
  { p: 'P5', site: 'mt_mercou', place: 'Mont Mercou', sols: '3076.6-3079.6', lon: 137.4123245, lat: -4.7353604, paperS: 11.4, bg: 'BG4/5', paperBgS: 11.8, measured: 2.1 },
  { p: 'P6', site: 'maria_gordon_notch', place: 'Maria Gordon Notch', sols: '3324.6-3326.6', lon: 137.3943118, lat: -4.7476563, paperS: 37.9, bg: 'BG6', paperBgS: 18.0, measured: 19.4 },
  { p: 'P7', site: 'paraitepuy', place: 'Paraitepuy', sols: '3564.6-3565.6', lon: 137.3988594, lat: -4.7590454, paperS: 32.8, bg: 'BG7', paperBgS: 22.1, measured: 9.8, note: 'Table 1 prints 9.8%; its own dose values give 11.6%.' },
  { p: 'P8', site: 'paraitepuy', place: 'Paraitepuy', sols: '3567.5-3570.5', lon: 137.3988380, lat: -4.7591653, paperS: 29.6, bg: 'BG8', paperBgS: 17.8, measured: 9.9 },
];
// Background positions (same source). Several drives: we average S over the listed positions.
const BACKGROUNDS = {
  BG1: { site: 'tower_buttes', pos: [[137.3808234, -4.7343379], [137.3807301, -4.7347451], [137.3806350, -4.7354010]] },
  BG2: { site: 'tower_buttes', pos: [[137.3807898, -4.7370607]] },
  BG3: { site: 'bloodstone_hill', pos: [[137.3861298, -4.7326193], [137.3869108, -4.7324424]] },
  'BG4/5': { site: 'mt_mercou', pos: [[137.4125440, -4.7353856]] },
  BG6: { site: 'maria_gordon_notch', pos: [[137.3944241, -4.7479084]] },
  BG7: { site: 'paraitepuy', pos: [[137.3986320, -4.7583654]] },
  BG8: { site: 'paraitepuy', pos: [[137.3994000, -4.7595739], [137.3998211, -4.7602888]] },
};

const r2 = (v) => Math.round(v * 100) / 100;
const pearson = (a, b) => {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
};

function siteS(far, cache, site, lon, lat, opts) {
  if (!cache[site]) cache[site] = loadGrid(join(DATA, `near_${site}_4m.json`));
  const [x, y] = lonLatToXY(lon, lat);
  const prof = horizonProfile(cache[site], far, x, y, opts);
  const { S } = skyBlocked(prof.elev);
  const ended = prof.endDist.filter((d) => d < (opts.maxDist ?? 20000));
  return { S: 100 * S, prof, shortRays: ended.length / prof.endDist.length, minEnd: Math.min(...prof.endDist) };
}

function validate() {
  const far = loadGrid(join(DATA, 'far_32m.json'));
  const cache = {};
  const opts = { azStepDeg: 0.25, viewHeight: 1, nearStep: 2, farStep: 16 };
  const rows = PERIODS.map((q) => {
    const r = siteS(far, cache, q.site, q.lon, q.lat, opts);
    const bg = BACKGROUNDS[q.bg].pos.map(([lo, la]) => siteS(far, cache, BACKGROUNDS[q.bg].site, lo, la, opts).S);
    const bgS = bg.reduce((s, v) => s + v, 0) / bg.length;
    return {
      period: q.p, place: q.place, sols: q.sols, lon: q.lon, lat: q.lat,
      paper_sky_blocked_pct: q.paperS, paper_background: q.bg, paper_background_sky_blocked_pct: q.paperBgS,
      our_sky_blocked_pct: r2(r.S), our_background_sky_blocked_pct: r2(bgS),
      difference_pct_points: r2(r.S - q.paperS),
      paper_increase_over_background_pct_points: r2(q.paperS - q.paperBgS),
      our_increase_over_background_pct_points: r2(r.S - bgS),
      measured_dose_decrease_pct: q.measured,
      rays_ending_before_20km_fraction: r2(r.shortRays), shortest_ray_km: r2(r.minEnd / 1000),
      ...(q.note ? { note: q.note } : {}),
    };
  });
  const ours = rows.map((r) => r.our_sky_blocked_pct), paper = rows.map((r) => r.paper_sky_blocked_pct);
  const dOurs = rows.map((r) => r.our_increase_over_background_pct_points);
  const dPaper = rows.map((r) => r.paper_increase_over_background_pct_points);
  const out = {
    what: 'Sky blocked by terrain (percent of the upper hemisphere, solid-angle weighted) at the eight RAD periods of Guo et al. 2026 Table 1, recomputed from the USGS Gale DEM (4 m near window to 1.6 km, 32 m beyond, to 20 km or the edge of the DEM).',
    settings: { ...opts, maxDist_m: 20000, near_grid_m: 4, far_grid_m: 32, curvature: 'surface drop d^2 / (2 R), R = 3396190 m' },
    paper: 'Guo, J., Tian, C., Charpentier, G., et al. (2026). JGR Planets 131(4), e2026JE009704. doi:10.1029/2026JE009704. Table 1. The paper used the 1 m DEM, 0.25 degree azimuth bins, 1 m viewpoint, 20 km radius.',
    positions: 'Rover waypoint at the start of each period, NASA MSL_waypoints.json. The rule matching sols to waypoints is ours (UNVERIFIED).',
    rows,
    summary: {
      mean_absolute_difference_pct_points: r2(rows.reduce((s, r) => s + Math.abs(r.difference_pct_points), 0) / rows.length),
      mean_difference_pct_points: r2(rows.reduce((s, r) => s + r.difference_pct_points, 0) / rows.length),
      correlation_pearson: Math.round(pearson(ours, paper) * 1000) / 1000,
      increase_over_background_mean_absolute_difference_pct_points: r2(dOurs.reduce((s, v, i) => s + Math.abs(v - dPaper[i]), 0) / rows.length),
      increase_over_background_correlation_pearson: Math.round(pearson(dOurs, dPaper) * 1000) / 1000,
    },
  };
  writeFileSync(join(DATA, 'validation.json'), JSON.stringify(out, null, 1));
  console.table(rows.map((r) => ({ p: r.period, paper: r.paper_sky_blocked_pct, ours: r.our_sky_blocked_pct, diff: r.difference_pct_points, bgPaper: r.paper_background_sky_blocked_pct, bgOurs: r.our_background_sky_blocked_pct, short: r.rays_ending_before_20km_fraction })));
  console.log(out.summary);
}

function posRange(near, far, x, y, r) {
  const kx = 1 / Math.cos(y / MARS_R);
  const v = [];
  for (let k = 0; k < 8; k++) {
    const a = k * 45 * DEG;
    v.push(100 * skyBlocked(horizonProfile(near, far, x + r * Math.sin(a) * kx, y + r * Math.cos(a), { azStepDeg: 0.5 }).elev).S);
  }
  return [r2(Math.min(...v)), r2(Math.max(...v))];
}

function sensitivity() {
  const far = loadGrid(join(DATA, 'far_32m.json'));
  const result = {};
  for (const p of ['P6', 'P1', 'P5']) {
    const q = PERIODS.find((v) => v.p === p);
    const near4 = loadGrid(join(DATA, `near_${q.site}_4m.json`));
    const near8 = blockAverage(near4, 2);
    const [x, y] = lonLatToXY(q.lon, q.lat);
    const S = (near, o) => r2(100 * skyBlocked(horizonProfile(near, far, x, y, { azStepDeg: 0.25, viewHeight: 1, nearStep: 2, farStep: 16, ...o }).elev).S);
    const base = S(near4, {});
    // radius_* limits the horizon search to show how much comes from near and from far terrain.
    result[p] = {
      place: q.place, paper_sky_blocked_pct: q.paperS, baseline_4m_1m_0p25deg: base,
      view_height_2m: S(near4, { viewHeight: 2 }),
      view_height_0p5m: S(near4, { viewHeight: 0.5 }),
      az_step_1deg: S(near4, { azStepDeg: 1 }),
      az_step_2deg: S(near4, { azStepDeg: 2 }),
      az_step_4deg: S(near4, { azStepDeg: 4 }),
      near_step_4m: S(near4, { nearStep: 4 }),
      near_grid_8m_block_averaged: S(near8, { nearStep: 4 }),
      far_step_32m: S(near4, { farStep: 32 }),
      map_settings_4deg_growth_0p01: S(near4, { azStepDeg: 4, nearStep: 4, farStep: 32, growth: 0.01 }),
      map_settings_2deg_growth_0p01: S(near4, { azStepDeg: 2, nearStep: 4, farStep: 32, growth: 0.01 }),
      radius_1p5km_only: S(near4, { maxDist: 1500 }),
      radius_5km: S(near4, { maxDist: 5000 }),
      // Position: the waypoint may not be exactly where RAD sat. S at 10 m and 20 m in 8 directions.
      position_10m_range: posRange(near4, far, x, y, 10),
      position_20m_range: posRange(near4, far, x, y, 20),
    };
  }
  writeFileSync('/tmp/red-ledger-sensitivity.json', JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
}

function map(azStepDeg = 2) {
  const far = loadGrid(join(DATA, 'far_32m.json'));
  const near = loadGrid(join(DATA, 'near_boxwork_4m.json'));
  const crop = JSON.parse(readFileSync(join(DATA, '..', 'dem_boxwork_4m.json'), 'utf8'));
  const spacing = 16, cols = Math.ceil(crop.cols / 4), rows = Math.ceil(crop.rows / 4);
  // Point (i, j) sits at the centre of the 4 x 4 block of crop cells starting at (4i, 4j).
  const x0 = crop.x_left_m + 8, y0 = crop.y_top_m - 8;
  const pts = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) pts.push([x0 + i * spacing, y0 - j * spacing]);
  const opts = { azStepDeg, viewHeight: 1, nearStep: 4, farStep: 32, growth: 0.01 };
  const t = Date.now();
  const S = skyBlockedMap(near, far, pts, opts);
  const secs = (Date.now() - t) / 1000;
  const bytes = Uint8Array.from(S, (v) => Math.max(0, Math.min(200, Math.round(v * 200))));
  writeFileSync(join(DATA, 'boxwork_sky_blocked.bin'), bytes);
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (const v of S) { mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; }
  const header = {
    what: 'Sky blocked by terrain, percent of the upper hemisphere (solid-angle weighted), on a 16 m grid over the walk-area crop (data/dem_boxwork_4m.json). Same definition as Guo et al. 2026; see brief/research/2026-11-14-shielding-results.md for its limits.',
    file: 'boxwork_sky_blocked.bin',
    encoding: 'uint8, row-major from the north-west point; sky blocked percent = value / 2 (half-percent steps)',
    cols, rows, spacing_m: spacing,
    origin: 'centre of the north-west point',
    origin_x_m: x0, origin_y_m: y0,
    origin_lon: x0 / MARS_R / DEG, origin_lat: y0 / MARS_R / DEG,
    projection: 'equirectangular, centre longitude 0, sphere R = 3396190 m: x = R * lon_rad, y = R * lat_rad; rows go south',
    settings: { ...opts, maxDist_m: 20000, near: 'data/shielding/near_boxwork_4m (4 m)', far: 'data/shielding/far_32m (32 m)' },
    min_pct: r2(mn * 100), max_pct: r2(mx * 100), mean_pct: r2((sum / S.length) * 100),
    compute_seconds: secs,
    credit: 'Elevation: NASA/JPL-Caltech/University of Arizona/USGS (MSL Gale Merged DEM 1 m v3)',
  };
  writeFileSync(join(DATA, 'boxwork_sky_blocked.json'), JSON.stringify(header, null, 1));
  console.log(header);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  if (cmd === 'validate') validate();
  else if (cmd === 'sensitivity') sensitivity();
  else if (cmd === 'map') map(Number(process.argv[3] ?? 2));
  else console.log('usage: node tools/shielding.mjs validate | sensitivity | map [azimuth step deg]');
}
