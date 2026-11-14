// Second test of the body model, made after the first one failed.
//
// The first test (tools/test_body_model.mjs, method committed before the
// data was collected) used only level-ground measurements, because the
// sloped ones do not give one speed per condition. It set the suit
// correction. This script then checks the revised model (walkCostSuited in
// js/body.js) against the sloped measurements, which played no part in
// setting that correction.
//
// The reports give the sloped walking speed only as a range across subjects
// (0.56 to 0.97 m/s), so each prediction is given for the slowest, the
// middle and the fastest speed.
//
// Usage: node tools/test_body_model_slopes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { walkPowerW, walkPowerSuitedW } = await import(`${root}/js/body.js`);
const data = JSON.parse(fs.readFileSync(`${root}/data/validation/human_walking.json`));

const SPEEDS = { low: 0.56, mid: 0.765, high: 0.97 }; // m/s, range reported in NASA/TP-2010-216125
const round = (v, d = 2) => Number(v.toFixed(d));
const median = (list) => { const s = [...list].sort((a, b) => a - b); const m = (s.length - 1) / 2; return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2; };

const rows = [];
for (const p of data.points) {
  if (!p.suited || !p.grade_percent || p.measured_w == null || p.gravity_g == null) continue;
  const massKg = p.total_mass_kg ?? p.body_mass_kg + p.suit_mass_kg;
  const at = (speed, fn) => fn({ gradient: p.grade_percent / 100, speed, massKg, g: p.gravity_g });
  rows.push({
    id: p.id,
    gravity_g: round(p.gravity_g, 3),
    grade_percent: p.grade_percent,
    measured_w: p.measured_w,
    first_model_w: Math.round(at(SPEEDS.mid, walkPowerW)),
    first_model_ratio: round(p.measured_w / at(SPEEDS.mid, walkPowerW), 3),
    revised_w: { low: Math.round(at(SPEEDS.low, walkPowerSuitedW)), mid: Math.round(at(SPEEDS.mid, walkPowerSuitedW)), high: Math.round(at(SPEEDS.high, walkPowerSuitedW)) },
    revised_ratio: round(p.measured_w / at(SPEEDS.mid, walkPowerSuitedW), 3),
    measured_inside_speed_band: p.measured_w >= at(SPEEDS.low, walkPowerSuitedW) && p.measured_w <= at(SPEEDS.high, walkPowerSuitedW),
  });
}

const result = {
  what: 'The revised body model set against suited walking on slopes of 10, 20 and 30 percent at 0.12, 0.17 and 0.32 of Earth gravity (NASA/TP-2010-216125, values read from the report\'s plotted lines). These points were not used to set the suit correction. ratio = measured / predicted at the middle speed.',
  speeds_m_s: SPEEDS,
  first_model: { median_ratio: round(median(rows.map((r) => r.first_model_ratio)), 3), lowest: Math.min(...rows.map((r) => r.first_model_ratio)), highest: Math.max(...rows.map((r) => r.first_model_ratio)) },
  revised_model: { median_ratio: round(median(rows.map((r) => r.revised_ratio)), 3), lowest: Math.min(...rows.map((r) => r.revised_ratio)), highest: Math.max(...rows.map((r) => r.revised_ratio)), inside_speed_band: rows.filter((r) => r.measured_inside_speed_band).length, points: rows.length },
  cautions: [
    'The revision was made after seeing these measurements; the fit is a check of consistency, not a blind prediction.',
    'The measured values were read off plotted trend lines (about 1 ml/kg/min reading error) and the speed is known only as a range.',
    'The report\'s authors say the rig that offloads weight probably helped the suited subjects on slopes.',
    'All measurements are at lunar-like gravity; none of the sloped ones is at Mars gravity.',
  ],
  rows,
};
fs.writeFileSync(`${root}/data/validation/model_revised_vs_measured.json`, JSON.stringify(result, null, 1));
console.log('first model on slopes:  ', JSON.stringify(result.first_model));
console.log('revised model on slopes:', JSON.stringify(result.revised_model));
for (const r of rows) console.log(r.id.padEnd(30), `g ${r.gravity_g}`, `${r.grade_percent}%`, `measured ${r.measured_w} W`, `first ${r.first_model_w} (x${r.first_model_ratio})`, `revised ${r.revised_w.low}-${r.revised_w.mid}-${r.revised_w.high} (x${r.revised_ratio})`, r.measured_inside_speed_band ? 'inside' : 'OUTSIDE');
