// The walk brief: what the plan expects the walk to do to the body, written
// before the walk in the order a crew doctor works: before, during, after.
// It also builds the forecast table, the expected values along the route
// that an onboard system could compare with what a suit actually measures.
//
// Everything here is read from a planned route (js/route.js) and the comms
// data (js/comms.js). Nothing is measured on a person.

import { MODEL, MAX_MEASURED_GRADIENT, tempRiseC, heatText } from './body.js';

const degrees = (gradient) => Math.atan(Math.abs(gradient)) * 180 / Math.PI;
const km = (metres) => (metres / 1000).toFixed(2);
const minutes = (seconds) => Math.round(seconds / 60);

// What the model has no data for. Listed in every brief so that silence
// about a risk is never read as "no risk".
export const NOT_MODELLED = [
  'Decompression sickness: no suit pressure or pre-breathe data',
  'Carbon dioxide and oxygen inside the helmet: no suit airflow data',
  'Water lost and dehydration: the suit, not sweat, is taken to remove the heat',
  'Falls and injuries on rough ground: the 4 m elevation grid hides rocks and single ridges',
  'Dust and what it carries',
  'A solar particle event: the dose uses the average rate Curiosity measured, with no event',
];

// Stretches of consecutive points that pass `test`, at least `minLength`
// metres long, as [firstIndex, lastIndex] pairs.
function stretches(points, test, minLength = 0) {
  const out = [];
  let from = -1;
  points.forEach((p, i) => {
    const on = i > 0 && test(p);
    if (on && from < 0) from = i;
    if ((!on || i === points.length - 1) && from >= 0) {
      const to = on ? i : i - 1;
      if (points[to].dist - points[from - 1].dist >= minLength) out.push([from, to]);
      from = -1;
    }
  });
  return out;
}

// Joins stretches that lie within `gap` metres of each other, so a slope
// that crosses a threshold several times reads as one place, not five.
function joined(pairs, points, gap) {
  const out = [];
  for (const [from, to] of pairs) {
    const last = out[out.length - 1];
    if (last && points[from - 1].dist - points[last.to].dist <= gap) {
      last.to = to;
      last.metres += points[to].dist - points[from - 1].dist;
    } else {
      out.push({ from, to, metres: points[to].dist - points[from - 1].dist });
    }
  }
  return out;
}

// The contact record as blocks of time, with changes shorter than a minute
// folded into the block before them: a link that flickers for a few seconds
// at a ridge is not worth a line in a brief.
function contactBlocks(points, inContact) {
  const blocks = [];
  inContact.forEach((value, i) => {
    if (value === null) return;
    const last = blocks[blocks.length - 1];
    if (last && last.value === value) last.to = i;
    else blocks.push({ value, from: i, to: i });
  });
  const kept = [];
  for (const block of blocks) {
    const seconds = points[block.to].seconds - points[block.from].seconds;
    const last = kept[kept.length - 1];
    if (last && (seconds < 60 || last.value === block.value)) last.to = block.to;
    else kept.push({ ...block });
  }
  return kept;
}

