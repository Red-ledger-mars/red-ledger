// Route finding on the elevation grid, and the per-step record of a route.

import { walkCostMars, step, Ledger, MODEL, MAX_MEASURED_GRADIENT, JOULES_PER_KCAL, totalMassKg } from './body.js';

// Steps to the 16 nearest cells, so a path can head in 16 directions.
const MOVES = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
];

// Two ways to price one step of `run` metres along the ground that rises
// `rise` metres. A step that returns Infinity cannot be taken.
export const PRICING = {
  // What a normal map optimises: the shortest way over the surface.
  direct: (run, rise) => Math.hypot(run, rise),
  // Walking energy at Mars gravity. Steps steeper than anything in the
  // walking measurements are refused.
  body: (run, rise) => (Math.abs(rise / run) > MAX_MEASURED_GRADIENT ? Infinity : walkCostMars(rise / run) * Math.hypot(run, rise)),
};

class MinHeap {
  constructor() { this.ids = []; this.keys = []; }
  get size() { return this.ids.length; }
  push(id, key) {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop() {
    const { ids, keys } = this;
    const top = [ids[0], keys[0]];
    const id = ids.pop();
    const key = keys.pop();
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        ids[i] = ids[c]; keys[i] = keys[c];
        i = c;
      }
      ids[i] = id; keys[i] = key;
    }
    return top;
  }
}

// Cheapest cost from one cell to every other under a pricing function
// (Dijkstra). With a `goal` the search stops as soon as it is reached.
function search(terrain, start, goal, price) {
  const { cols, rows, px, z } = terrain;
  const best = new Float64Array(cols * rows).fill(Infinity);
  const prev = new Int32Array(cols * rows).fill(-1);
  const heap = new MinHeap();
  best[start] = 0;
  heap.push(start, 0);
  while (heap.size) {
    const [u, d] = heap.pop();
    if (d > best[u]) continue;
    if (u === goal) break;
    const uc = u % cols;
    const ur = (u - uc) / cols;
    for (const [dc, dr] of MOVES) {
      const vc = uc + dc;
      const vr = ur + dr;
      if (vc < 0 || vr < 0 || vc >= cols || vr >= rows) continue;
      const v = vr * cols + vc;
      const w = price(Math.hypot(dc, dr) * px, z[v] - z[u]);
      if (!(w < Infinity)) continue;
      if (d + w < best[v]) {
        best[v] = d + w;
        prev[v] = u;
        heap.push(v, d + w);
      }
    }
  }
  return { best, prev };
}

// Cheapest path between two cells: a list of cell indexes from start to
// goal, or null if there is none.
function cheapestPath(terrain, start, goal, price) {
  const { best, prev } = search(terrain, start, goal, price);
  if (best[goal] === Infinity) return null;
  const path = [];
  for (let u = goal; u !== -1; u = prev[u]) path.push(u);
  return path.reverse();
}

// For every cell, the least walking energy (kcal) needed to get from there
// back to `home`. Found by searching outward from home with each step
// priced in the opposite direction, because uphill and downhill differ.
export function returnCost(terrain, home, loadKg = 0) {
  const { best } = search(terrain, cellOf(terrain, home), -1, (run, rise) => PRICING.body(run, -rise));
  const scale = totalMassKg(loadKg) / JOULES_PER_KCAL;
  return best.map((jPerKg) => jPerKg * scale);
}

function cellOf(terrain, point) {
  const { col, row } = terrain.toCell(point.lat, point.lon);
  return Math.floor(row) * terrain.cols + Math.floor(col);
}

