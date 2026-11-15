import { SITE, LAYERS } from './layers.js';
import { loadTerrain, slopeImage, SLOPE_RAMP } from './terrain.js';
import { loadSky, skyImage, SKY_RAMP } from './sky.js';
import { loadComms, commsImage, COMMS_RAMP } from './comms.js';
import { buildBrief, doctorChecks, forecastFile, forecastCsv, NOT_MODELLED } from './brief.js';
import { planWalk, pointAt, returnCost, reprice } from './route.js';
import { createPlanner } from './planner.js';
import { loadReach, REACH_LEGEND } from './reach.js';
import { SOURCES, MODEL, MAX_MEASURED_GRADIENT, SUIT_FACTOR_RANGE, tempRiseC, step, Ledger, heatNeutralPace, levelWorkW, energyLeftPct, heatText } from './body.js';

const L = window.L;
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const fmt = (value, digits = 0) => value.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits });
// Differences are written with a real minus sign and always show their sign.
// A difference with its sign; one that rounds to nothing is shown as ±0.
const signed = (value, digits = 0) => {
  const size = fmt(Math.abs(value), digits);
  return `${Number(size) === 0 ? '±' : value < 0 ? '−' : '+'}${size}`;
};

// The four lines of the body ledger.
const BARS = [
  { id: 'energy', name: 'Energy', unit: 'kcal', hue: '#ffb547', digits: 0 },
  { id: 'heat', name: 'Body heat', unit: 'kJ/kg', hue: '#ff7a4d', digits: 2 },
  { id: 'dose', name: 'Radiation', unit: 'µSv', hue: '#a78bfa', digits: 1 },
  { id: 'home', name: 'Way home', unit: '% energy left', hue: '#63d6c1', digits: 0 },
];

// The two routes for the same walk. `pricing` names a rule in route.js.
const ROUTES = [
  { id: 'direct', pricing: 'direct', name: 'Direct route', hint: 'shortest over the ground', color: '#ffb547' },
  { id: 'body', pricing: 'body', name: 'Body-cost route', hint: 'least walking energy, nothing steeper than 24°', color: '#63d6c1' },
];

const state = {
  terrain: null,
  sky: null,
  walk: null,
  photos: [],
  plans: {},        // carried load in kg -> { direct, body }
  loadKg: 0,        // the carried load now shown
  coolingW: MODEL.coolingW, // heat the suit removes, set by the slider
  planned: null,    // the routes now shown, as planned for the model's own suit
  opening: '',      // the sentence shown where the pointer readout rests
  restMarks: [],    // map marks where the plan makes the walker rest
  routes: {},       // id -> described route for the load now shown
  lines: {},        // id -> { line, casing } on the map
  stopMarkers: [],  // one per place on the walk, habitat first
  overlays: [],     // { id, label, leaf, ramp, credit }
  active: 'direct',
  dist: 0,          // metres walked along the active route
  playing: false,
  comms: null,      // orbiter visibility over the terrain
  startMinute: 0,   // minute of the sol at which the walk starts
  contact: {},      // route id -> which points have an orbiter in view
  view3d: null,     // the 3D view, made the first time it is opened
  nextStop: 1,      // index of the next stop the walker will reach
  lightMinutes: null, // one-way light time to Earth on the comms sol
  checks: null,     // the crew doctor's own checks, from data/brief_checks.json
  free: null,       // the free walk in progress, or null
  own: null,        // the walk the viewer is placing, or null
  walks: null,      // the ready-made walks, from data/walks.json
  reach: null,      // the body-reach grid, loaded when its layer is first shown
  overlay: 'none',  // the overlay now shown
  sequence: false,  // true while the recorded sequence is playing
  onWalkEnd: null,  // called when a played walk reaches its end
};

/* Map */

// The map uses the web's standard grid because NASA's rover map tiles for
// Gale are cut on it. Leaflet assumes Earth's size for distances, so every
// distance shown on the page is computed separately with the Mars radius.
const map = L.map('map', {
  center: SITE.center,
  zoom: SITE.zoom - 2,
  minZoom: SITE.minZoom,
  maxZoom: SITE.maxZoom,
  maxBounds: SITE.bounds,
  zoomControl: false,
  attributionControl: false,
  zoomSnap: 0.25,
});

// When the viewer asks for less motion, the map jumps instead of gliding.
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

map.on('mousemove', (e) => {
  const { lat, lng } = e.latlng;
  let text = `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}  ${lng.toFixed(4)}°E`;
  const elev = state.terrain?.elevAt(lat, lng);
  if (elev != null && !Number.isNaN(elev)) {
    text += `  ·  ${elev.toFixed(0)} m  ·  slope ${state.terrain.slopeAt(lat, lng).toFixed(0)}°`;
  }
  const sky = state.sky?.at(lat, lng);
  if (sky != null) text += `  ·  sky blocked ${sky.toFixed(0)}%`;
  const inView = state.comms?.at(lat, lng);
  if (inView != null) text += `  ·  orbiter in view ${inView} min/sol`;
  // With the reach layer on, the legend says what a walk to the point under
  // the pointer and back would cost.
  if (state.overlay === 'reach' && state.reach) {
    const reach = state.reach.at(lat, lng, state.loadKg);
    $('legend-note').textContent = reach?.reachable
      ? `Here and back in a ${MODEL.coolingW} W suit: ${reach.minutes} min, ${reach.rests === 0 ? 'no rest' : reach.rests === 1 ? '1 rest' : `${reach.rests} rests`}, about ${reach.peakHeatKJkg.toFixed(1)} kJ/kg if not rested`
      : REACH_NOTE;
  }
  showCoord(text);
});
map.on('mouseout', () => {
  showCoord('');
  if (state.overlay === 'reach') $('legend-note').textContent = REACH_NOTE;
});

// The bars at the top and bottom grow when their contents wrap on a narrow
// screen. The panel grid is told their real height.
function fitBars() {
  const root = document.documentElement.style;
  root.setProperty('--top', `${document.querySelector('.top').offsetHeight}px`);
  root.setProperty('--foot', `${document.querySelector('.foot').offsetHeight}px`);
}
window.addEventListener('resize', fitBars);

// The part of the window not covered by panels, in screen pixels. The
// camera keeps the walk inside it. The page's grid leaves one cell free for
// the map (.map-window), beside the panel on a wide screen and above it on a
// narrow one. The view and layer buttons lie along the top of that cell.
function clearArea() {
  const cell = document.querySelector('.map-window').getBoundingClientRect();
  const area = { left: cell.left + 28, top: cell.top + 56, right: cell.right - 36, bottom: cell.bottom - 28 };
  // On a short window the cell can leave almost no map. Fitting the walk
  // into that sliver zooms far past the imagery, so use the whole cell, or
  // the whole window if the cell itself is a sliver.
  if (area.right - area.left < 160 || area.bottom - area.top < 120) {
    if (cell.width < 160 || cell.height < 120) {
      const top = document.querySelector('.top').getBoundingClientRect();
      return { left: 20, top: top.bottom + 12, right: window.innerWidth - 20, bottom: window.innerHeight - 20 };
    }
    return { left: cell.left + 8, top: cell.top + 8, right: cell.right - 8, bottom: cell.bottom - 8 };
  }
  return area;
}

// The sharpest imagery (HiRISE) stops at zoom 16. Past that the map is blank.
const FIT_MAX_ZOOM = 16;

function boundsPadding() {
  const area = clearArea();
  return {
    paddingTopLeft: [area.left, area.top],
    paddingBottomRight: [window.innerWidth - area.right, window.innerHeight - area.bottom],
    maxZoom: FIT_MAX_ZOOM,
  };
}

/* Imagery and overlays */

// What the reach layer shows, said under its legend.
const REACH_NOTE = `To walk from the habitat to a point and back, body-cost route, load shown, ${MODEL.coolingW} W suit. Point at the map for one place.`;

// Imagery is always on. One overlay at a time goes on top of it, so the
// picture of the ground is never buried under several layers.
function buildImagery() {
  for (const layer of LAYERS.filter((l) => l.kind === 'tiles')) {
    // A copy of the walk area stored in the repo sits under the live tiles,
    // so the walk still has imagery if NASA's server cannot be reached.
    if (layer.local) L.tileLayer(layer.local.url, layer.local.options).addTo(map);
    L.tileLayer(layer.url, layer.options).addTo(map);
  }
}

function buildOverlays(terrain, sky, comms) {
  const thermal = Object.fromEntries(LAYERS.filter((l) => l.kind === 'image').map((l) => [l.id, l]));
  state.overlays = [
    { id: 'none', label: 'Imagery' },
    {
      id: 'reach',
      label: 'Reach',
      // The legend has room for short labels only; the fifth class, no route,
      // covers five cells and is left out of it.
      legend: { title: 'Rests needed', note: REACH_NOTE, steps: REACH_LEGEND.slice(0, 4).map((entry, i) => ({ ...entry, label: ['none', '1', '2', '3+'][i] })) },
      // The grid is 200 kB and is only fetched when the layer is first shown.
      make: async (overlay) => {
        state.reach = await loadReach();
        overlay.leaf = L.imageOverlay(state.reach.image(state.loadKg), state.reach.bounds, { className: 'reach-layer' });
      },
      credit: 'Body reach: the rests the plan adds to walk from the habitat to each point and back by the body-cost route, for the load shown. Computed for every 4 m cell with the body model on this page. A rest starts at 90% of NASA\'s heat limit',
    },
    {
      id: 'slope',
      label: 'Slope',
      ramp: SLOPE_RAMP,
      leaf: L.imageOverlay(slopeImage(terrain), terrain.bounds, { opacity: 0.75 }),
      credit: `Slope computed from ${terrain.meta.source}. ${terrain.meta.credit}`,
    },
    { id: 'night', label: 'Night heat', leaf: L.imageOverlay(thermal.night.url, thermal.night.bounds, thermal.night.options), credit: thermal.night.credit },
    { id: 'day', label: 'Day heat', leaf: L.imageOverlay(thermal.day.url, thermal.day.bounds, thermal.day.options), credit: thermal.day.credit },
    {
      id: 'sky',
      label: 'Radiation',
      ramp: SKY_RAMP,
      leaf: L.imageOverlay(skyImage(sky), sky.bounds, { opacity: 0.8 }),
      credit: `Sky blocked by terrain, computed from the elevation model with the method of Guo et al. 2026 (Curiosity RAD). ${sky.meta.credit}`,
    },
  ];
  if (comms) {
    state.overlays.push({
      id: 'comms',
      label: 'Comms',
      ramp: COMMS_RAMP,
      leaf: L.imageOverlay(commsImage(comms), comms.bounds, { opacity: 0.8 }),
      credit: 'Comms shadow: minutes per sol with a relay orbiter above the terrain. Orbiter positions: NASA/JPL Horizons, sol 4752. Line of sight only',
    });
  }
  state.overlays.forEach((overlay, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `overlay-${overlay.id}`;
    btn.textContent = overlay.label;
    btn.title = `${overlay.credit ?? 'Imagery only'} (key ${i + 1})`;
    btn.addEventListener('click', () => setOverlay(overlay.id));
    $('overlays').append(btn);
  });
  setOverlay('none');
  fitBars();
}