// Builds the brief for one planned route. `contact` is the result of
// comms.routeContact for the same route and start time, or null.
export function buildBrief({ route, routeName, loadKg, comms = null, contact = null, startMinute = 0, lightMinutes = null, coolingW = MODEL.coolingW }) {
  const t = route.totals;
  const points = route.points;
  const limit = MODEL.heatLimitKJkg;
  const events = [];
  const at = (index) => ({ dist: points[index].dist, seconds: points[index].seconds });

  route.stops.slice(1, -1).forEach((stop, i) => {
    events.push({ ...at(stop.index), kind: 'stop', text: `Stop ${i + 1}: ${stop.place.name}.` });
  });

  // Climbs steep enough that the walker must slow down to stay in the work range.
  for (const [from, to] of stretches(points, (p) => p.speed < MODEL.paceMs - 0.01, 40)) {
    const part = points.slice(from, to + 1);
    const steepest = Math.max(...part.map((p) => degrees(p.gradient)));
    const slowest = Math.min(...part.map((p) => p.speed));
    events.push({
      ...at(from - 1),
      kind: 'climb',
      text: `Climb for ${Math.round(points[to].dist - points[from - 1].dist)} m, up to ${steepest.toFixed(0)}°. Work is held at ${MODEL.workLimitW} W, so the pace falls to ${slowest.toFixed(1)} m/s.`,
    });
  }

  for (const part of joined(stretches(points, (p) => Math.abs(p.gradient) > MAX_MEASURED_GRADIENT), points, 80)) {
    if (part.metres < 10) continue;
    events.push({
      ...at(part.from - 1),
      kind: 'unknown',
      text: `Over the next ${Math.round(points[part.to].dist - points[part.from - 1].dist)} m, ${Math.round(part.metres)} m is steeper than any walking study covers (over ${degrees(MAX_MEASURED_GRADIENT).toFixed(0)}°). Energy and heat here are extrapolated.`,
    });
  }

  const warnAt = points.findIndex((p) => p.heat >= 0.75 * limit);
  if (warnAt >= 0) {
    events.push({ ...at(warnAt), kind: 'heat', text: `Stored heat reaches ${(0.75 * limit).toFixed(2)} kJ/kg, three quarters of NASA's limit.` });
  }
  for (const rest of route.restStops) {
    const index = points.findLastIndex((p) => p.dist <= rest.dist + 0.01);
    events.push({
      dist: rest.dist,
      seconds: points[Math.max(0, index)].seconds,
      kind: 'rest',
      text: `Stored heat reaches ${(MODEL.restAt * limit).toFixed(1)} kJ/kg. Stop and rest ${minutes(rest.seconds)} min to shed it before going on.`,
    });
  }

  // Where the radio link is lost and found again.
  let gapMinutes = 0;
  if (contact && comms) {
    contactBlocks(points, contact.inContact).forEach((block, n) => {
      const p = points[block.from];
      const minute = startMinute + p.seconds / 60;
      const lasts = `${Math.max(1, minutes(points[block.to].seconds - p.seconds))} min`;
      if (block.value && n > 0) {
        events.push({ ...at(block.from), kind: 'radio', text: `${comms.inView(p.lat, p.lon, minute).join(' and ') || 'An orbiter'} in view again.` });
      } else if (!block.value) {
        const blocked = comms.blockedBy(p.lat, p.lon, minute);
        events.push({ ...at(block.from), kind: 'radio', text: `No relay orbiter in view for ${lasts}${blocked?.length ? `: terrain blocks ${blocked.join(' and ')}` : ''}.` });
      }
    });
    gapMinutes = contact.longestGapMin;
  }
  events.sort((a, b) => a.dist - b.dist || a.seconds - b.seconds);

  const overLimit = t.peakHeatNoRest > limit;
  const share = contact ? Math.round((contact.inContact.filter(Boolean).length / contact.inContact.length) * 100) : null;
  const endHeat = points[points.length - 1].heat;

  return {
    title: `${routeName} · ${loadKg ? `carrying ${loadKg} kg` : 'no load'}${comms ? ` · start ${comms.localTime(startMinute)} local time` : ''}`,
    verdict: [
      overLimit
        ? { level: 'warn', text: `Without rest this route stores ${heatText(t.peakHeatNoRest)} kJ/kg of body heat (${t.peakHeatRange.map((v) => v.toFixed(1)).join(' to ')} across the spread measured on people), over NASA's limit of ${limit.toFixed(1)}. The plan adds ${t.restCount} rest${t.restCount === 1 ? '' : 's'} (${minutes(t.restSeconds)} min) to stay under it.` }
        : { level: 'ok', text: `Stored body heat peaks at ${heatText(t.peakHeatNoRest)} kJ/kg (${t.peakHeatRange.map((v) => v.toFixed(1)).join(' to ')} across the spread measured on people), under NASA's limit of ${limit.toFixed(1)}. ${t.restCount
          ? `The plan still adds ${t.restCount} rest${t.restCount === 1 ? '' : 's'} (${minutes(t.restSeconds)} min): it rests at ${MODEL.restAt * 100}% of the limit, before the limit is reached.`
          : 'No rest is forced.'}` },
      share === null ? null
        : share === 100
          ? { level: 'ok', text: 'A relay orbiter is in view for the whole walk.' }
          : { level: 'warn', text: `A relay orbiter is in view for ${share}% of the walk. Longest stretch with no contact: ${gapMinutes.toFixed(0)} min.` },
      t.beyondMeasured > 0
        ? { level: 'warn', text: `${t.beyondMeasured.toFixed(0)} m of the route is steeper than any walking study covers.` }
        : null,
    ].filter(Boolean),
    before: [
      `Distance ${km(t.dist)} km, climb ${t.climb.toFixed(0)} m, steepest ground ${t.steepestDeg.toFixed(0)}°.`,
      `Expected time ${minutes(t.seconds)} min${t.restCount ? `, of which ${minutes(t.restSeconds)} min is forced rest` : ''}.`,
      t.coolingNeededW <= MODEL.restW + 1
        ? `The walk is too short to reach NASA's heat limit, even in a suit that removes only the ${MODEL.restW} W of a body at rest; the suit in this plan removes ${coolingW} W.`
        : `To stay under NASA's heat limit with no rest the suit would have to remove ${t.coolingNeededW} W of heat; the suit in this plan removes ${coolingW} W.`,
      `Expected energy ${t.kcal.toFixed(0)} kcal, ${((t.kcal / MODEL.energyBudgetKcal) * 100).toFixed(0)}% of the ${MODEL.energyBudgetKcal} kcal backpack budget.`,
      `Lowest energy margin on the route, after the cheapest way home: ${t.lowestLeft.toFixed(0)}%.`,
      lightMinutes === null ? null : `Earth is ${lightMinutes.toFixed(1)} light-minutes away: a question and its answer take at least ${Math.ceil(lightMinutes * 2)} min. The crew decides alone.`,
    ].filter(Boolean),
    during: events.map((e) => ({ ...e, where: `${km(e.dist)} km`, when: `${minutes(e.seconds)} min` })),
    after: [
      `Peak stored body heat ${t.peakHeat.toFixed(1)} kJ/kg with the planned rests, a mean body temperature rise of about ${tempRiseC(t.peakHeat).toFixed(1)} °C.`,
      endHeat > 0.05
        ? `Heat still stored on return: ${endHeat.toFixed(1)} kJ/kg. At rest the suit sheds it in about ${Math.ceil((endHeat * 1000 * MODEL.bodyMassKg) / (coolingW - MODEL.restW) / 60)} min.`
        : 'No heat is still stored on return.',
      `Radiation dose added: ${t.dose.toFixed(1)} µSv, about ${((t.dose / MODEL.careerLimitUSv) * 100).toFixed(3)}% of NASA's career limit of ${MODEL.careerLimitUSv / 1000} mSv. One walk adds little; over a mission every hour outside counts.`,
    ],
  };
}

