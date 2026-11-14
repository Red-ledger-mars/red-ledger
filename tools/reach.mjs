// The body-reach map: for every cell of the elevation crop and each carried
// load, what a walk from the habitat to that cell and back costs the body,
// by the body-cost route (least walking energy, nothing steeper than the
// walking measurements). Per cell it stores the rests the planner adds, the
// peak stored heat if the walker never rests, and the time with the rests.
//
// Planning each cell with planWalk would take about a second per cell. So
// one search from the habitat gives the cheapest path out to every cell, and
// one search toward the habitat gives every cell its next cell on the
// cheapest way home. The body state is carried down the outward tree, then
// along the way home from each cell, with the same model (js/body.js).
//
// Usage: node tools/reach.mjs           writes data/reach/
//        node tools/reach.mjs --check   also compares 40 cells with planWalk
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Terrain } = await import(`${root}/js/terrain.js`);
const { Sky } = await import(`${root}/js/sky.js`);
const { step, Ledger } = await import(`${root}/js/body.js`);
const { PRICING, search, cellOf, planWalk, returnCost } = await import(`${root}/js/route.js`);

const LOADS_KG = [0, 15, 30];
const NO_ROUTE = 255;
const HEAT_SCALE = 20; // stored value = kJ/kg * 20
const CAP = 254;

const started = Date.now();
const readJson = (file) => JSON.parse(fs.readFileSync(`${root}/data/${file}`));
const readBytes = (file) => fs.readFileSync(`${root}/data/${file}`);

const demMeta = readJson('dem_boxwork_4m.json');
const demBytes = readBytes(demMeta.file);
const raw = new Uint16Array(demBytes.buffer, demBytes.byteOffset, demBytes.length / 2);
const terrain = new Terrain(demMeta, Float32Array.from(raw, (v) => (v === demMeta.nodata ? NaN : demMeta.base_m + v / 100)));
const walk = readJson('walk.json');
const { cols, rows, px, z } = terrain;
const n = cols * rows;
const home = cellOf(terrain, walk.habitat);

// Outward: the cheapest path from the habitat to every cell, the same search
// planWalk runs for its first leg (which only stops earlier).
const out = search(terrain, home, -1, PRICING.body);
// Homeward: searched outward from the habitat with each step priced in the
// opposite direction, as returnCost does. prev then points to the next cell
// on the cheapest way home.
const back = search(terrain, home, -1, (run, rise) => PRICING.body(run, -rise));
const next = back.prev;

// Cells that can be reached and left again, in the order the outward search
// settled them: each cell comes after the cell it is reached from.
const order = [];
for (let c = 0; c < n; c++) if (out.best[c] < Infinity && back.best[c] < Infinity) order.push(c);
order.sort((a, b) => out.best[a] - out.best[b]);
const reachable = new Uint8Array(n);
for (const c of order) reachable[c] = 1;
// The cell a reachable cell is reached from is reachable too: it can always
// walk on to that cell and home from there. So every parent is in `order`.

const stepBetween = (from, to, loadKg) => {
  const fc = from % cols, fr = (from - fc) / cols;
  const tc = to % cols, tr = (to - tc) / cols;
  return step(Math.hypot(tc - fc, tr - fr) * px, z[to] - z[from], loadKg);
};

// A copy of a Ledger. All of its state is in plain fields.
const copy = (ledger) => Object.assign(Object.create(Ledger.prototype), ledger);

// One step of the walk with rests, by the rule describe() in js/route.js
// uses: before a step, rest if the stored heat is near the limit.
function advance(state, s) {
  if (state.ledger.needsRest) {
    state.ledger.rest();
    state.rests++;
  }
  state.ledger.add(s);
}

