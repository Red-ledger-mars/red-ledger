import { SITE, LAYERS } from './layers.js';
import { loadTerrain, slopeImage, SLOPE_STEPS } from './terrain.js';
import { planWalk, pointAt } from './route.js';
import { SOURCES, MAX_MEASURED_GRADIENT } from './body.js';

const L = window.L;
const $ = (id) => document.getElementById(id);

// The four lines of the body ledger. A line stays a dash until the model
// behind it exists; a missing value is never drawn as a zero.
const BARS = [
  { id: 'energy', name: 'Energy burned', unit: 'kcal' },
  { id: 'heat', name: 'Heat load', unit: 'W' },
  { id: 'dose', name: 'Radiation dose', unit: 'µSv' },
  { id: 'return', name: 'Way back', unit: '% left' },
];

// The two routes for the same walk. `pricing` names a rule in route.js.
const ROUTES = [
  { id: 'direct', pricing: 'direct', name: 'Direct route', hint: 'shortest over the ground', color: '#ffb547' },
  { id: 'body', pricing: 'body', name: 'Body-cost route', hint: 'least walking energy', color: '#63d6c1' },
];

const state = {
  terrain: null,
  walk: null,
  photos: [],      // Curiosity photos for the stops
  routes: {},      // id -> described route from planWalk
  lines: {},       // id -> map polyline
  active: 'direct',
  dist: 0,         // metres walked along the active route
  playing: false,
};