// The crew doctor's checks (data/brief_checks.json). Each is a check NASA
// publishes, with NASA's value. Where the plan has a forecast for the same
// thing, it is set beside the check; where it has none, the line says so.
const MARS_RADIUS_M = 3396190;
const DEG = Math.PI / 180;

// Straight-line distance from the habitat (the first point) to the farthest
// point of the route, in metres.
function farthestFromHabitat(points) {
  const home = points[0];
  let far = 0;
  for (const p of points) {
    const east = (p.lon - home.lon) * DEG * MARS_RADIUS_M * Math.cos(home.lat * DEG);
    const north = (p.lat - home.lat) * DEG * MARS_RADIUS_M;
    far = Math.max(far, Math.hypot(east, north));
  }
  return far;
}

const NO_FORECAST = 'The map has no forecast for this.';
const COMPARE = {
  workload: ({ t, peakW }) => `This walk: ${minutes(t.seconds)} min, ${t.kcal.toFixed(0)} kcal, work rate up to ${peakW} W.`,
  peakWork: ({ peakW }) => `Peak work rate on this route: ${peakW} W.`,
  water: ({ t }) => `This walk takes ${minutes(t.seconds)} min: at least ${Math.ceil((t.seconds / 3600) * 240)} mL.`,
  heat: ({ t }) => `Forecast peak on this route: ${t.peakHeat.toFixed(1)} kJ/kg with the planned rests, ${heatText(t.peakHeatNoRest)} with none.`,
  work: ({ peakW }) => `The forecast file gives the expected work rate at every point, up to ${peakW} W, to compare with the reading.`,
  walkback: ({ route }) => `Farthest point of this route: ${km(farthestFromHabitat(route.points))} km from the habitat in a straight line. The way home costs at most ${Math.max(...route.points.map((p) => p.backKcal)).toFixed(0)} kcal.`,
  contact: ({ contact }) => (contact
    ? `With this start time a relay orbiter is in view for ${Math.round((100 * contact.inContact.filter(Boolean).length) / contact.inContact.length)}% of the walk. Longest gap: ${Math.round(contact.longestGapMin)} min.`
    : 'Radio contact is not computed for this walk.'),
  dose: ({ t }) => `Forecast for this walk: ${t.dose.toFixed(1)} µSv.`,
  context: ({ t }) => `The map gives the walk time (${minutes(t.seconds)} min) and the work rate. It does not forecast sweat or water lost.`,
};