function setOverlay(id) {
  state.overlay = id;
  for (const overlay of state.overlays) {
    const on = overlay.id === id;
    $(`overlay-${overlay.id}`).setAttribute('aria-pressed', String(on));
    // A layer that is made on first use is shown as soon as it is ready,
    // unless another layer was chosen in the meantime.
    if (on && !overlay.leaf && overlay.make) {
      // Asked for twice before it is ready, it is still made once.
      overlay.making ??= overlay.make(overlay).then(() => { if (state.overlay === id) setOverlay(id); })
        .catch(() => {}).finally(() => { overlay.making = null; });
      continue;
    }
    if (!overlay.leaf) continue;
    if (on) overlay.leaf.addTo(map); else overlay.leaf.remove();
    if (on) showLegend(overlay.ramp ?? overlay.legend);
  }
  state.view3d?.setSlopeTint(id === 'slope');
  const shown = state.overlays.find((o) => o.id === id);
  if (!shown?.ramp && !(shown?.legend && shown.leaf)) $('legend').hidden = true;
}

// A strip that shows what the overlay's colours mean.
function showLegend(ramp) {
  if (!ramp) return;
  const strip = $('legend-strip');
  const ctx = strip.getContext('2d');
  ctx.clearRect(0, 0, strip.width, strip.height);
  // A layer with a few named classes gets one block for each.
  if (ramp.steps) {
    const width = strip.width / ramp.steps.length;
    ramp.steps.forEach((entry, i) => {
      ctx.fillStyle = entry.color;
      ctx.fillRect(Math.round(i * width) + 1, 0, Math.round(width) - 2, strip.height);
    });
    $('legend-title').textContent = ramp.title;
    $('legend-ticks').innerHTML = ramp.steps.map((entry) => `<span>${entry.label}</span>`).join('');
    $('legend-note').textContent = ramp.note ?? '';
    $('legend').hidden = false;
    return;
  }
  $('legend-note').textContent = ramp.note ?? '';
  for (let x = 0; x < strip.width; x++) {
    const [r, g, b, a] = ramp.color(ramp.min + ((ramp.max - ramp.min) * x) / (strip.width - 1));
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    ctx.fillRect(x, 0, 1, strip.height);
  }
  const mid = (ramp.min + ramp.max) / 2;
  $('legend-title').textContent = ramp.title;
  $('legend-ticks').innerHTML = `<span>under ${ramp.min}${ramp.unit}</span><span>${Math.round(mid)}</span><span>${ramp.max} and over</span>`;
  $('legend').hidden = false;
}

function buildMapCredits(terrain) {
  const lines = [
    ...LAYERS.map((l) => l.credit),
    `Elevation: ${terrain.meta.source}. ${terrain.meta.credit}`,
    'Rover path and photos: Curiosity, NASA/JPL-Caltech',
  ];
  $('map-credits-body').innerHTML = lines.map((line) => `<p>${line}</p>`).join('');
}

// Curiosity's own path: where a wheeled rover has already crossed this ground.
async function buildRoverPath() {
  const { waypoints } = await (await fetch('data/msl_waypoints.json')).json();
  L.polyline(waypoints.map((w) => [w.lat, w.lon]), { color: '#f3ebe0', weight: 1.5, opacity: 0.45, dashArray: '2 6' })
    .bindTooltip('Path driven by the Curiosity rover', { sticky: true })
    .addTo(map);
}

// The line under the site name: what is under the pointer, or, with the
// pointer off the map, the one sentence the whole page is about.
function showCoord(text) {
  $('cursor-coord').textContent = text || state.opening;
  $('cursor-coord').classList.toggle('opening', !text);
}

// What Curiosity's weather station measured while the rover was in this
// area. The feed is published for outreach, so it is labelled as such.
async function buildWeather() {
  const { summary, sols, source } = await (await fetch('data/rems_boxwork.json')).json();
  $('weather-body').innerHTML = `
    <p>Measured by Curiosity in this area over ${sols.length} sols:</p>
    <p>Air <b>${summary.air_min_c.min} to ${summary.air_max_c.max} °C</b></p>
    <p>Ground <b>${summary.ground_min_c.min} to ${summary.ground_max_c.max} °C</b></p>
    <p>Pressure <b>${summary.pressure_pa.min} to ${summary.pressure_pa.max} Pa</b>, under 1% of Earth's at sea level</p>
    <p><a href="${source}" target="_blank" rel="noopener">Curiosity REMS weather station</a>, published for outreach.</p>`;
  state.opening = `Air here falls to ${summary.air_min_c.min} °C. What stops a walker is body heat.`;
  if ($('cursor-coord').textContent === '') showCoord('');
  // How far away help is, on the sol the orbiter positions are for.
  const comms = await fetch('data/comms/summary.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (comms) {
    const oneWay = comms.light_time.one_way_minutes_at_start;
    state.lightMinutes = oneWay;
    $('weather-body').insertAdjacentHTML('beforeend', `<p>Earth was <b>${oneWay.toFixed(1)} light-minutes</b> away on sol ${comms.sol}: a question and its answer take at least ${Math.ceil(oneWay * 2)} minutes. <a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noopener">NASA/JPL Horizons</a></p>`);
  }
}

/* Body ledger */

const shown = {}; // the number each bar currently displays, for easing

function buildBars() {
  for (const bar of BARS) {
    const el = document.createElement('div');
    el.className = 'bar';
    el.id = `bar-${bar.id}`;
    el.style.setProperty('--hue', bar.hue);
    el.innerHTML = `
      <div class="bar-head">
        <span class="bar-name">${bar.name}</span>
        <span class="bar-value"><span data-value>–</span><small>${bar.unit}</small></span>
      </div>
      <div class="bar-track"><div class="bar-fill"></div><div class="bar-limit" hidden></div></div>
      <div class="bar-note" data-note></div>`;
    $('bars').append(el);
  }
}

