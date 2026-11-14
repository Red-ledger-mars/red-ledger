// Plans the routes once and stores them, so the page opens at once instead
// of searching the terrain every time it loads. For each carried load it
// stores the two routes, with the rest stops the heat limit forces.
// The page still carries the search (js/route.js) and can run it itself.
//
// Usage: node tools/plan_routes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Terrain } = await import(`${root}/js/terrain.js`);
const { Sky } = await import(`${root}/js/sky.js`);
const { planWalk, returnCost } = await import(`${root}/js/route.js`);

export const LOADS_KG = [0, 15, 30];

const readJson = (file) => JSON.parse(fs.readFileSync(`${root}/data/${file}`));
const readBytes = (file) => fs.readFileSync(`${root}/data/${file}`);

const demMeta = readJson('dem_boxwork_4m.json');
const demBytes = readBytes(demMeta.file);
const raw = new Uint16Array(demBytes.buffer, demBytes.byteOffset, demBytes.length / 2);
const terrain = new Terrain(demMeta, Float32Array.from(raw, (v) => (v === demMeta.nodata ? NaN : demMeta.base_m + v / 100)));

const skyMeta = readJson('shielding/boxwork_sky_blocked.json');
const sky = new Sky(skyMeta, new Uint8Array(readBytes(`shielding/${skyMeta.file}`)));

const walk = readJson('walk.json');
const round = (v, d) => Number(v.toFixed(d));
const out = {
  note: 'Made by tools/plan_routes.mjs from data/walk.json, the elevation crop and the sky-blocked grid, with the model in js/body.js. Delete this file to make the page plan the routes itself.',
  loadsKg: LOADS_KG,
  loads: {},
};
for (const loadKg of LOADS_KG) {
  const back = returnCost(terrain, walk.habitat, loadKg);
  out.loads[loadKg] = {};
  for (const pricing of ['direct', 'body']) {
    const route = planWalk(terrain, walk, pricing, back, sky, { loadKg });
    route.points = route.points.map((p) => ({
      lat: round(p.lat, 6), lon: round(p.lon, 6), elev: round(p.elev, 2), gradient: round(p.gradient, 4), dist: round(p.dist, 1),
      seconds: round(p.seconds, 1), kcal: round(p.kcal, 2), heat: round(p.heat, 3), dose: round(p.dose, 3), skyPct: p.skyPct,
      speed: round(p.speed, 3), metabolicW: round(p.metabolicW, 0), backKcal: round(p.backKcal, 2),
    }));
    out.loads[loadKg][pricing] = route;
    const t = route.totals;
    console.log(`${loadKg} kg ${pricing.padEnd(6)} ${(t.dist / 1000).toFixed(2)} km, ${(t.seconds / 60).toFixed(0)} min with ${t.restCount} rest(s) of ${(t.restSeconds / 60).toFixed(1)} min, peak heat if never resting ${t.peakHeatNoRest.toFixed(2)} kJ/kg, ${t.kcal.toFixed(0)} kcal`);
  }
}
fs.writeFileSync(`${root}/data/routes.json`, JSON.stringify(out));
console.log('data/routes.json', fs.statSync(`${root}/data/routes.json`).size, 'bytes');
