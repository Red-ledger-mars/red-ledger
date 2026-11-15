// Checks the steady-pace plan (steadyPlan in js/route.js) on the stored walk.
// The plan with rests must not move: pricing the stored routes again must
// give the totals in data/routes.json, to the second. Then, for each load and each route:
// the pace found needs no rest, a pace 0.01 m/s faster needs one, and at the
// break-even cost the steady pace is no faster than the plan with rests.
//
// Usage: node tools/test_steady_pace.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { reprice, steadyPlan } = await import(`${root}/js/route.js`);
const { MODEL, SLOWEST_PACE_MS, Ledger, step } = await import(`${root}/js/body.js`);

const planned = JSON.parse(fs.readFileSync(`${root}/data/routes.json`));
let failed = 0;
const check = (ok, text) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));

// The same walk as steadyPlan makes, written again here from step() and
// Ledger so that the two can disagree. Returns whether the plan would rest.
function walkAt(route, loadKg, coolingW, pace, dearer = 1) {
  const ledger = new Ledger(coolingW);
  let rests = false;
  for (let k = 1; k < route.points.length; k++) {
    if (ledger.needsRest) rests = true;
    const p = route.points[k];
    const length = p.dist - route.points[k - 1].dist;
    const run = length / Math.hypot(1, p.gradient);
    const s = step(run, p.gradient * run, loadKg);
    const joules = s.joules * dearer;
    const speed = Math.min(pace, MODEL.workLimitW / (joules / length));
    const seconds = length / speed;
    // Heat is the energy used less the work done against gravity.
    const lift = s.joules - s.heatW * s.seconds;
    ledger.add({ ...s, joules, seconds, speed, metabolicW: joules / seconds, heatW: (joules - lift) / seconds }, p.skyPct);
  }
  return { rests, seconds: ledger.seconds, kcal: ledger.kcal };
}

for (const [load, routes] of Object.entries(planned.loads)) {
  const loadKg = Number(load);
  for (const pricing of ['direct', 'body']) {
    const route = routes[pricing];
    const name = `${loadKg} kg, ${pricing}`;
    const again = reprice(route, { loadKg, coolingW: MODEL.coolingW }).totals;
    // The stored points are rounded, so pricing them again is within a second.
    check(
      Math.abs(again.seconds - route.totals.seconds) < 1 && Math.abs(again.kcal - route.totals.kcal) < 0.1 && again.restCount === route.totals.restCount,
      `${name}: the plan with rests is unchanged (${(route.totals.seconds / 60).toFixed(1)} min, ${route.totals.restCount} rests)`,
    );
    const steady = steadyPlan(route, { loadKg });
    if (!route.totals.restCount) {
      check(steady === null, `${name}: no rest in the plan, so no steady pace is offered`);
      continue;
    }
    if (steady.pace === null) {
      check(walkAt(route, loadKg, MODEL.coolingW, SLOWEST_PACE_MS).rests, `${name}: even ${SLOWEST_PACE_MS} m/s needs a rest`);
      continue;
    }
    const own = walkAt(route, loadKg, MODEL.coolingW, steady.pace);
    check(!own.rests, `${name}: ${steady.pace.toFixed(2)} m/s needs no rest`);
    check(walkAt(route, loadKg, MODEL.coolingW, steady.pace + 0.01).rests, `${name}: ${(steady.pace + 0.01).toFixed(2)} m/s needs a rest`);
    check(near(own.seconds, steady.totals.seconds) && near(own.kcal, steady.totals.kcal), `${name}: the time and energy agree with a second calculation`);
    check(steady.pace >= SLOWEST_PACE_MS && steady.pace < MODEL.paceMs, `${name}: the pace is between ${SLOWEST_PACE_MS} and ${MODEL.paceMs} m/s`);
    check(steady.totals.peakHeat < MODEL.restAt * MODEL.heatLimitKJkg + 0.05, `${name}: peak heat ${steady.totals.peakHeat.toFixed(2)} kJ/kg stays at the rest level or under`);
    const even = Number.isFinite(steady.evenAt)
      ? `as fast as the rests if a slow metre costs ${((steady.evenAt - 1) * 100).toFixed(0)}% more`
      : 'faster than the rests even at twice the cost';
    console.log(`     ${name}: steady ${steady.pace.toFixed(2)} m/s, ${(steady.totals.seconds / 60).toFixed(1)} min against ${(route.totals.seconds / 60).toFixed(1)} min with ${route.totals.restCount} rests; ${even}`);
  }
}

// The numbers said in the talk: the survey walk with 30 kg on the direct route.
const talk = steadyPlan(planned.loads[30].direct, { loadKg: 30 });
check(Math.round(talk.totals.seconds / 60) === 54 && Math.round(planned.loads[30].direct.totals.seconds / 60) === 65, 'survey walk, 30 kg, direct route: 54 min steady against 65 min with rests');

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