function paintBar(bar, value, max, limit) {
  const el = $(`bar-${bar.id}`);
  el.querySelector('[data-value]').textContent = fmt(value, bar.digits);
  el.querySelector('.bar-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, value / max))})`;
  if (limit !== null) el.dataset.state = value > limit ? 'over' : value > 0.75 * limit ? 'warn' : 'ok';
}

// Sets one ledger line. With `ease`, the number glides from what is shown
// to the new value, so a change of route can be followed by eye. A number
// for `ease` is a duration in ms at a steady rate, to keep in step with a
// route being drawn.
function setBar(id, { value, max, limit = null, note = '' }, ease = false) {
  const bar = BARS.find((b) => b.id === id);
  const el = $(`bar-${id}`);
  const tick = el.querySelector('.bar-limit');
  tick.hidden = limit === null;
  if (limit !== null) tick.style.left = `${Math.min(100, (limit / max) * 100)}%`;
  el.querySelector('[data-note]').innerHTML = note;

  const from = shown[id];
  shown[id] = value;
  if (!ease || from === undefined) { paintBar(bar, value, max, limit); return; }
  const start = performance.now();
  const frame = (now) => {
    if (shown[id] !== value) return; // a newer value took over
    const steady = typeof ease === 'number';
    const t = Math.min(1, (now - start) / (steady ? ease : 500));
    paintBar(bar, from + (value - from) * (steady ? t : 1 - (1 - t) ** 3), max, limit);
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const ASSUMED = '<i class="assume" title="Part of this number rests on an assumption. See Sources and assumptions."></i>';

// Fills the ledger. Before the walk starts it shows the whole route; once
// the walker moves it shows the body at that point.
function renderLedger(ease = false) {
  const route = state.routes[state.active];
  const t = route.totals;
  const live = state.dist > 0;
  const p = pointAt(route, state.dist);
  const left = (kcal, back) => ((MODEL.energyBudgetKcal - kcal - back) / MODEL.energyBudgetKcal) * 100;
  $('ledger-mode').textContent = live ? `after ${fmt(Math.round(state.dist))} m` : 'whole walk';

  setBar('energy', {
    value: live ? p.kcal : t.kcal,
    max: MODEL.energyBudgetKcal,
    note: `${ASSUMED}of a ${fmt(MODEL.energyBudgetKcal)} kcal backpack budget`,
  }, ease);
  // Before the walk starts the bar shows what the route would do to a walker
  // who never stops; during the walk it follows the plan, rests included.
  const heat = live ? p.heat : t.peakHeatNoRest;
  const rests = t.restCount
    ? ` · the plan adds ${t.restCount === 1 ? `a rest of ${(t.restSeconds / 60).toFixed(0)} min` : `${t.restCount} rests, ${(t.restSeconds / 60).toFixed(0)} min in all`}`
    : '';
  setBar('heat', {
    value: heat,
    max: MODEL.heatContingencyKJkg,
    limit: MODEL.heatLimitKJkg,
    note: `${ASSUMED}${live ? 'stored now' : `peak if the walker never rests (${t.peakHeatRange.map((v) => v.toFixed(1)).join(' to ')} across the spread measured on people)${rests}`} · body about +${tempRiseC(heat).toFixed(1)} °C · mark: NASA limit ${MODEL.heatLimitKJkg.toFixed(1)}`,
  }, ease);
  const dose = live ? p.dose : t.dose;
  setBar('dose', {
    value: dose,
    max: Math.max(...ROUTES.map((d) => state.routes[d.id].totals.dose)) * 1.15,
    note: `${ASSUMED}${live ? `sky blocked here ${p.skyPct.toFixed(0)}% · ` : ''}${((dose / MODEL.careerLimitUSv) * 100).toFixed(3)}% of NASA's career limit`,
  }, ease);
  setBar('home', {
    value: live ? left(p.kcal, p.backKcal) : t.lowestLeft,
    max: 100,
    note: live ? `after the ${Math.round(p.backKcal)} kcal cheapest way back from here` : 'lowest point on this route',
  }, ease);
}

function buildSources() {
  const words = { primary: 'published', abstract: 'from abstract', assumption: 'assumption' };
  $('sources-list').innerHTML = Object.values(SOURCES).map((src) => `
    <li><span class="tag" data-status="${src.status}">${words[src.status]}</span>
      <a href="${src.url}" target="_blank" rel="noopener">${src.label}</a>${src.what}</li>`).join('');
}

/* The check against Curiosity's radiation measurements */

async function buildProof() {
  const get = (file) => fetch(`data/${file}`).then((r) => r.json());
  const [check, people, slopes, suits] = await Promise.all([
    get('shielding/validation.json'), get('validation/model_vs_measured.json'), get('validation/model_revised_vs_measured.json'),
    get('validation/sensitivity.json'),
  ]);
  // The suit table: one row for each walk at the middle of the measured
  // spread, and the hardest walk at both ends of it.
  const middle = (walk) => walk.rows.find((row) => row.factor === 'middle').cells;
  const cellText = (cell, join = '<br>') => `${cell.rests === 0 ? 'no rest' : cell.rests === 1 ? '1 rest' : `${cell.rests} rests`}${join}${cell.minutes} min`;
  const hardest = suits.walks.reduce((x, y) => (y.km > x.km ? y : x));
  const atModel = suits.cooling_w.indexOf(suits.model_cooling_w);
  const end = (factor) => hardest.rows.find((row) => row.factor === factor).cells[atModel];
  const mostSaved = Math.max(...suits.walks.map((walk) => walk.route_choice.direct.rests - walk.route_choice.body.rests));
  const within = check.rows.filter((row) => Math.abs(row.difference_pct_points) <= 1).length;
  const level = people.rows.filter((row) => row.suited);
  const pct = (ratio) => `${ratio >= 1 ? '+' : '−'}${Math.abs(Math.round((ratio - 1) * 100))}%`;
  // The suited level measurements by speed, and those nearest walking pace.
  const bySpeed = [...level].sort((x, y) => x.speed_m_s - y.speed_m_s);
  const slow = bySpeed.filter((row) => row.speed_m_s <= 1.35).map((row) => row.ratio).sort((x, y) => x - y);
  const slowMedian = (slow[Math.floor((slow.length - 1) / 2)] + slow[Math.ceil((slow.length - 1) / 2)]) / 2;
  $('proof-body').innerHTML = `
    <h3>1. The body model, tested against NASA's measurements of people</h3>
    <p>NASA measured how hard people work when they walk in a spacesuit at low gravity. Before collecting those measurements we fixed the test in the project's history: the model's prediction, and the rule that it stands only if the measurements lie within 15% of it. The rule is in <a href="https://github.com/Red-ledger-mars/red-ledger/commit/ea6f315" target="_blank" rel="noopener">this commit</a> of the public code; the measurements and the result came 20 minutes later, in <a href="https://github.com/Red-ledger-mars/red-ledger/commit/b6f9b1d" target="_blank" rel="noopener">this one</a>.</p>
    <table>
      <thead><tr><th>Level ground, suited</th><th>Measured</th><th>First model</th><th>Measured against model</th><th>After the correction</th></tr></thead>
      <tbody>${level.map((row) => `<tr class="off"><td>${row.gravity_g > 0.3 ? 'Mars' : 'Moon'} gravity, ${row.speed_m_s.toFixed(2)} m/s</td><td>${Math.round(row.measured_w)} W</td><td>${row.predicted_w} W</td><td>${pct(row.ratio)}</td><td>${pct(row.ratio / people.correction)}</td></tr>`).join('')}</tbody>
    </table>
    <p><b>It failed.</b> People used ${Math.round((people.suited.median_ratio - 1) * 100)}% more energy than the model said (median; from ${pct(people.suited.lowest_ratio)} to ${pct(people.suited.highest_ratio)}). By the rule set in advance, the level cost is now multiplied by ${people.correction}, and the spread is shown on the heat numbers.</p>
    <p>One limit of this correction: it is a single number for all speeds, but the measured excess falls with speed, from ${pct(bySpeed[0].ratio)} at ${bySpeed[0].speed_m_s.toFixed(2)} m/s to ${pct(bySpeed.at(-1).ratio)} at ${bySpeed.at(-1).speed_m_s.toFixed(2)} m/s. The ${slow.length} measurements at 1.34 m/s or slower, the nearest to the walker's ${MODEL.paceMs.toFixed(1)} m/s, have a median of ${slowMedian.toFixed(2)}. That lies inside the spread carried on every heat number (up to ${SUIT_FACTOR_RANGE[1]}), so at walking pace the true value may sit in the upper half of each range.</p>
    <p>The sloped measurements showed a second fault: the first model predicted up to ${Math.max(...slopes.rows.map((row) => row.first_model_w / row.measured_w)).toFixed(1)} times the measured cost of a climb, because it scaled the whole cost by one gravity factor. Climbing is work against weight, so the slope part is now scaled by gravity itself. The revised model against sloped measurements that played no part in the correction:</p>
    <table>
      <thead><tr><th>Slope, suited</th><th>Measured</th><th>First model</th><th>Revised model</th></tr></thead>
      <tbody>${slopes.rows.map((row) => `<tr><td>${row.gravity_g.toFixed(2)} g, ${row.grade_percent}% grade</td><td>${row.measured_w} W</td><td>${row.first_model_w} W</td><td>${row.revised_w.mid} W (${pct(row.revised_ratio)})</td></tr>`).join('')}</tbody>
    </table>
    <p><b>All ${slopes.revised_model.points} lie within ${Math.round((Math.max(slopes.revised_model.highest - 1, 1 - slopes.revised_model.lowest)) * 100)}% of the revised model</b> (median ${pct(slopes.revised_model.median_ratio)}). The change was made after seeing these measurements, so this shows the model is consistent with them; it is not a blind prediction. All but one value were read from the reports' plotted lines, the sloped walking speed is known only as a range, and none of the sloped tests was at Mars gravity.</p>
    <p>Sources: <a href="https://ntrs.nasa.gov/citations/20070016007" target="_blank" rel="noopener">NASA Walkback Test</a>, <a href="https://ntrs.nasa.gov/citations/20110003409" target="_blank" rel="noopener">NASA Integrated Suit Test 2, NASA/TP-2010-216125</a>.</p>
    <h3>2. What decides the walk: the suit, more than the route</h3>
    <p>The same walks on their body-cost routes, carrying ${suits.load_kg} kg, priced again for suits that remove less or more heat than the ${suits.model_cooling_w} W of this model.</p>
    <table>
      <thead><tr><th>Walk</th>${suits.cooling_w.map((w) => `<th>${w} W${w === suits.model_cooling_w ? ' (model)' : ''}</th>`).join('')}</tr></thead>
      <tbody>${suits.walks.map((walk) => `<tr><td>${walk.name}, ${walk.km} km</td>${middle(walk).map((cell) => `<td>${cellText(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <p><b>With ${suits.cooling_w.at(-1)} W of cooling none of these walks needs a rest.</b> The choice of route changes the count by ${mostSaved === 1 ? 'one rest' : `${mostSaved} rests`} at most. The spread measured on people matters as much as the suit: at ${suits.model_cooling_w} W, the ${hardest.name.toLowerCase()} needs ${cellText(end('low'), ' and ')} at the low end of the spread and ${cellText(end('high'), ' and ')} at the high end. So the question this map puts to a suit designer is how many watts a Mars suit must remove. Made by <code>tools/sensitivity.mjs</code>.</p>
    <h3>3. The radiation layer, tested against Curiosity</h3>
    <p>In eight measurement periods at five places the Curiosity rover measured less radiation where terrain blocked part of the sky. We computed the share of sky blocked at the same rover positions from NASA's elevation model and compared it with the published values.</p>
    <table>
      <thead><tr><th>Place</th><th>Sky blocked, published</th><th>Sky blocked, ours</th><th>Dose drop measured</th></tr></thead>
      <tbody>${check.rows.map((row) => `<tr${Math.abs(row.difference_pct_points) > 1 ? ' class="off"' : ''}>
        <td>${row.period} ${row.place}</td><td>${row.paper_sky_blocked_pct.toFixed(1)}%</td><td>${row.our_sky_blocked_pct.toFixed(1)}%</td><td>${row.measured_dose_decrease_pct.toFixed(1)}%</td></tr>`).join('')}</tbody>
    </table>
    <p><b>${within} of ${check.rows.length} agree within 1 percentage point.</b> Mean difference ${check.summary.mean_absolute_difference_pct_points.toFixed(1)} points. Maria Gordon Notch is a narrow valley and reads 9 points low: our elevation grid is 4 m and the paper used 1 m. This checks the terrain computation. It does not check the dose model.</p>
    <p>Source: <a href="https://elib.dlr.de/224554/" target="_blank" rel="noopener">Guo et al. 2026, JGR Planets 131(4), Table 1</a>. Rover positions: NASA/JPL-Caltech.</p>
    <h3>4. The orbiter passes, computed twice</h3>
    <p>A second computation of the relay orbiter passes, made from spacecraft position vectors with code that shares nothing with the first, found the same 13 passes. Rise and set times agree within 1 minute. The check first placed the observer on a simple sphere, and the height of an orbiter above the horizon then differed by up to 0.8 degree. With the observer placed as in the first computation (on the planet's ellipsoid, about 4 km below the reference level) the two agree within 0.05 degree. The record is in <a href="data/comms/check_passes.json" target="_blank" rel="noopener">data/comms/check_passes.json</a>.</p>
    <p>The Sun's rise and day length from the same method match Curiosity's weather record within 1 minute.</p>`;
  const dialog = $('proof');
  $('proof-open').addEventListener('click', () => dialog.showModal());
  $('proof-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

/* Walk brief */

function download(name, text, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Writes the brief for the route, load and start time now chosen.
function openBrief() {
  const def = ROUTES.find((d) => d.id === state.active);
  const route = state.routes[def.id];
  const args = {
    route,
    routeName: def.name,
    loadKg: state.loadKg,
    comms: state.comms,
    contact: state.contact[def.id] ?? null,
    startMinute: state.startMinute,
    lightMinutes: state.lightMinutes,
    coolingW: state.coolingW,
  };
  const brief = buildBrief(args);
  const list = (lines) => `<ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul>`;
  // The team's own medical checks sit beside the forecast, when written.
  const checks = (part) => (state.checks?.[part]?.length
    ? `<p class="brief-checks-title">Crew doctor's checks, from NASA's medical standards</p>${list(doctorChecks(state.checks, part, args))}` : '');
  $('brief-body').innerHTML = `
    <p class="brief-title">${brief.title}</p>
    <ul class="verdict">${brief.verdict.map((v) => `<li class="${v.level}">${v.text}</li>`).join('')}</ul>
    <h3>Before the walk</h3>${list(brief.before)}${checks('before')}
    <h3>During the walk</h3>
    <table><tbody>${brief.during.map((e) => `<tr class="ev-${e.kind}"><td>${e.where}</td><td>${e.when}</td><td>${e.text}</td></tr>`).join('')}</tbody></table>${checks('during')}
    <h3>After the walk</h3>${list(brief.after)}${checks('after')}
    <h3>Not forecast</h3>${list(NOT_MODELLED)}
    <p class="brief-foot">A forecast from the terrain and published limits, made before the walk. It is not measured on a person and it is not medical advice. Every limit and number is listed under Sources and assumptions.</p>
    <p class="brief-files">The same forecast, point by point, for an onboard system to compare with what a suit measures:
      <button type="button" id="forecast-json">Download JSON</button>
      <button type="button" id="forecast-csv">Download CSV</button></p>`;
  const name = `red-ledger-forecast-${def.id}-${state.loadKg}kg-${state.coolingW}W`;
  $('forecast-json').addEventListener('click', () => download(`${name}.json`, JSON.stringify(forecastFile({ ...args, sources: SOURCES }), null, 1), 'application/json'));
  $('forecast-csv').addEventListener('click', () => download(`${name}.csv`, forecastCsv(route, args.contact), 'text/csv'));
  $('brief').showModal();
  $('brief').scrollTop = 0;
}

function buildBriefControls() {
  const dialog = $('brief');
  $('brief-open').addEventListener('click', openBrief);
  $('brief-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

/* Stops */

function stopMarker(place, number) {
  const icon = L.divIcon({
    className: `stop${place.assumption ? ' stop-assumed' : ''}`,
    html: number === 0 ? 'H' : String(number),
    iconSize: [28, 28],
  });
  return L.marker([place.lat, place.lon], { icon, title: place.name, zIndexOffset: 500 })
    .on('click', () => showPlace(place))
    .addTo(map);
}

// Shows a place in the side card. Stops Curiosity visited carry its own
// photos: a wide view of the ground ahead and a close view of the rock.
function showPlace(place, kind = 'wide') {
  $('target').hidden = false;
  $('target-name').innerHTML = `${place.assumption ? '<i class="assume"></i>' : ''}${place.name}`;
  $('target-text').textContent = place.text;
  $('target-credit').innerHTML = place.source
    ? `<a href="${place.source}" target="_blank" rel="noopener">Source</a>${place.sol ? ` · sol ${place.sol}` : ''}`
    : place.own ? 'A point you placed on the map' : 'Assumption, not a measured or published position';

  const photos = state.photos.filter((ph) => ph.stop === place.id);
  const photo = photos.find((ph) => ph.kind === kind) ?? photos[0];
  $('target-photo').hidden = !photo;
  if (!photo) return;
  const other = photos.find((ph) => ph !== photo);
  const img = $('target-img');
  if (img.getAttribute('src') !== photo.file) {
    img.classList.add('loading');
    img.onload = img.onerror = () => img.classList.remove('loading');
    img.src = photo.file;
  }
  img.alt = photo.caption;
  $('target-caption').innerHTML = `${photo.caption} <a href="${photo.source_url}" target="_blank" rel="noopener">Curiosity ${photo.instrument}, sol ${photo.sol}</a>. ${photo.credit}`;
  $('target-swap').hidden = !other;
  if (other) {
    $('target-swap').textContent = other.kind === 'close' ? 'Close view' : 'Wide view';
    $('target-swap').onclick = () => showPlace(place, other.kind);
  }
}

function arrive(index) {
  const route = state.routes[state.active];
  const el = state.stopMarkers[index % state.stopMarkers.length]?.getElement();
  if (el) {
    el.classList.remove('arrived');
    void el.offsetWidth; // restart the animation
    el.classList.add('arrived');
  }
  showPlace(route.stops[index].place);
}

/* Routes */

/* Contact with a relay orbiter */

// For each route, whether an orbiter is above the terrain at every point,
// given when the walk starts.
function computeContact() {
  if (!state.comms) return;
  for (const def of ROUTES) state.contact[def.id] = state.comms.routeContact(state.routes[def.id].points, state.startMinute);
}

const contactShare = (contact) => contact.inContact.filter(Boolean).length / contact.inContact.length;

// The start times offered: every 20 minutes of daylight on the sol the
// orbiter positions are for. The first choice is the planner's pick, the
// start that keeps the body-cost route in contact for longest.
function buildStartTimes() {
  if (!state.comms) { $('start-wrap').hidden = true; return; }
  const select = $('start-time');
  let best = { minute: 640, share: -1 };
  for (let minute = 640; minute <= 1360; minute += 20) {
    const share = contactShare(state.comms.routeContact(state.routes.body.points, minute));
    if (share > best.share) best = { minute, share };
    select.append(new Option('', String(minute)));
  }
  labelStartTimes();
  state.startMinute = best.minute;
  select.value = String(best.minute);
  select.addEventListener('change', () => {
    setPlaying(false);
    state.startMinute = Number(select.value);
    computeContact();
    buildRouteCards();
    drawProfile();
    renderWalk();
  });
}

// Writes beside each start time how much of the body-cost route now shown
// has an orbiter in view. Called again when the walk, load or suit changes.
function labelStartTimes() {
  if (!state.comms) return;
  for (const option of $('start-time').options) {
    const minute = Number(option.value);
    const share = contactShare(state.comms.routeContact(state.routes.body.points, minute));
    option.textContent = `${state.comms.localTime(minute)} · ${Math.round(share * 100)}% in contact`;
  }
}

// The two route cards and the difference between them. Called again
// whenever the carried load or the start time changes.
function buildRouteCards() {
  const [a, b] = ROUTES.map((def) => state.routes[def.id].totals);
  const card = (def) => {
    const t = state.routes[def.id].totals;
    const steepLimit = (Math.atan(MAX_MEASURED_GRADIENT) * 180 / Math.PI).toFixed(0);
    const over = t.peakHeatNoRest > MODEL.heatLimitKJkg;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'route';
    btn.id = `route-${def.id}`;
    btn.style.setProperty('--route', def.color);
    btn.setAttribute('aria-pressed', String(def.id === state.active));
    btn.innerHTML = `
      <div class="route-name">${def.name}<small>${def.hint}</small></div>
      <div class="route-big">
        <span><b>${(t.seconds / 60).toFixed(0)} min</b><small>${t.restCount ? `incl. ${(t.restSeconds / 60).toFixed(0)} min rest` : 'no rest needed'}</small></span>
        <span><b>${t.kcal.toFixed(0)} kcal</b><small>energy</small></span>
        <span${over ? ' class="over"' : ''}><b>${heatText(t.peakHeatNoRest)} kJ/kg</b><small>${over ? 'over NASA limit unless rested' : 'peak body heat'}</small></span>
      </div>
      <div class="route-small">${(t.dist / 1000).toFixed(2)} km · ${t.climb.toFixed(0)} m climb · steepest ${t.steepestDeg.toFixed(0)}°${
  t.beyondMeasured > 0
    ? `<span class="route-flag" title="${t.beyondMeasured.toFixed(0)} m of this route is steeper than any walking study has measured (over ${steepLimit}°). The energy there is an extrapolation.">${t.beyondMeasured.toFixed(0)} m beyond tested slope</span>`
    : ''}</div>
      <div class="route-small need">${needLine(t)}</div>${contactLine(def.id)}`;
    btn.addEventListener('click', () => selectRoute(def.id, true));
    return btn;
  };
  const delta = document.createElement('div');
  delta.className = 'delta';
  // What the choice of route changes, said in one sentence.
  const longer = Math.round((b.dist - a.dist) / 10) * 10;
  const fewer = a.restCount - b.restCount;
  // The minutes as the two cards show them, so the sentence agrees with them.
  const sooner = Math.round(a.seconds / 60) - Math.round(b.seconds / 60);
  const count = (n) => (n === 1 ? 'one rest' : `${n} rests`);
  const shown = (value, places = 0) => Number(value.toFixed(places));
  const cost = `${signed(shown(b.peakHeatNoRest, 1) - shown(a.peakHeatNoRest, 1), 1)} kJ/kg peak heat · ${signed(shown(b.kcal) - shown(a.kcal))} kcal`;
  const placed = state.own?.stops.length && !state.own.preset;
  delta.innerHTML = fewer === 0 && Math.abs(sooner) < 2
    ? placed
      ? `<b>Here the shortest way is already close to the cheapest.</b>
    <span>No detour saves a rest. The two routes split where the straight line crosses steep ground, as on the ridge and hollow survey.</span>`
      : `<b>Both routes need the same number of rests and take about the same time.</b>
    <span>On the body-cost route: ${cost}</span>`
    : `<b>The body-cost route is ${Math.abs(longer)} m ${longer >= 0 ? 'longer' : 'shorter'}${
      fewer > 0 ? `, needs ${count(fewer)} fewer` : fewer < 0 ? `, needs ${count(-fewer)} more` : ''}${
      sooner > 0 ? ` and is home ${sooner} min sooner` : sooner < 0 ? ` and takes ${-sooner} min longer` : ''}.</b>
    <span>${cost}</span>`;
  $('routes').replaceChildren(card(ROUTES[0]), delta, card(ROUTES[1]));
  showVerdict();
}

// One line on a route card: the cooling a suit needs to keep this walk under
// NASA's heat limit with no rest. The plan itself rests earlier, at a share
// of the limit, so a walk can be under the limit and still have a rest.
function needLine(t) {
  const suit = `(this suit: ${state.coolingW} W)`;
  if (t.peakHeatNoRest > MODEL.heatLimitKJkg) return `To stay under NASA's limit with no rest the suit must remove <b>${t.coolingNeededW} W</b> ${suit}`;
  // The search for that cooling starts at the heat of a body at rest.
  if (t.coolingNeededW <= MODEL.restW + 1) return `Too short to reach NASA's heat limit, even in a suit that removes only the ${MODEL.restW} W of a body at rest ${suit}`;
  return t.restCount
    ? `A suit that removes <b>${t.coolingNeededW} W</b> stays under NASA's limit with no rest ${suit}. The plan rests earlier, at ${MODEL.restAt * 100}% of the limit`
    : `A suit that removes <b>${t.coolingNeededW} W</b> is enough to walk it with no rest ${suit}`;
}

// One line on a route card: how much of the walk has an orbiter in view.
function contactLine(id) {
  const contact = state.contact[id];
  if (!contact) return '';
  const share = Math.round(contactShare(contact) * 100);
  return share === 100
    ? '<div class="route-small contact">Orbiter in view for the whole walk</div>'
    : `<div class="route-small contact out">Orbiter in view ${share}% of the walk · up to ${contact.longestGapMin.toFixed(0)} min with no contact</div>`;
}

// Small marks where the plan makes the walker stand still to shed heat.
function drawRestMarks() {
  state.restMarks.forEach((mark) => mark.remove());
  state.restMarks = state.routes[state.active].restStops.map((rest) => L.marker([rest.lat, rest.lon], {
    icon: L.divIcon({ className: 'rest-mark', html: 'II', iconSize: [22, 22] }),
    zIndexOffset: 400,
  }).bindTooltip(`Rest ${(rest.seconds / 60).toFixed(0)} min here to shed body heat`, { direction: 'top' }).addTo(map));
}

// Shows a pair of routes: the planned walk for a load, or a walk the viewer
// placed. The lines, the cards, the orbiter contact and the 3D view follow.
function showRoutes(routes, ease = true) {
  state.planned = routes;
  // With another suit chosen, the same paths are priced again for it.
  state.routes = state.coolingW === MODEL.coolingW ? routes : Object.fromEntries(ROUTES.map((def) => {
    const route = reprice(routes[def.id], { loadKg: state.loadKg, coolingW: state.coolingW });
    route.totals.lowestLeft = Math.min(...route.points.map((p) => energyLeftPct(p.kcal, p.backKcal)));
    return [def.id, route];
  }));
  for (const def of ROUTES) {
    const lines = state.lines[def.id];
    if (!lines) continue;
    const latlngs = state.routes[def.id].points.map((p) => [p.lat, p.lon]);
    lines.line.setLatLngs(latlngs);
    lines.casing.setLatLngs(latlngs);
  }
  computeContact();
  labelStartTimes();
  buildRouteCards();
  state.view3d?.setRoutes(state.routes);
  if (state.lines[state.active]) selectRoute(state.active, ease);
}

// The sentence under the bars: what the walker makes against what the suit
// removes, for the load and the suit now chosen.
function showLedgerNote() {
  const { loadKg, coolingW } = state;
  const work = Math.round(levelWorkW(loadKg));
  $('ledger-note').innerHTML = `An ${MODEL.bodyMassKg} kg walker in a ${MODEL.suitMassKg} kg suit${loadKg ? `, carrying ${loadKg} kg` : ''}. On flat ground at ${MODEL.paceMs.toFixed(1)} m/s the walker makes <b>${work} W</b> of heat; the suit removes <b>${coolingW} W</b>. ${
    work > coolingW ? `Heat stops building only below ${heatNeutralPace(loadKg, coolingW).toFixed(2)} m/s.` : 'On flat ground no heat builds up; it builds on the climbs.'}`;
}

// Switches the suit's cooling: the same routes are priced again.
function setCooling(coolingW) {
  state.coolingW = coolingW;
  $('cooling').value = String(coolingW);
  $('cooling-value').textContent = `${coolingW} W`;
  showLedgerNote();
  // A free walk goes on in the new suit; the routes are priced when it ends.
  if (state.free) { state.free.ledger.coolingW = coolingW; return; }
  setPlaying(false);
  if (state.planned) showRoutes(state.planned, false);
}

// Switches the carried load: the routes, the cards and the ledger all change.
function setLoad(loadKg, ease = true) {
  endFree();
  setPlaying(false);
  state.loadKg = loadKg;
  for (const btn of $('loads').children) btn.setAttribute('aria-pressed', String(Number(btn.dataset.kg) === loadKg));
  showLedgerNote();
  // The reach layer is drawn for the load shown.
  const reachLayer = state.overlays.find((overlay) => overlay.id === 'reach')?.leaf;
  if (reachLayer && state.reach) reachLayer.setUrl(state.reach.image(loadKg));
  // A walk the viewer placed is planned again for the new load.
  if (state.own?.stops.length) { planOwn(); return; }
  showRoutes(state.plans[loadKg], ease);
}

function buildLoads() {
  for (const kg of Object.keys(state.plans).map(Number).sort((x, y) => x - y)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.kg = String(kg);
    btn.textContent = kg === 0 ? 'No load' : `${kg} kg`;
    btn.title = SOURCES.load.what;
    btn.addEventListener('click', () => setLoad(kg));
    $('loads').append(btn);
  }
}

function selectRoute(id, ease = false) {
  setPlaying(false);
  state.active = id;
  state.dist = 0;
  state.nextStop = 1;
  for (const def of ROUTES) {
    const on = def.id === id;
    const { line, casing } = state.lines[def.id];
    $(`route-${def.id}`).setAttribute('aria-pressed', String(on));
    line.setStyle({ opacity: on ? 1 : 0.7, weight: on ? 6 : 3.5 });
    casing.setStyle({ weight: on ? 10 : 6.5 });
    if (on) { casing.bringToFront(); line.bringToFront(); }
  }
  drawRestMarks();
  drawProfile();
  showVerdict();
  state.view3d?.setRoute(id);
  if (state.view3d?.isShown()) setFollow(false);
  renderWalk(ease);
}

// Draws a route onto the map from its start to its end.
function drawIn(def, ms) {
  const latlngs = state.routes[def.id].points.map((p) => [p.lat, p.lon]);
  // The class lets the page's styles step the lines back while they are
  // not the viewer's own.
  const casing = L.polyline([], { className: 'route-line', color: '#0c0908', weight: 6.5, opacity: 0.65, lineJoin: 'round', interactive: false }).addTo(map);
  // A click on a route chooses it; it must not also reach the map, where it
  // would place a stop in a walk of the viewer's own.
  const line = L.polyline([], { className: 'route-line', color: def.color, weight: 3.5, opacity: 0.7, lineJoin: 'round', bubblingMouseEvents: false }).addTo(map);
  line.on('click', () => selectRoute(def.id, true));
  state.lines[def.id] = { line, casing };
  return new Promise((done) => {
    const start = performance.now();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      line.setLatLngs(latlngs);
      casing.setLatLngs(latlngs);
      done();
    };
    const frame = (now) => {
      if (finished) return;
      const t = Math.min(1, (now - start) / ms);
      const upTo = latlngs.slice(0, Math.max(2, Math.round(latlngs.length * t)));
      line.setLatLngs(upTo);
      casing.setLatLngs(upTo);
      if (t < 1) requestAnimationFrame(frame); else finish();
    };
    requestAnimationFrame(frame);
    // A browser draws no frames for a tab in the background. The timer makes
    // sure the route is complete even then.
    setTimeout(finish, ms + 300);
  });
}

const walker = L.marker([0, 0], {
  icon: L.divIcon({ className: 'walker', html: '<i></i>', iconSize: [30, 30] }),
  interactive: false,
  zIndexOffset: 1000,
});

// Updates everything that depends on how far the walker has gone.
function renderWalk(ease = false) {
  const route = state.routes[state.active];
  const p = pointAt(route, state.dist);
  walker.setLatLng([p.lat, p.lon]);
  $('progress').value = String(Math.round((state.dist / route.totals.dist) * 1000));
  $('progress-text').textContent = state.dist > 0
    ? `${(p.seconds / 60).toFixed(0)} min · ${Math.abs(Math.atan(p.gradient) * 180 / Math.PI).toFixed(0)}° ${p.gradient >= 0 ? 'up' : 'down'} · ${p.speed.toFixed(1)} m/s · ${Math.round(p.metabolicW)} W${contactNow(p)}`
    : 'Press Walk, or drag the slider';
  if (state.view3d?.isShown()) state.view3d.setWalker(state.dist);
  renderLedger(ease);
  drawProfileCursor();
}

// What the walker can reach by radio at this moment of the walk.
function contactNow(p) {
  if (!state.comms) return '';
  const minute = state.startMinute + p.seconds / 60;
  const names = state.comms.inView(p.lat, p.lon, minute);
  if (names == null) return '';
  if (names.length) return ` · ${names.join(' and ')} in view`;
  const blocked = state.comms.blockedBy(p.lat, p.lon, minute);
  return blocked?.length ? ` · terrain blocks ${blocked.join(' and ')}` : ' · no orbiter in view';
}

/* Elevation profile */

const profile = { canvas: $('profile'), image: null };

function profileScale() {
  const route = state.routes[state.active];
  const { canvas } = profile;
  let lo = Infinity;
  let hi = -Infinity;
  for (const def of ROUTES) {
    for (const p of state.routes[def.id].points) { lo = Math.min(lo, p.elev); hi = Math.max(hi, p.elev); }
  }
  const pad = 7 * devicePixelRatio;
  return {
    x: (d) => (d / route.totals.dist) * canvas.width,
    y: (e) => canvas.height - pad - ((e - lo) / (hi - lo)) * (canvas.height - 2 * pad),
  };
}

function drawProfile() {
  const { canvas } = profile;
  if (!canvas.clientWidth) return;
  const route = state.routes[state.active];
  const def = ROUTES.find((d) => d.id === state.active);
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  const { x, y } = profileScale();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Ground line, drawn red where the step is steeper than the measurements cover.
  ctx.lineWidth = 2.5 * devicePixelRatio;
  ctx.lineJoin = 'round';
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1];
    const b = route.points[i];
    ctx.strokeStyle = Math.abs(b.gradient) > MAX_MEASURED_GRADIENT ? '#ff5533' : def.color;
    ctx.beginPath();
    ctx.moveTo(x(a.dist), y(a.elev));
    ctx.lineTo(x(b.dist), y(b.elev));
    ctx.stroke();
  }
  // A strip along the bottom: blue where an orbiter is in view, dark where not.
  const contact = state.contact[state.active];
  if (contact) {
    const h = 3 * devicePixelRatio;
    for (let i = 1; i < route.points.length; i++) {
      ctx.fillStyle = contact.inContact[i] ? '#6aa8ff' : '#4a332c';
      ctx.fillRect(x(route.points[i - 1].dist), canvas.height - h, Math.max(1, x(route.points[i].dist) - x(route.points[i - 1].dist)), h);
    }
  }
  ctx.fillStyle = '#a1a1a6';
  ctx.font = `${12 * devicePixelRatio}px Inter, system-ui, sans-serif`;
  route.stops.forEach((s, i) => {
    const label = i === 0 || i === route.stops.length - 1 ? 'H' : String(i);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x(s.dist) - 0.5, 0, 1, canvas.height);
    ctx.globalAlpha = 1;
    ctx.fillText(label, Math.min(x(s.dist) + 5, canvas.width - 14 * devicePixelRatio), 13 * devicePixelRatio);
  });
  profile.image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  drawProfileCursor();
}

function drawProfileCursor() {
  if (!profile.image) return;
  const { canvas } = profile;
  const ctx = canvas.getContext('2d');
  const { x, y } = profileScale();
  const p = pointAt(state.routes[state.active], state.dist);
  ctx.putImageData(profile.image, 0, 0);
  ctx.fillStyle = '#f3ebe0';
  ctx.strokeStyle = '#0c0908';
  ctx.lineWidth = 2 * devicePixelRatio;
  ctx.beginPath();
  ctx.arc(x(p.dist), y(p.elev), 5 * devicePixelRatio, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
}

/* 3D view */

// The 3D view is made the first time it is opened, because it has to load
// and stitch the imagery for the terrain.
// `instant` skips the fade, for the V key.
// Builds the 3D view once, without showing it. The recorded sequence calls
// this first, so its first walk does not wait for the terrain to load.
let view3dLoading = null;
function loadView3D() {
  view3dLoading ??= (async () => {
    const { createView3D } = await import('./view3d.js');
    state.view3d = await createView3D($('view3d'), {
      terrain: state.terrain,
      routes: state.routes,
      colors: Object.fromEntries(ROUTES.map((def) => [def.id, def.color])),
    });
    // The walking astronaut instead of the dot; the dot stays if it cannot load.
    state.view3d.setWalkerFigure?.('img/walker.png');
    // Height x2 may have been pressed while the view was loading.
    if ($('view-height').getAttribute('aria-pressed') === 'true') state.view3d.setExaggeration(2);
  })();
  return view3dLoading;
}

async function setView3D(on, instant = false) {
  $('view3d').classList.toggle('v3d-instant', instant);
  $('view-map').setAttribute('aria-pressed', String(!on));
  $('view-3d').setAttribute('aria-pressed', String(on));
  for (const id of ['view-follow', 'view-height']) $(id).hidden = !on;
  $('view3d').hidden = !on;
  if (!on) { state.view3d?.hide(); return; }
  if (!state.view3d) {
    $('view-3d').textContent = 'Loading…';
    await loadView3D();
    $('view-3d').textContent = '3D';
  }
  // Without WebGL the walk simply stays on the map.
  if (!state.view3d.available) { setView3D(false); return; }
  state.view3d.show();
  state.view3d.resize();
  state.view3d.setRoute(state.active);
  state.view3d.setWalker(state.dist);
  state.view3d.setSlopeTint($('overlay-slope').getAttribute('aria-pressed') === 'true');
}

function setFollow(on) {
  $('view-follow').setAttribute('aria-pressed', String(on));
  state.view3d?.setMode(on ? 'chase' : 'orbit');
}

// Pressing Walk moves to the 3D view and follows the walker over the ground.
async function startWalk() {
  await setView3D(true);
  if (state.view3d?.isShown()) setFollow(true);
  setPlaying(true);
}

function buildViewSwitch() {
  $('view-map').addEventListener('click', () => setView3D(false));
  $('view-3d').addEventListener('click', () => setView3D(true));
  $('view-follow').addEventListener('click', (e) => setFollow(e.currentTarget.getAttribute('aria-pressed') !== 'true'));
  $('view-height').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    state.view3d?.setExaggeration(on ? 2 : 1);
  });
  window.addEventListener('resize', () => state.view3d?.resize());
}

/* Walk control */

// A full walk plays in about 40 seconds whatever its length. The recorded
// sequence shortens this.
let playSeconds = 40;
// How long the walker stands still on screen at a planned rest.
let restPauseMs = 1600;

// Each press of Walk starts a new loop with its own number, so a frame left
// over from an earlier loop stops instead of running alongside the new one.
let loopId = 0;
let lastFollow = 0;

// Keeps the walker inside the part of the map that no panel covers.
function follow(now) {
  if (now - lastFollow < 400) return;
  lastFollow = now;
  const area = clearArea();
  const at = map.latLngToContainerPoint(walker.getLatLng());
  const margin = 60;
  if (at.x > area.left + margin && at.x < area.right - margin && at.y > area.top + margin && at.y < area.bottom - margin) return;
  map.panBy([at.x - (area.left + area.right) / 2, at.y - (area.top + area.bottom) / 2], { animate: !calm, duration: 0.9 });
}

function tick(last, id) {
  if (!state.playing || id !== loopId) return;
  const now = performance.now();
  const route = state.routes[state.active];
  const total = route.totals.dist;
  // At a planned rest the walker stands still for a moment on screen while
  // the clock and the heat bar jump to the end of the rest.
  const rest = route.restStops.find((r) => r.dist > state.dist && r.dist <= state.dist + ((now - last) / 1000) * (total / playSeconds));
  if (rest) {
    state.dist = rest.dist;
    renderWalk();
    $('progress-text').textContent = `Resting ${(rest.seconds / 60).toFixed(0)} min to shed body heat`;
    setTimeout(() => {
      if (!state.playing || id !== loopId) return;
      state.dist = Math.min(total, rest.dist + 1);
      renderWalk(true);
      requestAnimationFrame(() => tick(performance.now(), id));
    }, restPauseMs);
    return;
  }
  state.dist = Math.min(total, state.dist + ((now - last) / 1000) * (total / playSeconds));
  renderWalk();
  follow(now);
  if (state.nextStop < route.stops.length && state.dist >= route.stops[state.nextStop].dist) {
    arrive(state.nextStop);
    state.nextStop++;
  }
  if (state.dist >= total) { setPlaying(false); state.onWalkEnd?.(); return; }
  requestAnimationFrame(() => tick(now, id));
}

function setPlaying(on) {
  state.playing = on;
  loopId++;
  $('play').textContent = on ? 'Pause' : 'Walk';
  if (!on) return;
  if (state.dist >= state.routes[state.active].totals.dist) { state.dist = 0; state.nextStop = 1; }
  const id = loopId;
  requestAnimationFrame(() => tick(performance.now(), id));
}

function buildWalkControls() {
  $('play').disabled = false;
  $('progress').disabled = false;
  $('play').addEventListener('click', () => { endFree(); if (state.playing) setPlaying(false); else startWalk(); });
  $('progress').addEventListener('input', (e) => {
    setPlaying(false);
    const route = state.routes[state.active];
    state.dist = (Number(e.target.value) / 1000) * route.totals.dist;
    state.nextStop = route.stops.findIndex((s, i) => i > 0 && s.dist > state.dist);
    if (state.nextStop === -1) state.nextStop = route.stops.length;
    renderWalk();
  });
  $('target-close').addEventListener('click', () => { $('target').hidden = true; });
  window.addEventListener('resize', drawProfile);

  // A click anywhere ends a recording sequence before the control acts, so
  // the sequence never waits on a walk the viewer has stopped.
  document.addEventListener('pointerdown', stopSequence, true);

  $('free').disabled = false;
  $('free').addEventListener('click', () => (state.free ? endFree() : startFree()));
  window.addEventListener('keyup', (e) => keysDown.delete(e.key));

  // Keys, so a walk-through can be run without the mouse: Space plays or
  // pauses, D and B choose the route, 1 to 6 choose the overlay.
  window.addEventListener('keydown', (e) => {
    if (state.free) {
      // In a free walk the arrow keys steer; nothing else is bound.
      if (e.key.startsWith('Arrow')) { e.preventDefault(); keysDown.add(e.key); }
      if (e.key === 'Escape') endFree();
      return;
    }
    // During a recording sequence only Escape (stop) and R are bound.
    if (state.sequence) {
      if (e.key === 'Escape') stopSequence();
      if (e.key === 'r' || e.key === 'R') document.body.classList.toggle('rec');
      return;
    }
    if (e.target.closest?.('input, button, summary, dialog, select') && e.key !== ' ') return;
    if (e.key === ' ') { e.preventDefault(); if (state.playing) setPlaying(false); else startWalk(); }
    if (e.key === 'r' || e.key === 'R') document.body.classList.toggle('rec');
    if (e.key === 'v' || e.key === 'V') setView3D($('view3d').hidden, true);
    if (e.key === 'p' || e.key === 'P') runSequence(e.shiftKey);
    if (e.key === 'o' || e.key === 'O') { if (state.own) endOwn(); else startOwn(); }
    if (e.key === 'd' || e.key === 'D') selectRoute('direct', true);
    if (e.key === 'b' || e.key === 'B') selectRoute('body', true);
    if (e.key === 'l' || e.key === 'L') {
      const loads = Object.keys(state.plans).map(Number).sort((x, y) => x - y);
      setLoad(loads[(loads.indexOf(state.loadKg) + 1) % loads.length]);
    }
    const overlay = state.overlays[Number(e.key) - 1];
    if (overlay) setOverlay(overlay.id);
  });
}

/* Free walk: the viewer steers, the body answers */

const DEG = Math.PI / 180;
const MARS_RADIUS = 3396190;
const FREE = {
  timeScale: 30,   // one second on screen is this many seconds of walking
  lookAhead: 4,    // metres ahead used to read the slope under the walker
  turnDegPerS: 100,
  tickMs: 50,
  arriveM: 14,     // how close counts as reaching a stop
};
const keysDown = new Set();

// A point `metres` away from (lat, lon) in the direction `headingDeg`
// (clockwise from north).
function ahead(lat, lon, headingDeg, metres) {
  return {
    lat: lat + (metres * Math.cos(headingDeg * DEG)) / MARS_RADIUS / DEG,
    lon: lon + (metres * Math.sin(headingDeg * DEG)) / (MARS_RADIUS * Math.cos(lat * DEG)) / DEG,
  };
}

function metresBetween(a, b) {
  return Math.hypot((a.lat - b.lat) * DEG * MARS_RADIUS, (a.lon - b.lon) * DEG * MARS_RADIUS * Math.cos(a.lat * DEG));
}

async function startFree() {
  setPlaying(false);
  stopSequence();
  // Like a planned walk, a free walk is shown on the 3D ground, from behind.
  await setView3D(true);
  if (state.view3d?.isShown()) setFollow(true);
  const home = state.walk.habitat;
  // Facing the first stop, so "forward" starts in a useful direction.
  const first = state.walk.stops[0];
  const heading = Math.atan2((first.lon - home.lon) * Math.cos(home.lat * DEG), first.lat - home.lat) / DEG;
  state.free = {
    lat: home.lat,
    lon: home.lon,
    heading,
    ledger: new Ledger(state.coolingW),
    dist: 0,
    rests: 0,
    peakHeat: 0,
    trail: [[home.lat, home.lon]],
    reached: new Set(),
    pausedUntil: 0,
    message: 'Arrow keys: turn and walk. Reach stop 3 without overheating.',
    back: returnCost(state.terrain, home, state.loadKg),
    line: L.polyline([[home.lat, home.lon]], { color: '#f3ebe0', weight: 4, opacity: 0.95 }).addTo(map),
    timer: setInterval(freeTick, FREE.tickMs),
    last: performance.now(),
  };
  document.body.classList.add('free');
  $('free').textContent = 'End free walk';
  state.view3d?.setRoutesVisible?.(false);
  renderFree();
}

function endFree() {
  if (!state.free) return;
  clearInterval(state.free.timer);
  state.free.line.remove();
  state.free = null;
  keysDown.clear();
  document.body.classList.remove('free');
  $('free').textContent = 'Free walk';
  state.view3d?.clearTrail?.();
  state.view3d?.setRoutesVisible?.(true);
  // The suit may have changed during the free walk.
  if (state.planned) showRoutes(state.planned, false); else selectRoute(state.active);
}

// One step of the free walk. The same body model as the planned routes runs
// on whatever ground the viewer chooses.
function freeTick() {
  const f = state.free;
  const now = performance.now();
  const dt = Math.min(0.2, (now - f.last) / 1000);
  f.last = now;
  if (now < f.pausedUntil) return;
  if (keysDown.has('ArrowLeft')) f.heading -= FREE.turnDegPerS * dt;
  if (keysDown.has('ArrowRight')) f.heading += FREE.turnDegPerS * dt;
  if (keysDown.has('ArrowUp')) {
    const here = state.terrain.elevSmooth(f.lat, f.lon);
    const probe = ahead(f.lat, f.lon, f.heading, FREE.lookAhead);
    const there = state.terrain.elevSmooth(probe.lat, probe.lon);
    if (here == null || there == null) {
      f.message = 'Edge of the surveyed patch.';
    } else {
      const gradient = (there - here) / FREE.lookAhead;
      if (Math.abs(gradient) > MAX_MEASURED_GRADIENT) {
        f.message = `Too steep to walk: ${Math.round(Math.atan(Math.abs(gradient)) / DEG)}°. No walking study covers ground this steep.`;
      } else {
        // The model sets the pace for this slope; the walker covers what
        // that pace allows in this slice of time.
        const pace = step(FREE.lookAhead, gradient * FREE.lookAhead, state.loadKg).speed;
        const run = pace * dt * FREE.timeScale;
        const next = ahead(f.lat, f.lon, f.heading, run);
        const sky = state.sky?.at(next.lat, next.lon) ?? MODEL.skyReferencePct;
        const taken = step(run, gradient * run, state.loadKg);
        f.ledger.add(taken, sky);
        f.now = { ...taken, gradient, sky };
        f.lat = next.lat;
        f.lon = next.lon;
        f.dist += taken.length;
        f.peakHeat = Math.max(f.peakHeat, f.ledger.heatKJkg);
        f.message = '';
        const lastPoint = f.trail[f.trail.length - 1];
        if (metresBetween({ lat: lastPoint[0], lon: lastPoint[1] }, f) > 3) {
          f.trail.push([f.lat, f.lon]);
          f.line.setLatLngs(f.trail);
          state.view3d?.setTrail?.(f.trail.map(([lat, lon]) => ({ lat, lon })));
        }
        if (f.ledger.needsRest) {
          const seconds = f.ledger.rest(sky);
          f.rests++;
          f.pausedUntil = now + 1800;
          f.message = `Body heat near NASA's limit. Resting ${(seconds / 60).toFixed(0)} min to shed it.`;
        }
        state.walk.stops.forEach((stop, i) => {
          if (f.reached.has(stop.id) || metresBetween(stop, f) > FREE.arriveM) return;
          f.reached.add(stop.id);
          showPlace(stop);
          f.message = `Reached stop ${i + 1} in ${(f.ledger.seconds / 60).toFixed(0)} min. Peak body heat ${f.peakHeat.toFixed(1)} kJ/kg, ${f.rests} forced rest${f.rests === 1 ? '' : 's'}.`;
          f.pausedUntil = now + 1500;
        });
      }
    }
  }
  renderFree();
}

function renderFree() {
  const f = state.free;
  walker.setLatLng([f.lat, f.lon]);
  state.view3d?.setWalkerAt?.(f.lat, f.lon, f.heading);
  const ledger = f.ledger;
  const cell = state.terrain.toCell(f.lat, f.lon);
  const back = f.back[Math.floor(cell.row) * state.terrain.cols + Math.floor(cell.col)] ?? 0;
  $('ledger-mode').textContent = `free walk · ${fmt(Math.round(f.dist))} m`;
  setBar('energy', { value: ledger.kcal, max: MODEL.energyBudgetKcal, note: `${ASSUMED}of a ${fmt(MODEL.energyBudgetKcal)} kcal backpack budget` });
  setBar('heat', {
    value: ledger.heatKJkg,
    max: MODEL.heatContingencyKJkg,
    limit: MODEL.heatLimitKJkg,
    note: `${ASSUMED}stored now · body about +${tempRiseC(ledger.heatKJkg).toFixed(1)} °C · ${f.rests} forced rest${f.rests === 1 ? '' : 's'} · mark: NASA limit ${MODEL.heatLimitKJkg.toFixed(1)}`,
  });
  setBar('dose', {
    value: ledger.doseUSv,
    max: Math.max(...ROUTES.map((d) => state.routes[d.id].totals.dose)) * 1.15,
    note: `${ASSUMED}${((ledger.doseUSv / MODEL.careerLimitUSv) * 100).toFixed(3)}% of NASA's career limit`,
  });
  setBar('home', {
    value: ((MODEL.energyBudgetKcal - ledger.kcal - back) / MODEL.energyBudgetKcal) * 100,
    max: 100,
    note: `after the ${Math.round(back)} kcal cheapest way back from here`,
  });
  const live = f.now
    ? `${(ledger.seconds / 60).toFixed(0)} min · ${Math.round(Math.atan(Math.abs(f.now.gradient)) / DEG)}° ${f.now.gradient >= 0 ? 'up' : 'down'} · ${f.now.speed.toFixed(1)} m/s · ${Math.round(f.now.metabolicW)} W`
    : '';
  $('progress-text').textContent = f.message || live;
}

/* Your own walk: the viewer places the stops, the planner does the rest */

// The search for a walk the viewer placed runs in a worker (js/planner.js),
// with the same route code and body model as the planned walk.
const OWN_MAX_STOPS = 4;
const OWN_HINT = `Click the ground inside the dashed frame to place a stop (up to ${OWN_MAX_STOPS}). Until then the routes and numbers are those of the ridge and hollow survey.`;
let planner = null;

function ownSay(text) {
  $('own-hint-text').textContent = text;
  showVerdict();
}

// What a walk the viewer placed comes to, in one sentence, for the route
// now chosen. A forecast of the plan, so it says so.
function showVerdict() {
  const own = state.own;
  const t = own?.stops.length && !own.preset && state.routes ? state.routes[state.active].totals : null;
  let verdict = '';
  if (t) {
    const home = `home in ${(t.seconds / 60).toFixed(0)} min`;
    verdict = t.lowestLeft <= 0
      ? 'Forecast: the backpack runs out of energy before you are home.'
      : t.restCount
        ? `Forecast: you make it there and back with ${t.restCount === 1 ? '1 rest' : `${t.restCount} rests`} to shed body heat, ${home}.`
        : `Forecast: you make it there and back with no rest, ${home}.`;
  }
  // The verdict takes the place of the walk's goal line in the panel; the
  // hint at the foot of the map shows only while there is something to say.
  $('own-verdict').textContent = verdict;
  $('own-verdict').hidden = !verdict;
  $('walk-goal-text').hidden = !!verdict;
  $('own-hint').hidden = !$('own-hint-text').textContent;
}

// While a walk of the viewer's own has no stop yet, the routes on screen
// are the survey's, and the page marks them as such.
function markOwnEmpty() {
  document.body.classList.toggle('own-empty', !!state.own && !state.own.stops.length);
}

// Redraws the viewer's stops with their numbers. The habitat mark stays
// first, so a stop's place in the list matches its place on the walk.
function drawOwnStops() {
  const own = state.own;
  own.markers.forEach((marker) => marker.remove());
  // A stop of a ready-made walk is a real place: a click shows what
  // Curiosity did there. A stop the viewer placed is removed by a click.
  own.markers = own.stops.map((stop, i) => L.marker([stop.lat, stop.lon], {
    icon: L.divIcon({ className: stop.own === false ? 'stop' : 'stop stop-own', html: String(i + 1), iconSize: [28, 28] }),
    title: stop.own === false ? stop.name : `${stop.name}. Click to remove it.`,
    zIndexOffset: 500,
  }).on('click', () => {
    if (stop.own === false) { showPlace(stop); return; }
    own.stops.splice(own.stops.indexOf(stop), 1);
    own.stops.forEach((s, k) => { if (s.own !== false) s.name = `Your stop ${k + 1}`; });
    own.preset = null;
    showWalkGoal();
    drawOwnStops();
    planOwn();
  }).addTo(map));
  state.stopMarkers = [own.surveyed[0], ...own.markers];
  markOwnEmpty();
}

// Plans the walk through the viewer's stops for the load now shown.
async function planOwn() {
  const own = state.own;
  const turn = ++own.turn;
  setPlaying(false);
  if (!own.stops.length) {
    own.planned = [];
    $('routes').removeAttribute('aria-busy');
    showRoutes(state.plans[state.loadKg]);
    ownSay(OWN_HINT);
    return;
  }
  ownSay('Planning your walk…');
  $('routes').setAttribute('aria-busy', 'true');
  // When no walk can be planned, the stops go back to those of the walk on
  // screen. Several clicks may have been made since that walk was planned.
  const refuse = (why) => {
    own.stops = [...own.planned];
    drawOwnStops();
    ownSay(`${why} Choose another point.`);
  };
  try {
    const result = await planner.plan({ stops: own.stops, loadKg: state.loadKg });
    // A newer request, or leaving this mode, makes this answer out of date.
    if (!result || state.own !== own || turn !== own.turn) return;
    if (!result.direct || !result.body) {
      refuse(`No route reaches that point on ground of ${Math.round(Math.atan(MAX_MEASURED_GRADIENT) * 180 / Math.PI)}° or less, the steepest slope walking cost has been measured on.`);
      return;
    }
    own.planned = [...own.stops];
    showRoutes({ direct: result.direct, body: result.body });
    // Only a stop the viewer placed can be removed.
    const remove = own.stops.some((stop) => stop.own !== false) ? 'click a stop you placed to remove it' : '';
    ownSay(own.preset ? '' : own.stops.length < OWN_MAX_STOPS
      ? `Your walk has ${own.stops.length === 1 ? '1 stop' : `${own.stops.length} stops`}. Click the ground to add one${remove ? `, or ${remove}` : ''}.`
      : `Your walk has ${OWN_MAX_STOPS} stops, the most a walk here can have.${remove ? ` To change it, ${remove}.` : ''}`);
  } catch (error) {
    if (state.own === own && turn === own.turn) refuse(error.message);
  } finally {
    if (state.own !== own || turn === own.turn) $('routes').removeAttribute('aria-busy');
  }
}

// Starts a walk planned in the page: a ready-made one when `preset` is
// given, else an empty walk for the viewer to place.
function startOwn(preset = null) {
  if (state.own || !state.ready) return;
  endFree();
  stopSequence();
  setPlaying(false);
  setView3D(false);
  $('target').hidden = true;
  planner ??= createPlanner();
  // The surveyed stops leave the map. The habitat stays: every walk starts
  // and ends there.
  state.stopMarkers.slice(1).forEach((marker) => marker.remove());
  state.own = {
    stops: [],
    planned: [],   // the stops of the walk whose routes are on screen
    markers: [],
    surveyed: state.stopMarkers,
    turn: 0,
    // The edge of the elevation crop: the ground the planner knows.
    frame: L.rectangle(state.terrain.bounds, { color: '#f3ebe0', weight: 1.5, dashArray: '4 7', fill: false, interactive: false }).addTo(map),
  };
  map.flyToBounds(state.terrain.bounds, { ...boundsPadding(), duration: 0.8, animate: !calm });
  document.body.classList.add('own');
  markOwnEmpty();
  $('own').setAttribute('aria-pressed', 'true');
  $('own').textContent = preset ? 'Leave this walk' : 'End own walk';
  state.own.preset = preset;
  showWalkGoal();
  if (!preset) { ownSay(OWN_HINT); return; }
  const places = { ...state.walks.places, ...Object.fromEntries(state.walk.stops.map((stop) => [stop.id, stop])) };
  state.own.stops = preset.stops.map((id) => ({ ...places[id], own: false }));
  drawOwnStops();
  planOwn();
}

function endOwn() {
  const own = state.own;
  if (!own) return;
  state.own = null;
  own.markers.forEach((marker) => marker.remove());
  own.frame.remove();
  state.stopMarkers = own.surveyed;
  state.stopMarkers.slice(1).forEach((marker) => marker.addTo(map));
  document.body.classList.remove('own');
  markOwnEmpty();
  $('own').setAttribute('aria-pressed', 'false');
  $('own').textContent = 'Own walk';
  $('routes').removeAttribute('aria-busy');
  $('target').hidden = true;
  ownSay('');
  setPlaying(false);
  showWalkGoal();
  showRoutes(state.plans[state.loadKg]);
}

/* Ready-made walks */

// Shows which walk is on screen and what it is for.
function showWalkGoal() {
  if (!state.walks) return;
  const stored = state.walks.walks.find((walk) => walk.stored);
  const shown = state.own ? (state.own.preset ?? state.walks.own) : stored;
  $('walk-pick').value = state.own ? (state.own.preset?.id ?? 'own') : stored.id;
  $('walk-goal-text').textContent = shown.goal;
}

// Switches to a ready-made walk, or to an empty walk of the viewer's own.
function pickWalk(id) {
  const walk = state.walks?.walks.find((entry) => entry.id === id);
  if (id !== 'own' && !walk) return;
  if (state.free || state.sequence || !state.ready) { showWalkGoal(); return; }
  endOwn();
  if (id === 'own') startOwn();
  else if (!walk.stored) startOwn(walk);
}

function buildWalkPick() {
  if (!state.walks) return;
  const options = [...state.walks.walks, { id: 'own', name: state.walks.own.name }];
  $('walk-pick').replaceChildren(...options.map((walk) => new Option(walk.name, walk.id)));
  $('walk-pick').addEventListener('change', (e) => pickWalk(e.target.value));
  $('walk-pick').disabled = !state.ready;
  $('walk-goal').hidden = false;
  showWalkGoal();
}

function buildOwnControls() {
  $('own').addEventListener('click', () => (state.own ? endOwn() : startOwn()));
  map.on('click', (e) => {
    const own = state.own;
    if (!own || state.free || state.sequence) return;
    if (own.stops.length >= OWN_MAX_STOPS) {
      ownSay(`A walk here has at most ${OWN_MAX_STOPS} stops. Click a stop you placed to remove it.`);
      return;
    }
    // A point off the elevation data is never added to the walk.
    if (!Number.isFinite(state.terrain.elevAt(e.latlng.lat, e.latlng.lng) ?? NaN)) {
      ownSay('That point is outside the surveyed patch. Choose another point.');
      return;
    }
    own.preset = null;
    showWalkGoal();
    own.stops.push({
      lat: e.latlng.lat,
      lon: e.latlng.lng,
      name: `Your stop ${own.stops.length + 1}`,
      text: 'A stop you placed. The planner found the way there and back from the terrain; nothing here was chosen for its science.',
    });
    drawOwnStops();
    planOwn();
  });
}

/* Recording mode */

// One walk from start to end in a given number of seconds.
function walkOnce(seconds) {
  return new Promise((done) => {
    playSeconds = seconds;
    state.dist = 0;
    state.nextStop = 1;
    state.onWalkEnd = done;
    startWalk();
  });
}

function stopSequence() {
  if (!state.sequence) return;
  state.sequence = false;
  setPlaying(false);
  state.onWalkEnd?.();
}

// The fixed sequences for a screen recording. Each plays the same way every
// time; Escape stops it. The short one (key P) fits the 16 seconds that a
// 30-second video leaves for the product. The long one (Shift+P) also shows
// the walk with no load, the sky layer and more of the test sheet.
async function runSequence(long = false) {
  if (state.sequence) return;
  state.sequence = true;
  const hold = async (ms) => {
    await wait(ms);
    if (!state.sequence) throw new Error('stopped');
  };
  const heaviest = Math.max(...Object.keys(state.plans).map(Number));
  try {
    endOwn();
    await loadView3D();
    $('target').hidden = true;
    if (long) await longSequence(hold, heaviest);
    else await shortSequence(hold, heaviest);
  } catch {
    // stopped with Escape
  } finally {
    state.sequence = false;
    state.onWalkEnd = null;
    playSeconds = 40;
    restPauseMs = 1600;
  }
}

// About 16 seconds: the heavy load on the direct route with its three
// rests, the body-cost route with two, then the test sheet.
async function shortSequence(hold, heaviest) {
  restPauseMs = 600;
  setOverlay('slope');
  setLoad(heaviest);
  selectRoute('direct', true);
  await hold(1000);
  await walkOnce(4.2);
  await hold(600);
  $('target').hidden = true;
  selectRoute('body', true);
  await hold(800);
  await walkOnce(3);
  await hold(500);
  $('target').hidden = true;
  $('proof').showModal();
  await hold(2000);
  $('proof').close();
}

async function longSequence(hold, heaviest) {
  setOverlay('none');
  setLoad(0);
  selectRoute('direct', true);
  await hold(1800);
  // Give the walker the heaviest load: the direct route now needs three rests.
  setLoad(heaviest);
  await hold(2200);
  setOverlay('slope');
  await hold(1500);
  await walkOnce(12);
  await hold(1800);
  $('target').hidden = true;
  selectRoute('body', true);
  await hold(2200);
  await walkOnce(10);
  await hold(1800);
  $('target').hidden = true;
  setOverlay('sky');
  await hold(2500);
  $('proof').showModal();
  await hold(4500);
  $('proof').close();
  setOverlay('none');
  selectRoute('direct', true);
  await hold(1500);
  selectRoute('body', true);
}

/* Start */

async function start() {
  fitBars();
  buildImagery();
  buildBars();
  buildSources();
  buildRoverPath();
  buildWeather();
  buildProof();

  buildBriefControls();
  fetch('data/brief_checks.json').then((r) => (r.ok ? r.json() : null)).then((checks) => { state.checks = checks; }).catch(() => {});
  const [terrain, sky, comms, walk, photos] = await Promise.all([
    loadTerrain(),
    loadSky(),
    loadComms().catch(() => null), // the page still works without the comms data
    fetch('data/walk.json').then((r) => r.json()),
    fetch('data/photos.json').then((r) => r.json()),
  ]);
  Object.assign(state, { terrain, sky, comms, walk, photos: photos.photos });
  buildOverlays(terrain, sky, comms);
  buildViewSwitch();
  buildMapCredits(terrain);

  document.body.classList.remove('booting');
  await wait(60); // let the panels paint before the route search holds the page

  // The routes are planned ahead by tools/plan_routes.mjs so the page opens
  // at once. Without that file the page plans them here, which takes a few
  // seconds on a slow machine.
  const planned = await fetch('data/routes.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  for (const loadKg of planned?.loadsKg ?? [0]) {
    const back = planned ? null : returnCost(terrain, walk.habitat, loadKg);
    state.plans[loadKg] = {};
    for (const def of ROUTES) {
      const route = planned?.loads[loadKg][def.pricing] ?? planWalk(terrain, walk, def.pricing, back, sky, { loadKg });
      // The tightest moment for getting home: least energy left after the way back.
      route.totals.lowestLeft = Math.min(...route.points.map((p) => ((MODEL.energyBudgetKcal - p.kcal - p.backKcal) / MODEL.energyBudgetKcal) * 100));
      state.plans[loadKg][def.id] = route;
    }
  }
  // The page opens on the heaviest load, the case where the choice of route
  // matters most. A link can ask for another: #load=0.
  const loads = Object.keys(state.plans).map(Number);
  const asked = Number(location.hash.match(/^#load=(\d+)$/)?.[1]);
  const firstLoad = loads.includes(asked) ? asked : Math.max(...loads);
  state.routes = state.plans[firstLoad];
  buildLoads();
  buildStartTimes();
  setLoad(firstLoad, false);
  buildWalkControls();
  buildOwnControls();
  // A browser can keep the slider's last position over a reload.
  $('cooling').value = String(MODEL.coolingW);
  $('cooling').addEventListener('input', (e) => setCooling(Number(e.target.value)));
  state.walks = await fetch('data/walks.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  buildWalkPick();

  // Fly to the walk, then let the two routes draw themselves.
  const all = L.latLngBounds(ROUTES.flatMap((def) => state.routes[def.id].points.map((p) => [p.lat, p.lon])));
  // flyTo divides by the map's size, which can be stale or zero if the page
  // opened in a hidden tab. Without this the routes would never be drawn.
  map.invalidateSize(false);
  try {
    map.flyToBounds(all, { ...boundsPadding(), duration: 1.4, animate: !calm });
  } catch {
    map.fitBounds(all, { ...boundsPadding(), animate: false });
  }
  await wait(1500);
  state.stopMarkers = [stopMarker(walk.habitat, 0), ...walk.stops.map((s, i) => stopMarker(s, i + 1))];
  // The ledger fills while the direct route draws: the first thing seen is
  // the cost adding up along the path.
  if (!calm) {
    for (const bar of BARS) shown[bar.id] = 0;
    renderLedger(900);
  }
  for (const def of ROUTES) await drawIn(def, 900);
  walker.addTo(map);
  selectRoute('direct');
  // Another walk can be chosen only now, with the first one's stops and
  // routes on the map to be put away.
  state.ready = true;
  $('own').disabled = false;
  $('walk-pick').disabled = false;

  // classic.html?rec opens with a clean screen for filming; ?rec=auto also
  // plays the sequence once the page has settled.
  const rec = new URLSearchParams(location.search).get('rec');
  if (rec !== null) document.body.classList.add('rec');
  if (rec === 'auto') { await wait(1200); runSequence(); }

  // A link can open a part of the page directly: #proof for the tests,
  // #brief for the walk brief, #own to place a walk of your own,
  // #walk=<id> for a ready-made walk, #reach for the reach layer, #free to
  // steer the walker yourself.
  if (location.hash === '#proof') $('proof').showModal();
  if (location.hash === '#brief') openBrief();
  if (location.hash === '#own') startOwn();
  if (location.hash.startsWith('#walk=')) pickWalk(location.hash.slice(6));
  if (location.hash === '#reach') setOverlay('reach');
  if (location.hash === '#free') startFree();
}

start();
