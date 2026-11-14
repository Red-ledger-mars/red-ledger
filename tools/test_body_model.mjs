// Sets the body model's energy claim against measurements on people.
//
// Input: data/validation/human_walking.json, measured metabolic rates of
// people walking on a treadmill in reduced gravity, with and without a
// spacesuit, taken from NASA technical reports.
// Output: data/validation/model_vs_measured.json and a printed summary.
//
// The method below was written and committed BEFORE the measurements were
// collected, so the comparison could not be shaped by its result:
//
//   predicted watts = walking cost at that slope (Minetti 2002)
//                     x gravity factor (Farley and McMahon 1992, straight line)
//                     x mass moved (body, plus suit when suited)
//                     x speed
//
// Rule fixed in advance: take the suited points. If the median of
// measured / predicted lies between 0.85 and 1.15 the model stands as it is.
// Otherwise the model is corrected by that median, and the spread between
// the 10th and 90th percentile of the ratio is carried as the uncertainty
// of every energy and heat number the page shows.
//
// Usage: node tools/test_body_model.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { walkPowerW, MAX_MEASURED_GRADIENT } = await import(`${root}/js/body.js`);

const data = JSON.parse(fs.readFileSync(`${root}/data/validation/human_walking.json`));

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
const round = (v, d = 2) => (v === null ? null : Number(v.toFixed(d)));

const rows = [];
const skipped = [];
for (const p of data.points) {
  const mass = p.suited ? (p.total_mass_kg ?? (p.body_mass_kg != null && p.suit_mass_kg != null ? p.body_mass_kg + p.suit_mass_kg : null)) : p.body_mass_kg;
  const need = { gravity_g: p.gravity_g, speed_m_s: p.speed_m_s, measured_w: p.measured_w, mass };
  const missing = Object.entries(need).filter(([, v]) => v == null).map(([k]) => k);
  if (missing.length) { skipped.push({ id: p.id, missing }); continue; }
  const gradient = (p.grade_percent ?? 0) / 100;
  const predicted = walkPowerW({ gradient, speed: p.speed_m_s, massKg: mass, g: p.gravity_g });
  rows.push({
    id: p.id,
    source: p.source,
    suited: Boolean(p.suited),
    gravity_g: p.gravity_g,
    speed_m_s: p.speed_m_s,
    grade_percent: p.grade_percent ?? 0,
    gait: p.gait ?? null,
    mass_kg: mass,
    measured_w: p.measured_w,
    predicted_w: round(predicted, 0),
    ratio: round(p.measured_w / predicted, 3),
    beyond_slope_data: Math.abs(gradient) > MAX_MEASURED_GRADIENT,
    read_from: p.read_from ?? null,
  });
}

function summarise(list) {
  const ratios = list.map((r) => r.ratio).sort((a, b) => a - b);
  return {
    points: list.length,
    median_ratio: round(quantile(ratios, 0.5), 3),
    p10_ratio: round(quantile(ratios, 0.1), 3),
    p90_ratio: round(quantile(ratios, 0.9), 3),
    lowest_ratio: round(ratios[0] ?? null, 3),
    highest_ratio: round(ratios[ratios.length - 1] ?? null, 3),
  };
}

const suited = rows.filter((r) => r.suited);
const overall = summarise(suited);
const stands = overall.median_ratio !== null && overall.median_ratio >= 0.85 && overall.median_ratio <= 1.15;
const result = {
  what: 'The body model\'s predicted metabolic rate set against rates measured on people walking in reduced gravity. ratio = measured / predicted; above 1 means the model predicts too little.',
  method: 'predicted watts = Minetti 2002 walking cost at the slope x gravity factor (Farley and McMahon 1992, straight line) x mass moved x speed. Fixed before the measurements were collected.',
  rule: 'If the median ratio of the suited points lies between 0.85 and 1.15 the model stands. Otherwise it is corrected by the median, and the 10th to 90th percentile spread is carried as the uncertainty.',
  suited: overall,
  unsuited: summarise(rows.filter((r) => !r.suited)),
  suited_level: summarise(suited.filter((r) => r.grade_percent === 0)),
  suited_sloped: summarise(suited.filter((r) => r.grade_percent !== 0)),
  suited_by_gravity: Object.fromEntries([...new Set(suited.map((r) => r.gravity_g))].sort().map((g) => [g, summarise(suited.filter((r) => r.gravity_g === g))])),
  verdict: stands ? 'stands' : 'corrected',
  correction: stands ? 1 : overall.median_ratio,
  uncertainty: stands ? [overall.p10_ratio, overall.p90_ratio] : [round(overall.p10_ratio / overall.median_ratio, 3), round(overall.p90_ratio / overall.median_ratio, 3)],
  skipped,
  rows,
};
fs.writeFileSync(`${root}/data/validation/model_vs_measured.json`, JSON.stringify(result, null, 1));

console.log(`${rows.length} points compared (${suited.length} suited), ${skipped.length} skipped for missing values`);
console.log('suited, all:      ', JSON.stringify(result.suited));
console.log('suited, level:    ', JSON.stringify(result.suited_level));
console.log('suited, sloped:   ', JSON.stringify(result.suited_sloped));
console.log('unsuited:         ', JSON.stringify(result.unsuited));
console.log('by gravity:       ', JSON.stringify(result.suited_by_gravity));
console.log(`verdict: ${result.verdict}; correction x${result.correction}; uncertainty ${result.uncertainty.join(' to ')}`);