// Runs the whole grid for one load. Returns the three layers.
function reachFor(loadKg) {
  const outStep = new Array(n);
  const homeStep = new Array(n);
  for (const c of order) {
    if (c !== home) {
      outStep[c] = stepBetween(out.prev[c], c, loadKg);
      homeStep[c] = stepBetween(c, next[c], loadKg);
    }
  }
  // Body state on arrival at each cell: with rests and without.
  const restedAt = new Array(n);
  const plainAt = new Array(n);
  restedAt[home] = { ledger: new Ledger(), rests: 0 };
  plainAt[home] = new Ledger();
  for (const c of order) {
    if (c === home) continue;
    const p = out.prev[c];
    const rested = { ledger: copy(restedAt[p].ledger), rests: restedAt[p].rests };
    advance(rested, outStep[c]);
    restedAt[c] = rested;
    const plain = copy(plainAt[p]);
    plain.add(outStep[c]);
    plainAt[c] = plain;
  }
  const rests = new Uint8Array(n).fill(NO_ROUTE);
  const heat = new Uint8Array(n).fill(NO_ROUTE);
  const minutes = new Uint8Array(n).fill(NO_ROUTE);
  const exact = { rests: new Uint16Array(n), heat: new Float32Array(n), minutes: new Float32Array(n) };
  let steps = 0;
  for (const c of order) {
    const rested = { ledger: copy(restedAt[c].ledger), rests: restedAt[c].rests };
    const plain = copy(plainAt[c]);
    for (let u = c; u !== home; u = next[u]) {
      advance(rested, homeStep[u]);
      plain.add(homeStep[u]);
      steps++;
    }
    exact.rests[c] = rested.rests;
    exact.heat[c] = plain.peakHeatKJkg;
    exact.minutes[c] = rested.ledger.seconds / 60;
    rests[c] = Math.min(CAP, rested.rests);
    heat[c] = Math.min(CAP, Math.round(plain.peakHeatKJkg * HEAT_SCALE));
    minutes[c] = Math.min(CAP, Math.round(rested.ledger.seconds / 60));
  }
  return { rests, heat, minutes, exact, steps };
}