// The checks of one part ('before', 'during' or 'after') as lines of HTML.
export function doctorChecks(checks, part, { route, contact = null }) {
  const values = {
    route,
    contact,
    t: route.totals,
    peakW: Math.round(Math.max(...route.points.map((p) => p.metabolicW ?? 0))),
  };
  return (checks?.[part] ?? []).map((item) => {
    const sources = item.sources
      .map((source) => `<a href="${source.url}" target="_blank" rel="noopener">${source.label}</a>`)
      .join('; ');
    const map = COMPARE[item.compare]?.(values) ?? NO_FORECAST;
    return `<b>${item.check}</b><br>NASA: ${item.nasa} ${sources}<br>Map: ${map}`;
  });
}

// The forecast table: the expected state of the walker at every point of
// the route. An onboard system could compare a suit's readings with these
// to tell hard ground from a body in trouble.
export const FORECAST_COLUMNS = [
  ['dist_m', 'Distance walked, metres'],
  ['time_min', 'Time since the start, minutes, rests included'],
  ['lat', 'Latitude, degrees'],
  ['lon', 'Longitude, degrees east'],
  ['elev_m', 'Elevation, metres'],
  ['slope_deg', 'Slope in the direction of travel, degrees; negative is downhill'],
  ['pace_m_s', 'Expected pace, metres per second'],
  ['work_w', 'Expected metabolic rate, watts'],
  ['heat_kj_kg', 'Expected stored body heat, kJ per kg of body mass'],
  ['energy_kcal', 'Expected energy used so far, kcal'],
  ['dose_usv', 'Expected radiation dose so far, microsieverts'],
  ['sky_blocked_pct', 'Share of sky blocked by terrain, percent'],
  ['orbiter_in_view', 'true when a relay orbiter is above the terrain at that moment'],
];

export function forecastRows(route, contact = null) {
  return route.points.map((p, i) => ({
    dist_m: p.dist,
    time_min: Number((p.seconds / 60).toFixed(2)),
    lat: p.lat,
    lon: p.lon,
    elev_m: p.elev,
    slope_deg: Number((Math.atan(p.gradient) * 180 / Math.PI).toFixed(1)),
    pace_m_s: Number(p.speed.toFixed(2)),
    work_w: Math.round(p.metabolicW),
    heat_kj_kg: p.heat,
    energy_kcal: Number(p.kcal.toFixed(1)),
    dose_usv: Number(p.dose.toFixed(2)),
    sky_blocked_pct: p.skyPct,
    orbiter_in_view: contact ? contact.inContact[i] : null,
  }));
}

// The forecast as one file, with the assumptions it rests on.
export function forecastFile({ route, routeName, loadKg, contact, comms, startMinute, sources, coolingW = MODEL.coolingW }) {
  return {
    what: 'Red Ledger walk forecast: the expected state of a walker along one planned Marswalk. Model output, not a measurement on a person.',
    site: 'Boxwork region, Mount Sharp, Gale crater, Mars',
    route: routeName,
    carried_load_kg: loadKg,
    start_local_time: comms ? comms.localTime(startMinute) : null,
    orbiter_positions_for: comms ? 'sol 4752 (18 December 2025), NASA/JPL Horizons' : null,
    model: { ...MODEL, coolingW },
    sources: Object.values(sources).map((s) => ({ source: s.label, url: s.url, gives: s.what, status: s.status })),
    not_modelled: NOT_MODELLED,
    columns: Object.fromEntries(FORECAST_COLUMNS),
    rest_stops: route.restStops.map((r) => ({ dist_m: Number(r.dist.toFixed(1)), rest_min: Number((r.seconds / 60).toFixed(1)) })),
    totals: route.totals,
    rows: forecastRows(route, contact),
  };
}

export function forecastCsv(route, contact = null) {
  const names = FORECAST_COLUMNS.map(([name]) => name);
  const rows = forecastRows(route, contact).map((row) => names.map((name) => row[name] ?? '').join(','));
  return [names.join(','), ...rows].join('\n');
}
