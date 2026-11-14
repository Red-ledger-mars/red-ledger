import { SITE, LAYERS } from './layers.js';
import { loadTerrain, slopeImage, SLOPE_RAMP } from './terrain.js';
import { loadSky, skyImage, SKY_RAMP } from './sky.js';
import { planWalk, pointAt, returnCost } from './route.js';
import { SOURCES, MODEL, MAX_MEASURED_GRADIENT, tempRiseC } from './body.js';

const L = window.L;
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const fmt = (value, digits = 0) => value.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits });
// Differences are written with a real minus sign and always show their sign.
const signed = (value, digits = 0) => `${value < 0 ? '−' : '+'}${fmt(Math.abs(value), digits)}`;

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
  { id: 'body', pricing: 'body', name: 'Body-cost route', hint: 'least walking energy', color: '#63d6c1' },
];

const state = {
  terrain: null,
  sky: null,
  walk: null,
  photos: [],
  routes: {},       // id -> described route from planWalk
  lines: {},        // id -> { line, casing } on the map
  stopMarkers: [],  // one per place on the walk, habitat first
  overlays: [],     // { id, label, leaf, ramp, credit }
  active: 'direct',
  dist: 0,          // metres walked along the active route
  playing: false,
  nextStop: 1,      // index of the next stop the walker will reach
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

map.on('mousemove', (e) => {
  const { lat, lng } = e.latlng;
  let text = `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}  ${lng.toFixed(4)}°E`;
  const elev = state.terrain?.elevAt(lat, lng);
  if (elev != null && !Number.isNaN(elev)) {
    text += `  ·  ${elev.toFixed(0)} m  ·  slope ${state.terrain.slopeAt(lat, lng).toFixed(0)}°`;
  }
  const sky = state.sky?.at(lat, lng);
  if (sky != null) text += `  ·  sky blocked ${sky.toFixed(0)}%`;
  $('cursor-coord').textContent = text;
});
map.on('mouseout', () => { $('cursor-coord').textContent = ''; });

// The part of the window not covered by panels, in screen pixels. The
// camera keeps the walk inside it.
function clearArea() {
  const ledger = document.querySelector('.ledger').getBoundingClientRect();
  const walk = document.querySelector('.walk').getBoundingClientRect();
  const top = document.querySelector('.top').getBoundingClientRect();
  return { left: ledger.right + 28, top: top.bottom + 12, right: window.innerWidth - 36, bottom: walk.top - 28 };
}

function boundsPadding() {
  const area = clearArea();
  return {
    paddingTopLeft: [area.left, area.top],
    paddingBottomRight: [window.innerWidth - area.right, window.innerHeight - area.bottom],
  };
}

/* Imagery and overlays */

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

function buildOverlays(terrain, sky) {
  const thermal = Object.fromEntries(LAYERS.filter((l) => l.kind === 'image').map((l) => [l.id, l]));
  state.overlays = [
    { id: 'none', label: 'Imagery' },
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
}

function setOverlay(id) {
  for (const overlay of state.overlays) {
    const on = overlay.id === id;
    $(`overlay-${overlay.id}`).setAttribute('aria-pressed', String(on));
    if (!overlay.leaf) continue;
    if (on) overlay.leaf.addTo(map); else overlay.leaf.remove();
    if (on) showLegend(overlay.ramp);
  }
  if (!state.overlays.find((o) => o.id === id)?.ramp) $('legend').hidden = true;
}

// A strip that shows what the overlay's colours mean.
function showLegend(ramp) {
  if (!ramp) return;
  const strip = $('legend-strip');
  const ctx = strip.getContext('2d');
  ctx.clearRect(0, 0, strip.width, strip.height);
  for (let x = 0; x < strip.width; x++) {
    const [r, g, b, a] = ramp.color(ramp.min + ((ramp.max - ramp.min) * x) / (strip.width - 1));
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    ctx.fillRect(x, 0, 1, strip.height);
  }
  const mid = (ramp.min + ramp.max) / 2;
  $('legend-title').textContent = ramp.title;
  $('legend-ticks').innerHTML = `<span>under ${ramp.min}${ramp.unit}</span><span>${mid}${ramp.unit}</span><span>${ramp.max}${ramp.unit} and over</span>`;
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
  el.querySelector('.bar-fill').style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
  if (limit !== null) el.dataset.state = value > limit ? 'over' : value > 0.75 * limit ? 'warn' : 'ok';
}

// Sets one ledger line. With `ease`, the number glides from what is shown
// to the new value, so a change of route can be followed by eye.
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
    const t = Math.min(1, (now - start) / 500);
    paintBar(bar, from + (value - from) * (1 - (1 - t) ** 3), max, limit);
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
  const heat = live ? p.heat : t.peakHeat;
  setBar('heat', {
    value: heat,
    max: MODEL.heatContingencyKJkg,
    limit: MODEL.heatLimitKJkg,
    note: `${ASSUMED}${live ? 'stored now' : 'peak on this route'} · body about +${tempRiseC(heat).toFixed(1)} °C · mark: NASA limit ${MODEL.heatLimitKJkg.toFixed(1)}`,
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
  const check = await (await fetch('data/shielding/validation.json')).json();
  const within = check.rows.filter((row) => Math.abs(row.difference_pct_points) <= 1).length;
  $('proof-body').innerHTML = `
    <p>At eight places the Curiosity rover measured less radiation where terrain blocked part of the sky. We computed the share of sky blocked at the same places from NASA's elevation model and compared it with the published values.</p>
    <table>
      <thead><tr><th>Place</th><th>Sky blocked, published</th><th>Sky blocked, ours</th><th>Dose drop measured</th></tr></thead>
      <tbody>${check.rows.map((row) => `<tr${Math.abs(row.difference_pct_points) > 1 ? ' class="off"' : ''}>
        <td>${row.period} ${row.place}</td><td>${row.paper_sky_blocked_pct.toFixed(1)}%</td><td>${row.our_sky_blocked_pct.toFixed(1)}%</td><td>${row.measured_dose_decrease_pct.toFixed(1)}%</td></tr>`).join('')}</tbody>
    </table>
    <p><b>${within} of ${check.rows.length} agree within 1 percentage point.</b> Mean difference ${check.summary.mean_absolute_difference_pct_points.toFixed(1)} points.</p>
    <p>Maria Gordon Notch is a narrow valley and reads 9 points low: our elevation grid is 4 m and the paper used 1 m. This checks the terrain computation. It does not check the dose model.</p>
    <p>Source: <a href="https://elib.dlr.de/224554/" target="_blank" rel="noopener">Guo et al. 2026, JGR Planets 131(4), Table 1</a>. Rover positions: NASA/JPL-Caltech.</p>`;
  const dialog = $('proof');
  $('proof-open').addEventListener('click', () => dialog.showModal());
  $('proof-close').addEventListener('click', () => dialog.close());
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
    : 'Assumption, not a measured or published position';

  const photos = state.photos.filter((ph) => ph.stop === place.id);
  const photo = photos.find((ph) => ph.kind === kind) ?? photos[0];
  $('target-photo').hidden = !photo;
  if (!photo) return;
  const other = photos.find((ph) => ph !== photo);
  $('target-img').src = photo.file;
  $('target-img').alt = photo.caption;
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

function buildRouteCards() {
  const [a, b] = ROUTES.map((def) => state.routes[def.id].totals);
  const card = (def) => {
    const t = state.routes[def.id].totals;
    const steepLimit = (Math.atan(MAX_MEASURED_GRADIENT) * 180 / Math.PI).toFixed(0);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'route';
    btn.id = `route-${def.id}`;
    btn.style.setProperty('--route', def.color);
    btn.innerHTML = `
      <div class="route-name">${def.name}<small>${def.hint}</small></div>
      <div class="route-big">
        <span><b>${(t.seconds / 60).toFixed(0)} min</b>walking</span>
        <span><b>${t.kcal.toFixed(0)} kcal</b>energy</span>
        <span><b>${t.peakHeat.toFixed(1)} kJ/kg</b>peak body heat</span>
      </div>
      <div class="route-small">${(t.dist / 1000).toFixed(2)} km · ${t.climb.toFixed(0)} m climb · steepest ${t.steepestDeg.toFixed(0)}°${
  t.beyondMeasured > 0
    ? `<span class="route-flag" title="${t.beyondMeasured.toFixed(0)} m of this route is steeper than any walking study has measured (over ${steepLimit}°). The energy there is an extrapolation.">${t.beyondMeasured.toFixed(0)} m beyond tested slope</span>`
    : ''}</div>`;
    btn.addEventListener('click', () => selectRoute(def.id, true));
    return btn;
  };
  const delta = document.createElement('div');
  delta.className = 'delta';
  delta.innerHTML = `
    <span>Body-cost against direct</span>
    <b>${signed(b.peakHeat - a.peakHeat, 1)} kJ/kg heat</b>
    <b>${signed(b.kcal - a.kcal)} kcal</b>
    <span>${signed((b.dist - a.dist) / 1000, 2)} km · ${signed((b.seconds - a.seconds) / 60)} min</span>`;
  $('routes').append(card(ROUTES[0]), delta, card(ROUTES[1]));
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
  drawProfile();
  renderWalk(ease);
}

// Draws a route onto the map from its start to its end.
function drawIn(def, ms) {
  const latlngs = state.routes[def.id].points.map((p) => [p.lat, p.lon]);
  const casing = L.polyline([], { color: '#0c0908', weight: 6.5, opacity: 0.65, lineJoin: 'round', interactive: false }).addTo(map);
  const line = L.polyline([], { color: def.color, weight: 3.5, opacity: 0.7, lineJoin: 'round' }).addTo(map);
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
    ? `${(p.seconds / 60).toFixed(0)} min · ${Math.abs(Math.atan(p.gradient) * 180 / Math.PI).toFixed(0)}° ${p.gradient >= 0 ? 'up' : 'down'} · ${p.speed.toFixed(1)} m/s · ${Math.round(p.metabolicW)} W`
    : 'Press Walk, or drag the slider';
  renderLedger(ease);
  drawProfileCursor();
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
  ctx.fillStyle = '#c4b5a5';
  ctx.font = `${12 * devicePixelRatio}px ui-monospace, monospace`;
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

/* Walk control */

// A full walk plays in about 40 seconds whatever its length. The recorded
// sequence shortens this.
let playSeconds = 40;

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
  map.panBy([at.x - (area.left + area.right) / 2, at.y - (area.top + area.bottom) / 2], { animate: true, duration: 0.9 });
}

function tick(last, id) {
  if (!state.playing || id !== loopId) return;
  const now = performance.now();
  const route = state.routes[state.active];
  const total = route.totals.dist;
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
  $('play').addEventListener('click', () => setPlaying(!state.playing));
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

  // Keys, so a walk-through can be run without the mouse: Space plays or
  // pauses, D and B choose the route, 1 to 5 choose the overlay.
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, button, summary, dialog') && e.key !== ' ') return;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); }
    if (e.key === 'r' || e.key === 'R') document.body.classList.toggle('rec');
    if (e.key === 'p' || e.key === 'P') runSequence();
    if (e.key === 'Escape') stopSequence();
    if (e.key === 'd' || e.key === 'D') selectRoute('direct', true);
    if (e.key === 'b' || e.key === 'B') selectRoute('body', true);
    const overlay = state.overlays[Number(e.key) - 1];
    if (overlay) setOverlay(overlay.id);
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
    setPlaying(true);
  });
}

function stopSequence() {
  if (!state.sequence) return;
  state.sequence = false;
  setPlaying(false);
  state.onWalkEnd?.();
}

// The fixed sequence for a screen recording: the direct route with the
// slope layer, then the body-cost route, then the check against Curiosity.
// It plays the same way every time. Escape stops it.
async function runSequence() {
  if (state.sequence) return;
  state.sequence = true;
  const hold = async (ms) => {
    await wait(ms);
    if (!state.sequence) throw new Error('stopped');
  };
  try {
    $('target').hidden = true;
    setOverlay('none');
    selectRoute('direct', true);
    await hold(1800);
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
  } catch {
    // stopped with Escape
  } finally {
    state.sequence = false;
    state.onWalkEnd = null;
    playSeconds = 40;
  }
}

/* Start */

async function start() {
  buildImagery();
  buildBars();
  buildSources();
  buildRoverPath();
  buildWeather();
  buildProof();

  const [terrain, sky, walk, photos] = await Promise.all([
    loadTerrain(),
    loadSky(),
    fetch('data/walk.json').then((r) => r.json()),
    fetch('data/photos.json').then((r) => r.json()),
  ]);
  Object.assign(state, { terrain, sky, walk, photos: photos.photos });
  buildOverlays(terrain, sky);
  buildMapCredits(terrain);

  document.body.classList.remove('booting');
  await wait(60); // let the panels paint before the route search holds the page

  // The routes are planned ahead by tools/plan_routes.mjs so the page opens
  // at once. Without that file the page plans them here, which takes a few
  // seconds on a slow machine.
  const planned = await fetch('data/routes.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const back = planned ? null : returnCost(terrain, walk.habitat);
  for (const def of ROUTES) {
    const route = planned?.routes[def.pricing] ?? planWalk(terrain, walk, def.pricing, back, sky);
    // The tightest moment for getting home: least energy left after the way back.
    route.totals.lowestLeft = Math.min(...route.points.map((p) => ((MODEL.energyBudgetKcal - p.kcal - p.backKcal) / MODEL.energyBudgetKcal) * 100));
    state.routes[def.id] = route;
  }
  buildRouteCards();
  buildWalkControls();
  $('ledger-note').innerHTML = `An ${MODEL.bodyMassKg} kg walker in a ${MODEL.suitMassKg} kg suit. Pace ${MODEL.paceMs.toFixed(1)} m/s, slower on climbs to stay under ${MODEL.workLimitW} W. The suit removes ${MODEL.coolingW} W of heat.`;

  // Fly to the walk, then let the two routes draw themselves.
  const all = L.latLngBounds(ROUTES.flatMap((def) => state.routes[def.id].points.map((p) => [p.lat, p.lon])));
  map.flyToBounds(all, { ...boundsPadding(), duration: 1.4 });
  await wait(1500);
  state.stopMarkers = [stopMarker(walk.habitat, 0), ...walk.stops.map((s, i) => stopMarker(s, i + 1))];
  for (const def of ROUTES) await drawIn(def, 900);
  walker.addTo(map);
  selectRoute('direct');

  // index.html?rec opens with a clean screen for filming; ?rec=auto also
  // plays the sequence once the page has settled.
  const rec = new URLSearchParams(location.search).get('rec');
  if (rec !== null) document.body.classList.add('rec');
  if (rec === 'auto') { await wait(1200); runSequence(); }
}

start();