const results = {};
const counts = {};
for (const loadKg of LOADS_KG) {
  const t0 = Date.now();
  const r = reachFor(loadKg);
  results[loadKg] = r;
  const k = { 0: 0, 1: 0, 2: 0, 3: 0, '4+': 0, noRoute: 0 };
  let maxRests = 0, maxMin = 0, maxHeat = 0, capped = 0;
  for (let c = 0; c < n; c++) {
    if (!reachable[c]) { k.noRoute++; continue; }
    const v = r.exact.rests[c];
    k[v >= 4 ? '4+' : v]++;
    maxRests = Math.max(maxRests, v);
    maxMin = Math.max(maxMin, r.exact.minutes[c]);
    maxHeat = Math.max(maxHeat, r.exact.heat[c]);
    if (r.exact.minutes[c] > CAP + 0.5 || r.exact.heat[c] * HEAT_SCALE > CAP + 0.5) capped++;
  }
  counts[loadKg] = { ...k, maxRests, maxMinutes: Number(maxMin.toFixed(1)), maxPeakHeatNoRestKJkg: Number(maxHeat.toFixed(2)), cappedCells: capped };
  console.log(`${loadKg} kg: rests 0: ${k[0]}, 1: ${k[1]}, 2: ${k[2]}, 3: ${k[3]}, 4 or more: ${k['4+']}, no route: ${k.noRoute}`
    + ` (most rests ${maxRests}, longest ${maxMin.toFixed(0)} min, highest no-rest peak ${maxHeat.toFixed(2)} kJ/kg, capped ${capped};`
    + ` ${(r.steps / 1e6).toFixed(1)} M steps home, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

// One file holds every layer, gzip-compressed (the raw layers are 1.65 MB).
// Layer order: for each load in turn, rests, heat, minutes.
const layers = [];
for (const loadKg of LOADS_KG) layers.push(results[loadKg].rests, results[loadKg].heat, results[loadKg].minutes);
const rawBin = Buffer.concat(layers.map((a) => Buffer.from(a.buffer)));
const dir = `${root}/data/reach`;
fs.mkdirSync(dir, { recursive: true });
const binFile = 'reach.bin.gz';
fs.writeFileSync(`${dir}/${binFile}`, zlib.gzipSync(rawBin, { level: 9 }));
const meta = {
  what: 'What a walk from the habitat to each cell and straight back costs the body, by the body-cost route (least walking energy, refusing ground steeper than the walking measurements), for each carried load: the rests the planner adds, the peak stored heat if the walker never rests, and the time with the rests. Made with the model in js/body.js; no radiation, no comms.',
  method: 'One search from the habitat gives the cheapest path to every cell and one search toward the habitat gives the cheapest way home from every cell, both with the pricing planWalk uses. The body state is carried along the outward tree and then along the way home from each cell, with the same rest rule as planWalk (rest before a step when stored heat reaches 90% of the limit).',
  made_by: 'tools/reach.mjs',
  date: new Date().toISOString().slice(0, 10),
  habitat: { lat: walk.habitat.lat, lon: walk.habitat.lon },
  cols, rows, pixel_m: px,
  bounds: terrain.bounds,
  // The same numbers Terrain.toCell uses, so a lookup finds the same cell.
  x_left_m: demMeta.x_left_m, y_top_m: demMeta.y_top_m, radius_m: demMeta.radius_m,
  grid: 'Same cells as data/dem_boxwork_4m.json: row-major from the north-west corner.',
  loads_kg: LOADS_KG,
  file: binFile,
  file_encoding: `gzip of ${LOADS_KG.length * 3} uint8 layers of cols x rows bytes each, in this order: for each load in loads_kg, rests, heat, minutes.`,
  layers: {
    rests: 'Number of rests the planner adds, as is. 255 = no route.',
    heat: 'Peak stored body heat with no rest, kJ/kg x 20, rounded, capped at 254. 255 = no route.',
    minutes: 'Total time with the planned rests, minutes, rounded, capped at 254. 255 = no route.',
  },
  counts,
};
fs.writeFileSync(`${dir}/reach.json`, JSON.stringify(meta, null, 1));
console.log(`data/reach/${binFile} ${fs.statSync(`${dir}/${binFile}`).size} bytes (raw ${rawBin.length}), data/reach/reach.json ${fs.statSync(`${dir}/reach.json`).size} bytes`);
console.log(`run time ${((Date.now() - started) / 1000).toFixed(1)} s`);

// --check: plan 40 cells with the real planWalk and compare.
if (process.argv.includes('--check')) {
  const skyMeta = readJson('shielding/boxwork_sky_blocked.json');
  const sky = new Sky(skyMeta, new Uint8Array(readBytes(`shielding/${skyMeta.file}`)));
  // A fixed pseudo-random sequence (a linear congruential generator), so
  // the cells are the same every run.
  let seed = 20261114;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  // One cell in each block of a 5 x 8 division of the grid.
  const cells = [];
  for (let br = 0; br < 8; br++) {
    for (let bc = 0; bc < 5; bc++) {
      const c = Math.floor((bc + random()) * cols / 5);
      const r = Math.floor((br + random()) * rows / 8);
      cells.push(r * cols + c);
    }
  }
  const backs = Object.fromEntries(LOADS_KG.map((l) => [l, returnCost(terrain, walk.habitat, l)]));
  const worst = { rests: 0, heat: 0, minutes: 0, storedHeat: 0, storedMinutes: 0 };
  let disagree = 0, runs = 0;
  console.log('\ncell (col,row)  load  rests map/plan  no-rest peak kJ/kg map/plan  minutes map/plan');
  cells.forEach((cell, i) => {
    const c = cell % cols, r = (cell - c) / cols;
    const loads = i < 10 ? LOADS_KG : [LOADS_KG[i % 3]];
    for (const loadKg of loads) {
      const { lat, lon } = terrain.toLatLon(c, r);
      const route = planWalk(terrain, { habitat: walk.habitat, stops: [{ lat, lon }] }, 'body', backs[loadKg], sky, { loadKg });
      const m = results[loadKg];
      runs++;
      const label = `(${c},${r})`.padEnd(14) + `${loadKg}`.padStart(4) + ' kg';
      if (!route || !reachable[cell]) {
        if (!!route !== !!reachable[cell]) disagree++;
        console.log(`${label}  map ${reachable[cell] ? 'route' : 'no route'}, planWalk ${route ? 'route' : 'no route'}`);
        continue;
      }
      const t = route.totals;
      const mapRests = m.exact.rests[cell], mapHeat = m.exact.heat[cell], mapMin = m.exact.minutes[cell];
      const planMin = t.seconds / 60;
      if (mapRests !== t.restCount) disagree++;
      worst.rests = Math.max(worst.rests, Math.abs(mapRests - t.restCount));
      worst.heat = Math.max(worst.heat, Math.abs(mapHeat - t.peakHeatNoRest));
      worst.minutes = Math.max(worst.minutes, Math.abs(mapMin - planMin));
      worst.storedHeat = Math.max(worst.storedHeat, Math.abs(m.heat[cell] / HEAT_SCALE - t.peakHeatNoRest));
      worst.storedMinutes = Math.max(worst.storedMinutes, Math.abs(m.minutes[cell] - planMin));
      console.log(`${label}  ${mapRests}/${t.restCount}`.padEnd(38) + `${mapHeat.toFixed(3)}/${t.peakHeatNoRest.toFixed(3)}`.padEnd(28) + `${mapMin.toFixed(2)}/${planMin.toFixed(2)}`);
    }
  });
  console.log(`\n${runs} plans over ${cells.length} cells. Largest difference: rests ${worst.rests}, no-rest peak heat ${worst.heat.toFixed(4)} kJ/kg, minutes ${worst.minutes.toFixed(3)}.`
    + ` As stored (rounded): heat ${worst.storedHeat.toFixed(3)} kJ/kg, minutes ${worst.storedMinutes.toFixed(2)}. Plans that disagree on rests or on whether there is a route: ${disagree}.`);
  console.log(`run time with check ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
