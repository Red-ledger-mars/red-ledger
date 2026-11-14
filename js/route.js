// Route finding on the elevation grid, and the per-step record of a route.

import { walkCostMars, MAX_MEASURED_GRADIENT, JOULES_PER_KCAL, totalMassKg } from './body.js';

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

// Cheapest path between two cells under a pricing function (Dijkstra).
// Returns a list of cell indexes from start to goal, or null if none exists.
function cheapestPath(terrain, start, goal, price) {
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
  if (best[goal] === Infinity) return null;
  const path = [];
  for (let u = goal; u !== -1; u = prev[u]) path.push(u);
  return path.reverse();
}

function cellOf(terrain, point) {
  const { col, row } = terrain.toCell(point.lat, point.lon);
  return Math.floor(row) * terrain.cols + Math.floor(col);
}

// Plans the whole walk (habitat, each stop in order, back to the habitat)
// under one pricing, and records every step of it.
export function planWalk(terrain, walk, pricing) {
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
  return describe(terrain, cells, stopAt.map((index, i) => ({ index, place: places[i] })));
}

// Turns a list of cells into points with running totals.
function describe(terrain, cells, stops) {
  const { cols, px, z } = terrain;
  const mass = totalMassKg();
  const points = [];
  let dist = 0;
  let climb = 0;
  let descent = 0;
  let joules = 0;
  let steepest = 0;
  let beyondMeasured = 0;
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k] % cols;
    const r = (cells[k] - c) / cols;
    let gradient = 0;
    if (k > 0) {
      const pc = cells[k - 1] % cols;
      const pr = (cells[k - 1] - pc) / cols;
      const run = Math.hypot(c - pc, r - pr) * px;
      const rise = z[cells[k]] - z[cells[k - 1]];
      gradient = rise / run;
      dist += Math.hypot(run, rise);
      if (rise > 0) climb += rise; else descent -= rise;
      // The measured cost is per metre walked along the slope, not per metre on the map.
      joules += walkCostMars(gradient) * Math.hypot(run, rise) * mass;
      steepest = Math.max(steepest, Math.abs(gradient));
      if (Math.abs(gradient) > MAX_MEASURED_GRADIENT) beyondMeasured += run;
    }
    const { lat, lon } = terrain.toLatLon(c, r);
    points.push({ lat, lon, elev: z[cells[k]], gradient, dist, kcal: joules / JOULES_PER_KCAL });
  }
  return {
    points,
    stops: stops.map((s) => ({ ...s, dist: points[s.index].dist })),
    totals: {
      dist,
      climb,
      descent,
      kcal: joules / JOULES_PER_KCAL,
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
