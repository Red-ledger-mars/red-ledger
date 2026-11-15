// Route finding on the elevation grid, and the per-step record of a route.

import { walkCostMars, step, Ledger, MODEL, MAX_MEASURED_GRADIENT, JOULES_PER_KCAL, totalMassKg, SUIT_FACTOR_RANGE, SLOWEST_PACE_MS } from './body.js';

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
// Exported for tools/reach.mjs, which reads the whole tree of paths.
export function search(terrain, start, goal, price) {
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

export function cellOf(terrain, point) {
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
  const loadKg = options.loadKg ?? 0;
  const route = describe(terrain, cells, stops, back, sky, { loadKg, rests: options.rests ?? true, suitFactor: options.suitFactor, coolingW: options.coolingW });
  if (options.rests ?? true) {
    // The same walk with no rests, to show what the planner prevented.
    const peak = (extra) => describe(terrain, cells, stops, back, sky, { loadKg, rests: false, ...extra }).totals;
    const unrested = peak({});
    route.totals.peakHeatNoRest = unrested.peakHeat;
    route.totals.secondsNoRest = unrested.seconds;
    route.totals.overHeatLimitM = unrested.overHeatLimitM;
    // The same peak at each end of the spread found when the model was
    // tested against people.
    route.totals.peakHeatRange = SUIT_FACTOR_RANGE.map((suitFactor) => peak({ suitFactor }).peakHeat);
    // The least cooling a suit would need for this walk to stay under the
    // heat limit with no rest, found by halving the interval.
    let low = MODEL.restW;
    let high = 1200;
    for (let i = 0; i < 14; i++) {
      const mid = (low + high) / 2;
      if (peak({ coolingW: mid }).peakHeat > MODEL.heatLimitKJkg) low = mid; else high = mid;
    }
    route.totals.coolingNeededW = Math.ceil(high);
  }
  return route;
}

// Turns a list of cells into points that carry the state of the body there.
function describe(terrain, cells, stops, back, sky, { loadKg, rests, suitFactor, coolingW }) {
  const { cols, px, z } = terrain;
  const ledger = new Ledger(coolingW);
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
      now = step(run, rise, loadKg, suitFactor);
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

// The same route walked under another suit: a different cooling limit, or
// another value of the suit factor. The path is kept; the body state along
// it is worked out again with the rest rule of describe(). Each step is
// rebuilt from the stored length and gradient of the route's points, so a
// route read from data/routes.json can be priced again without the terrain.
// The cooling a suit needs for no rest does not depend on the suit, and is
// kept from the route as planned.
export function reprice(route, { loadKg = 0, coolingW = MODEL.coolingW, suitFactor } = {}) {
  const walk = (options) => {
    const ledger = new Ledger(options.coolingW);
    const points = [];
    const restStops = [];
    let restSeconds = 0;
    let now = { speed: MODEL.paceMs, metabolicW: 0 };
    route.points.forEach((p, k) => {
      if (k > 0) {
        const length = p.dist - route.points[k - 1].dist;
        const run = length / Math.hypot(1, p.gradient);
        if (options.rests && ledger.needsRest) {
          const seconds = ledger.rest(p.skyPct);
          restSeconds += seconds;
          restStops.push({ dist: route.points[k - 1].dist, seconds, lat: route.points[k - 1].lat, lon: route.points[k - 1].lon });
        }
        now = step(run, p.gradient * run, loadKg, options.suitFactor);
        ledger.add(now, p.skyPct);
      }
      points.push({ ...p, seconds: ledger.seconds, kcal: ledger.kcal, heat: ledger.heatKJkg, dose: ledger.doseUSv, speed: now.speed, metabolicW: now.metabolicW });
    });
    return { ledger, points, restStops, restSeconds };
  };
  const rested = walk({ coolingW, suitFactor, rests: true });
  const unrested = walk({ coolingW, suitFactor, rests: false });
  return {
    ...route,
    points: rested.points,
    restStops: rested.restStops,
    stops: route.stops.map((stop) => ({ ...stop, dist: rested.points[stop.index].dist })),
    totals: {
      ...route.totals,
      seconds: rested.ledger.seconds,
      kcal: rested.ledger.kcal,
      peakHeat: rested.ledger.peakHeatKJkg,
      restSeconds: rested.restSeconds,
      restCount: rested.restStops.length,
      dose: rested.ledger.doseUSv,
      peakHeatNoRest: unrested.ledger.peakHeatKJkg,
      secondsNoRest: unrested.ledger.seconds,
      overHeatLimitM: unrested.ledger.overLimitM,
      peakHeatRange: SUIT_FACTOR_RANGE.map((factor) => walk({ coolingW, suitFactor: factor, rests: false }).ledger.peakHeatKJkg),
    },
  };
}

// The other way to keep heat down: the same route at one steady pace, slow
// enough that stored heat never reaches the level where the plan rests.
// `route` is a route as planned or as priced again, for the same load and
// suit. Returns null when the plan has no rest to avoid; `pace: null` when
// no pace from SLOWEST_PACE_MS up avoids every rest; otherwise the fastest
// such pace (rounded down to 0.01 m/s) and the walk at that pace.
//
// The model's cost of a metre does not depend on pace, and that is not
// tested below 1.12 m/s (SOURCES.steadyPace). So the result also carries
// `evenAt`: how many times dearer a metre of the slower walk may be before
// the steady pace takes as long as the plan with rests (Infinity when even
// twice the cost leaves it faster).
export function steadyPlan(route, { loadKg = 0, coolingW = MODEL.coolingW, suitFactor } = {}) {
  if (!route.totals.restCount) return null;
  const mass = totalMassKg(loadKg);
  // Each step at the planned pace, worked out once.
  const steps = route.points.map((p, k) => {
    if (k === 0) return null;
    const length = p.dist - route.points[k - 1].dist;
    const run = length / Math.hypot(1, p.gradient);
    const rise = p.gradient * run;
    return { length, rise, joules: step(run, rise, loadKg, suitFactor).joules };
  });
  // One walk at `pace`, with every metre costing `dearer` times the model's
  // cost. On a climb the work limit can force a slower pace still.
  const walk = (pace, dearer = 1, keep = false) => {
    const ledger = new Ledger(coolingW);
    const points = [];
    let now = { speed: pace, metabolicW: 0 };
    let rests = false;
    route.points.forEach((p, k) => {
      if (k > 0) {
        // The rest rule of describe(): checked before each step.
        if (ledger.needsRest) rests = true;
        const { length, rise } = steps[k];
        const joules = steps[k].joules * dearer;
        const speed = Math.min(pace, MODEL.workLimitW / (joules / length));
        const seconds = length / speed;
        const metabolicW = joules / seconds;
        now = { length, joules, seconds, speed, metabolicW, heatW: metabolicW - (mass * MODEL.marsGravity * rise) / seconds };
        ledger.add(now, p.skyPct);
      }
      if (keep) points.push({ ...p, seconds: ledger.seconds, kcal: ledger.kcal, heat: ledger.heatKJkg, dose: ledger.doseUSv, speed: now.speed, metabolicW: now.metabolicW });
    });
    return { ledger, points, rests };
  };
  // The fastest pace with no rest, found by halving the interval. A slower
  // pace stores less heat on every step, so there is one crossing.
  const fastest = (dearer) => {
    if (walk(SLOWEST_PACE_MS, dearer).rests) return null;
    if (!walk(MODEL.paceMs, dearer).rests) return MODEL.paceMs;
    let low = SLOWEST_PACE_MS;
    let high = MODEL.paceMs;
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      if (walk(mid, dearer).rests) high = mid; else low = mid;
    }
    // Rounding down can lose a whole 0.01 m/s when the limit lies just above
    // one, so the next hundredth is tried as well.
    const floor = Math.floor(low * 100) / 100;
    const next = Math.round(floor * 100 + 1) / 100;
    return next <= MODEL.paceMs && !walk(next, dearer).rests ? next : floor;
  };
  const pace = fastest(1);
  if (pace === null) return { pace: null };
  const steady = walk(pace, 1, true);
  // True when the steady pace, at that cost, is no faster than the rests.
  const noGain = (dearer) => {
    const slower = fastest(dearer);
    return slower === null || walk(slower, dearer).ledger.seconds >= route.totals.seconds;
  };
  let evenAt = 1;
  if (!noGain(1)) {
    let low = 1;
    let high = 2;
    if (!noGain(high)) evenAt = Infinity;
    else {
      for (let i = 0; i < 10; i++) {
        const mid = (low + high) / 2;
        if (noGain(mid)) high = mid; else low = mid;
      }
      evenAt = high;
    }
  }
  return {
    pace,
    evenAt,
    points: steady.points,
    totals: {
      seconds: steady.ledger.seconds,
      kcal: steady.ledger.kcal,
      peakHeat: steady.ledger.peakHeatKJkg,
      dose: steady.ledger.doseUSv,
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
