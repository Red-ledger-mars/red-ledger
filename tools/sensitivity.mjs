// What decides a walk: the route, or the suit? For each ready-made walk this
// plans the body-cost route once, then prices it again for a range of suit
// cooling and for the three values of the suit factor found when the model
// was tested against NASA's measurements of people (low, middle, high).
// It writes the rests the plan adds and the time of the walk to
// data/validation/sensitivity.json, which the test sheet on the page shows.
//
// Usage: node tools/sensitivity.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Terrain } = await import(`${root}/js/terrain.js`);
const { Sky } = await import(`${root}/js/sky.js`);
const { planWalk, returnCost, reprice } = await import(`${root}/js/route.js`);
const { MODEL, SUIT_FACTOR, SUIT_FACTOR_RANGE } = await import(`${root}/js/body.js`);

const readJson = (file) => JSON.parse(fs.readFileSync(`${root}/data/${file}`));
const readBytes = (file) => fs.readFileSync(`${root}/data/${file}`);

const demMeta = readJson('dem_boxwork_4m.json');
const demBytes = readBytes(demMeta.file);
const raw = new Uint16Array(demBytes.buffer, demBytes.byteOffset, demBytes.length / 2);
const terrain = new Terrain(demMeta, Float32Array.from(raw, (v) => (v === demMeta.nodata ? NaN : demMeta.base_m + v / 100)));
const skyMeta = readJson('shielding/boxwork_sky_blocked.json');
const sky = new Sky(skyMeta, new Uint8Array(readBytes(`shielding/${skyMeta.file}`)));

const stored = readJson('walk.json');
const ready = readJson('walks.json');
const places = { ...ready.places, ...Object.fromEntries(stored.stops.map((stop) => [stop.id, stop])) };

export const LOAD_KG = 30;
export const COOLING_W = [300, 370, 450, 550];
const FACTORS = [
  { id: 'low', factor: SUIT_FACTOR_RANGE[0] },
  { id: 'middle', factor: SUIT_FACTOR },
  { id: 'high', factor: SUIT_FACTOR_RANGE[1] },
];

const back = returnCost(terrain, stored.habitat, LOAD_KG);
const out = {
  what: 'Rests the plan adds, and minutes for the whole walk, for each ready-made walk on its body-cost route, carrying 30 kg, as the suit cooling and the suit factor change. One route per walk: only the suit differs between cells.',
  made_by: 'tools/sensitivity.mjs',
  load_kg: LOAD_KG,
  cooling_w: COOLING_W,
  model_cooling_w: MODEL.coolingW,
  factors: FACTORS,
  walks: [],
};
for (const walk of ready.walks) {
  const stops = walk.stored ? stored.stops : walk.stops.map((id) => places[id]);
  const route = planWalk(terrain, { habitat: stored.habitat, stops }, 'body', back, sky, { loadKg: LOAD_KG });
  const direct = planWalk(terrain, { habitat: stored.habitat, stops }, 'direct', back, sky, { loadKg: LOAD_KG });
  const cell = (priced) => ({ rests: priced.totals.restCount, minutes: Math.round(priced.totals.seconds / 60) });
  const rows = FACTORS.map(({ id, factor }) => ({
    factor: id,
    cells: COOLING_W.map((coolingW) => cell(reprice(route, { loadKg: LOAD_KG, coolingW, suitFactor: factor }))),
  }));
  out.walks.push({
    id: walk.id,
    name: walk.name,
    km: Number((route.totals.dist / 1000).toFixed(2)),
    // What the choice of route changes at the model's own suit, for comparison.
    route_choice: { body: cell(route), direct: cell(direct) },
    rows,
  });
  console.log(`${walk.name} (${(route.totals.dist / 1000).toFixed(2)} km): direct ${direct.totals.restCount} rests, body ${route.totals.restCount} rests at ${MODEL.coolingW} W`);
  for (const row of rows) console.log(`   ${row.factor.padEnd(6)} ${row.cells.map((c, i) => `${COOLING_W[i]} W: ${c.rests} rests, ${c.minutes} min`).join(' | ')}`);
}
fs.writeFileSync(`${root}/data/validation/sensitivity.json`, JSON.stringify(out, null, 1) + '\n');
console.log('data/validation/sensitivity.json written');