// The map uses the web's standard grid because NASA's rover map tiles for
// Gale are cut on it. Leaflet assumes Earth's size for distances, so every
// distance shown on the page is computed separately with the Mars radius.
const map = L.map('map', {
  center: SITE.center,
  zoom: SITE.zoom,
  minZoom: SITE.minZoom,
  maxZoom: SITE.maxZoom,
  maxBounds: SITE.bounds,
  zoomControl: false,
  attributionControl: true,
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
map.attributionControl.setPrefix(false);

map.on('mousemove', (e) => {
  const { lat, lng } = e.latlng;
  let text = `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}  ${lng.toFixed(4)}°E`;
  const elev = state.terrain?.elevAt(lat, lng);
  if (elev != null && !Number.isNaN(elev)) {
    text += `  ·  ${elev.toFixed(0)} m  ·  slope ${state.terrain.slopeAt(lat, lng).toFixed(0)}°`;
  }
  $('cursor-coord').textContent = text;
});

/* Layers */

function addLayerButton({ label, credit, on }, leaf) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.title = credit;
  btn.setAttribute('aria-pressed', String(Boolean(on)));
  if (on) leaf.addTo(map);
  btn.addEventListener('click', () => {
    const show = !map.hasLayer(leaf);
    if (show) leaf.addTo(map); else leaf.remove();
    btn.setAttribute('aria-pressed', String(show));
  });
  $('layers').append(btn);
}

function buildLayers() {
  for (const layer of LAYERS) {
    const options = { ...layer.options, attribution: layer.credit };
    const leaf = layer.kind === 'image'
      ? L.imageOverlay(layer.url, layer.bounds, options)
      : L.tileLayer(layer.url, options);
    addLayerButton(layer, leaf);
  }
}

// Slope is computed in the page from the stored elevation crop, then laid
// over the imagery. The legend is shown only while the layer is on.
function buildSlopeLayer(terrain) {
  const credit = `Slope from ${terrain.meta.source}. ${terrain.meta.credit}`;
  const leaf = L.imageOverlay(slopeImage(terrain), terrain.bounds, { opacity: 0.7, attribution: credit });
  const legend = $('legend');
  let from = 0;
  for (const step of SLOPE_STEPS) {
    const [r, g, b, a] = step.color;
    const item = document.createElement('span');
    item.innerHTML = `<i style="background: rgba(${r}, ${g}, ${b}, ${Math.max(a / 255, 0.12)})"></i>${
      step.upTo === Infinity ? `over ${from}°` : `${from}–${step.upTo}°`}`;
    legend.append(item);
    from = step.upTo;
  }
  leaf.on('add', () => { legend.hidden = false; });
  leaf.on('remove', () => { legend.hidden = true; });
  addLayerButton({ label: 'Slope 4 m', credit, on: true }, leaf);
  L.rectangle(terrain.bounds, { color: '#efe6da', weight: 1, opacity: 0.5, fill: false, dashArray: '6 6', interactive: false }).addTo(map);
}

// Curiosity's own path: where a wheeled rover has already crossed this ground.
async function buildRoverPath() {
  const { waypoints, credit } = await (await fetch('data/msl_waypoints.json')).json();
  const line = waypoints.map((w) => [w.lat, w.lon]);
  L.polyline(line, { color: '#efe6da', weight: 1.5, opacity: 0.75, dashArray: '2 5', attribution: `Rover path: ${credit}` }).addTo(map);
  for (const w of waypoints) {
    L.circleMarker([w.lat, w.lon], { radius: 2, color: '#efe6da', weight: 1, fillOpacity: 0.9 })
      .bindTooltip(`Curiosity, sol ${w.sol} · ${w.elev.toFixed(0)} m`)
      .addTo(map);
  }
}

/* Body ledger */

function buildBars() {
  for (const bar of BARS) {
    const el = document.createElement('div');
    el.className = 'bar';
    el.id = `bar-${bar.id}`;
    el.innerHTML = `
      <div class="bar-head">
        <span class="bar-name">${bar.name}</span>
        <span class="bar-value"><span data-value>–</span><small>${bar.unit}</small></span>
      </div>
      <div class="bar-track"><div class="bar-fill"></div><div class="bar-limit" hidden></div></div>
      <div class="bar-src" data-src></div>`;
    $('bars').append(el);
  }
}

// Draws one ledger line. `source` is an entry from SOURCES in body.js;
// until its `checked` flag is set the line carries the assumption mark.
function setBar(id, { value, max, limit = null, source = null }) {
  const el = $(`bar-${id}`);
  el.querySelector('[data-value]').textContent = Math.round(value).toLocaleString('en');
  el.querySelector('.bar-fill').style.width = `${Math.min(100, (value / max) * 100)}%`;
  const tick = el.querySelector('.bar-limit');
  tick.hidden = limit === null;
  if (limit !== null) {
    tick.style.left = `${Math.min(100, (limit / max) * 100)}%`;
    el.dataset.state = value > limit ? 'over' : value > 0.8 * limit ? 'warn' : 'ok';
  }
  if (source) {
    el.querySelector('[data-src]').innerHTML = `${source.checked ? '' : '<i class="assume"></i>'}<a href="${source.url}" target="_blank" rel="noopener">${source.label}</a>`;
  }
}

/* The walk */

function stopMarker(place, number) {
  const icon = L.divIcon({
    className: `stop${place.assumption ? ' stop-assumed' : ''}`,
    html: number === 0 ? 'H' : String(number),
    iconSize: [22, 22],
  });
  return L.marker([place.lat, place.lon], { icon, title: place.name })
    .on('click', () => showPlace(place))
    .addTo(map);
}

// Shows a place in the side card. Stops Curiosity visited carry its own
// photos: a wide view of the ground ahead and a close view of the rock.
// Clicking the photo switches between the two.
function showPlace(place, kind = 'wide') {
  $('target').hidden = false;
  $('target-name').innerHTML = `${place.assumption ? '<i class="assume"></i>' : ''}${place.name}`;
  $('target-text').textContent = place.text;
  $('target-credit').innerHTML = place.source
    ? `<a href="${place.source}" target="_blank" rel="noopener">Source</a>${place.sol ? ` · sol ${place.sol}` : ''}`
    : 'Assumption, not a measured or published position';

  const photos = state.photos.filter((ph) => ph.stop === place.id);
  const photo = photos.find((ph) => ph.kind === kind) ?? photos[0];
  const figure = $('target-photo');
  figure.hidden = !photo;
  if (!photo) return;
  const other = photos.find((ph) => ph !== photo);
  $('target-img').src = photo.file;
  $('target-img').alt = photo.caption;
  $('target-caption').innerHTML = `${photo.caption} <a href="${photo.source_url}" target="_blank" rel="noopener">Curiosity ${photo.instrument}, sol ${photo.sol}</a>. ${photo.credit}`;
  $('target-swap').hidden = !other;
  if (other) {
    $('target-swap').textContent = other.kind === 'close' ? 'Show close view' : 'Show wide view';
    $('target-swap').onclick = () => showPlace(place, other.kind);
  }
}

function buildRouteCards() {
  for (const def of ROUTES) {
    const t = state.routes[def.id].totals;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'route';
    btn.id = `route-${def.id}`;
    btn.style.setProperty('--route', def.color);
    btn.innerHTML = `
      <div class="route-name">${def.name}<small>${def.hint}</small></div>
      <div class="route-stats">
        <span><b>${(t.dist / 1000).toFixed(2)}</b> km</span>
        <span><b>${t.climb.toFixed(0)}</b> m climb</span>
        <span><b>${t.steepestDeg.toFixed(0)}°</b> steepest</span>
        <span><b>${t.kcal.toFixed(0)}</b> kcal</span>
      </div>
      ${t.beyondMeasured > 0
    ? `<div class="route-flag">${t.beyondMeasured.toFixed(0)} m steeper than any walking measurement (over ${(Math.atan(MAX_MEASURED_GRADIENT) * 180 / Math.PI).toFixed(0)}°)</div>`
    : ''}`;
    btn.addEventListener('click', () => selectRoute(def.id));
    $('routes').append(btn);
  }
}

function selectRoute(id) {
  state.active = id;
  state.dist = 0;
  for (const def of ROUTES) {
    const on = def.id === id;
    $(`route-${def.id}`).setAttribute('aria-pressed', String(on));
    state.lines[def.id].setStyle({ opacity: on ? 1 : 0.85, weight: on ? 5 : 2.5, dashArray: on ? null : '6 6' });
    if (on) state.lines[def.id].bringToFront();
  }
  drawProfile();
  renderWalk();
}

const walker = L.circleMarker([0, 0], { radius: 7, color: '#0c0908', weight: 2, fillColor: '#efe6da', fillOpacity: 1, interactive: false });

// Updates everything that depends on how far the walker has gone.
function renderWalk() {
  const route = state.routes[state.active];
  const p = pointAt(route, state.dist);
  walker.setLatLng([p.lat, p.lon]);
  $('progress').value = String(Math.round((state.dist / route.totals.dist) * 1000));
  $('progress-text').textContent = `${Math.round(state.dist).toLocaleString('en')} m · ${Math.abs(Math.atan(p.gradient) * 180 / Math.PI).toFixed(0)}° ${p.gradient >= 0 ? 'up' : 'down'}`;
  const max = Math.max(...ROUTES.map((d) => state.routes[d.id].totals.kcal));
  setBar('energy', { value: p.kcal, max, source: SOURCES.walkCost });
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
  const pad = 6 * devicePixelRatio;
  return {
    x: (d) => (d / route.totals.dist) * canvas.width,
    y: (e) => canvas.height - pad - ((e - lo) / (hi - lo)) * (canvas.height - 2 * pad),
  };
}

function drawProfile() {
  const { canvas } = profile;
  const route = state.routes[state.active];
  const def = ROUTES.find((d) => d.id === state.active);
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  const { x, y } = profileScale();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Ground line, drawn red where the step is steeper than the measurements cover.
  ctx.lineWidth = 2 * devicePixelRatio;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1];
    const b = route.points[i];
    ctx.strokeStyle = Math.abs(b.gradient) > MAX_MEASURED_GRADIENT ? '#ff5533' : def.color;
    ctx.beginPath();
    ctx.moveTo(x(a.dist), y(a.elev));
    ctx.lineTo(x(b.dist), y(b.elev));
    ctx.stroke();
  }
  ctx.fillStyle = '#a8998a';
  ctx.font = `${10 * devicePixelRatio}px ui-monospace, monospace`;
  route.stops.forEach((s, i) => {
    const label = i === 0 || i === route.stops.length - 1 ? 'H' : String(i);
    ctx.fillRect(x(s.dist) - 0.5, 0, 1, canvas.height);
    ctx.fillText(label, Math.min(x(s.dist) + 4, canvas.width - 12 * devicePixelRatio), 11 * devicePixelRatio);
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
  ctx.fillStyle = '#efe6da';
  ctx.beginPath();
  ctx.arc(x(p.dist), y(p.elev), 4 * devicePixelRatio, 0, 2 * Math.PI);
  ctx.fill();
}

/* Walk control */

// A full walk plays in about 40 seconds whatever its length.
const PLAY_SECONDS = 40;

function tick(last) {
  if (!state.playing) return;
  const now = performance.now();
  const total = state.routes[state.active].totals.dist;
  state.dist = Math.min(total, state.dist + ((now - last) / 1000) * (total / PLAY_SECONDS));
  renderWalk();
  if (state.dist >= total) { setPlaying(false); return; }
  requestAnimationFrame(() => tick(now));
}

function setPlaying(on) {
  state.playing = on;
  $('play').textContent = on ? 'Pause' : 'Walk';
  if (on) {
    if (state.dist >= state.routes[state.active].totals.dist) state.dist = 0;
    requestAnimationFrame(() => tick(performance.now()));
  }
}

function buildWalkControls() {
  $('play').disabled = false;
  $('progress').disabled = false;
  $('play').addEventListener('click', () => setPlaying(!state.playing));
  $('progress').addEventListener('input', (e) => {
    setPlaying(false);
    state.dist = (Number(e.target.value) / 1000) * state.routes[state.active].totals.dist;
    renderWalk();
  });
  window.addEventListener('resize', drawProfile);
}

async function buildWalk(terrain) {
  state.walk = await (await fetch('data/walk.json')).json();
  state.photos = (await (await fetch('data/photos.json')).json()).photos;
  $('ledger-note').textContent = 'Finding routes…';
  await new Promise((done) => setTimeout(done, 30)); // let the map paint first

  for (const def of ROUTES) {
    const route = planWalk(terrain, state.walk, def.pricing);
    state.routes[def.id] = route;
    state.lines[def.id] = L.polyline(route.points.map((p) => [p.lat, p.lon]), { color: def.color, lineJoin: 'round' }).addTo(map);
  }
  stopMarker(state.walk.habitat, 0);
  state.walk.stops.forEach((s, i) => stopMarker(s, i + 1));
  walker.addTo(map);

  buildRouteCards();
  buildWalkControls();
  selectRoute('direct');
  map.fitBounds(L.latLngBounds(state.routes.body.points.map((p) => [p.lat, p.lon])), { paddingTopLeft: [290, 90], paddingBottomRight: [40, 200] });
  $('ledger-note').innerHTML = `Energy uses ${SOURCES.walkCost.label} scaled to Mars gravity. <i class="assume"></i>marks numbers not yet checked against the source.`;
}

buildLayers();
buildBars();
buildRoverPath();
loadTerrain().then((terrain) => {
  state.terrain = terrain;
  buildSlopeLayer(terrain);
  return buildWalk(terrain);
});