// Plans the whole walk (habitat, each stop in order, back to the habitat)
// under one pricing, and records every step of it.
// `options.loadKg` is the mass carried. With `options.rests` the walker
// stops to cool down whenever stored heat nears the limit; without it the
// record shows what the heat would do if the walker never stopped.
export function planWalk(terrain, walk, pricing, back, sky, options = {}) {
  const places = [walk.habitat, ...walk.stops, walk.habitat];
  const cells = [];
  const stopAt = []; // index into `cells` where each place is reached
  for (let i = 0; i < places.length - 1; i++) {
    const leg = cheapestPath(terrain, cellOf(terrain, places[i]), cellOf(terrain, places[i + 1]), PRICING[pricing]);
    if (!leg) return null;
    if (i > 0) leg.shift();
    if (i === 0) stopAt.push(0);
    cells.push(...leg);
    stopAt.push(cells.length - 1);
  }
  const stops = stopAt.map((index, i) => ({ index, place: places[i] }));
  const route = describe(terrain, cells, stops, back, sky, { loadKg: options.loadKg ?? 0, rests: options.rests ?? true });
  if (options.rests ?? true) {
    // The same walk with no rests, to show what the planner prevented.
    const unrested = describe(terrain, cells, stops, back, sky, { loadKg: options.loadKg ?? 0, rests: false });
    route.totals.peakHeatNoRest = unrested.totals.peakHeat;
    route.totals.secondsNoRest = unrested.totals.seconds;
    route.totals.overHeatLimitM = unrested.totals.overHeatLimitM;
  }
  return route;
}

// Turns a list of cells into points that carry the state of the body there.
function describe(terrain, cells, stops, back, sky, { loadKg, rests }) {
  const { cols, px, z } = terrain;
  const ledger = new Ledger();
  const points = [];
  let dist = 0;
  let climb = 0;
  let descent = 0;
  let steepest = 0;
  let beyondMeasured = 0;
  let now = { speed: MODEL.paceMs, metabolicW: 0, heatW: 0 };
  const restStops = []; // where the walker stood still to cool down
  let restSeconds = 0;
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k] % cols;
    const r = (cells[k] - c) / cols;
    let gradient = 0;
    const { lat, lon } = terrain.toLatLon(c, r);
    const skyPct = sky?.at(lat, lon) ?? MODEL.skyReferencePct;
    if (k > 0) {
      const pc = cells[k - 1] % cols;
      const pr = (cells[k - 1] - pc) / cols;
      const run = Math.hypot(c - pc, r - pr) * px;
      const rise = z[cells[k]] - z[cells[k - 1]];
      gradient = rise / run;
      if (rests && ledger.needsRest) {
        const seconds = ledger.rest(skyPct);
        restSeconds += seconds;
        restStops.push({ dist, seconds, lat: points[k - 1].lat, lon: points[k - 1].lon });
      }
      now = step(run, rise, loadKg);
      ledger.add(now, skyPct);
      dist += now.length;
      if (rise > 0) climb += rise; else descent -= rise;
      steepest = Math.max(steepest, Math.abs(gradient));
      if (Math.abs(gradient) > MAX_MEASURED_GRADIENT) beyondMeasured += run;
    }
    points.push({
      lat,
      lon,
      elev: z[cells[k]],
      gradient,
      dist,
      seconds: ledger.seconds,
      kcal: ledger.kcal,
      heat: ledger.heatKJkg,
      dose: ledger.doseUSv,
      skyPct,
      speed: now.speed,
      metabolicW: now.metabolicW,
      // Energy still needed to walk home from here by the cheapest way.
      backKcal: back[cells[k]],
    });
  }
  return {
    points,
    stops: stops.map((s) => ({ ...s, dist: points[s.index].dist })),
    restStops,
    totals: {
      dist,
      climb,
      descent,
      seconds: ledger.seconds,
      kcal: ledger.kcal,
      peakHeat: ledger.peakHeatKJkg,
      restSeconds,
      restCount: restStops.length,
      overHeatLimitM: ledger.overLimitM,
      dose: ledger.doseUSv,
      steepestDeg: Math.atan(steepest) * 180 / Math.PI,
      // Metres walked on ground steeper than any walking measurement covers.
      beyondMeasured,
    },
  };
}

// The point reached after walking `dist` metres along a described route.
export function pointAt(route, dist) {
  const pts = route.points;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].dist < dist) lo = mid + 1; else hi = mid;
  }
  return pts[lo];
}
