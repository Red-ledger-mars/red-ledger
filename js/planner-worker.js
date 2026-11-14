// The route search for a walk the visitor chooses, run away from the page so
// that a click on the map never freezes it.
//
// Message in:  { id, stops: [{ lat, lon, name }], loadKg }
// Messages out, all carrying the same id:
//   { kind: 'route', pricing: 'direct' | 'body', route }   one per pricing;
//       route is null when no path exists under that pricing
//   { kind: 'done', ms }
//   { kind: 'error', message }
//
// The walk is habitat -> each stop in order -> habitat, planned with the same
// code and the same body model as the walk stored in data/routes.json.

import { Terrain } from './terrain.js';
import { Sky } from './sky.js';
import { planWalk, returnCost } from './route.js';
import { energyLeftPct } from './body.js';

// A worker resolves addresses against its own file, so the data folder is
// named from here and not from the page.
const dataUrl = (file) => new URL(`../data/${file}`, import.meta.url);
const json = async (file) => (await fetch(dataUrl(file))).json();
const bytes = async (file) => (await fetch(dataUrl(file))).arrayBuffer();

async function load() {
  const demMeta = await json('dem_boxwork_4m.json');
  const raw = new Uint16Array(await bytes(demMeta.file));
  const z = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) z[i] = raw[i] === demMeta.nodata ? NaN : demMeta.base_m + raw[i] / 100;
  const skyMeta = await json('shielding/boxwork_sky_blocked.json');
  return {
    terrain: new Terrain(demMeta, z),
    sky: new Sky(skyMeta, new Uint8Array(await bytes(`shielding/${skyMeta.file}`))),
    habitat: (await json('walk.json')).habitat,
  };
}

let loaded = null;
// The cheapest way home from every cell depends on the load, and takes
// about a second to find, so it is kept for each load once made.
const backByLoad = new Map();

// True when a point lies on the elevation crop, on a cell with data and not
// on its outer edge (the search looks two cells to each side).
function onGround(terrain, { lat, lon }) {
  const { col, row } = terrain.toCell(lat, lon);
  const c = Math.floor(col);
  const r = Math.floor(row);
  return c >= 2 && r >= 2 && c < terrain.cols - 2 && r < terrain.rows - 2 && Number.isFinite(terrain.z[r * terrain.cols + c]);
}

self.onmessage = async ({ data: { id, stops, loadKg = 0 } }) => {
  const started = performance.now();
  try {
    loaded ??= load();
    const { terrain, sky, habitat } = await loaded;
    if (!stops?.length) throw new Error('A walk needs at least one stop.');
    const off = stops.find((stop) => !onGround(terrain, stop));
    if (off) throw new Error('That point is outside the surveyed patch.');
    if (!backByLoad.has(loadKg)) backByLoad.set(loadKg, returnCost(terrain, habitat, loadKg));
    const back = backByLoad.get(loadKg);
    const walk = { habitat, stops: stops.map((stop, i) => ({ id: `own-${i + 1}`, name: `Your stop ${i + 1}`, ...stop, own: stop.own ?? true })) };
    // The direct search is about three times faster, so it goes first.
    for (const pricing of ['direct', 'body']) {
      const route = planWalk(terrain, walk, pricing, back, sky, { loadKg });
      if (route) route.totals.lowestLeft = Math.min(...route.points.map((p) => energyLeftPct(p.kcal, p.backKcal)));
      self.postMessage({ id, kind: 'route', pricing, route });
    }
    self.postMessage({ id, kind: 'done', ms: Math.round(performance.now() - started) });
  } catch (error) {
    self.postMessage({ id, kind: 'error', message: error.message });
  }
};
