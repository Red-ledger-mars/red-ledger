import { SITE, LAYERS } from './layers.js';
import { loadTerrain, slopeImage, SLOPE_STEPS } from './terrain.js';

const L = window.L;

// The four lines of the body ledger. `value` and `limit` stay null until the
// route model has run; a null value is drawn as a dash, never as a zero.
const BARS = [
  { id: 'energy', name: 'Energy burned', unit: 'kcal' },
  { id: 'heat', name: 'Heat load', unit: 'W' },
  { id: 'dose', name: 'Radiation dose', unit: 'µSv' },
  { id: 'return', name: 'Way back', unit: '% left' },
];

const state = {
  bars: Object.fromEntries(BARS.map((b) => [b.id, { value: null, limit: null, max: null, source: null }])),
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

const coordEl = document.getElementById('cursor-coord');
let terrain = null;
map.on('mousemove', (e) => {
  const { lat, lng } = e.latlng;
  let text = `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}  ${lng.toFixed(4)}°E`;
  const elev = terrain?.elevAt(lat, lng);
  if (elev != null && !Number.isNaN(elev)) {
    text += `  ·  ${elev.toFixed(0)} m  ·  slope ${terrain.slopeAt(lat, lng).toFixed(0)}°`;
  }
  coordEl.textContent = text;
});

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
  document.getElementById('layers').append(btn);
  return btn;
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
  const leaf = L.imageOverlay(slopeImage(terrain), terrain.bounds, { opacity: 0.75, attribution: credit });
  const legend = document.getElementById('legend');
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
  const res = await fetch('data/msl_waypoints.json');
  const { waypoints, credit } = await res.json();
  const line = waypoints.map((w) => [w.lat, w.lon]);
  L.polyline(line, { color: '#efe6da', weight: 1.5, opacity: 0.75, dashArray: '2 5', attribution: `Rover path: ${credit}` }).addTo(map);
  for (const w of waypoints) {
    L.circleMarker([w.lat, w.lon], { radius: 2.5, color: '#efe6da', weight: 1, fillOpacity: 0.9 })
      .bindTooltip(`Curiosity, sol ${w.sol} · ${w.elev.toFixed(0)} m`)
      .addTo(map);
  }
}

function buildBars() {
  const root = document.getElementById('bars');
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
    root.append(el);
  }
}

function renderBars() {
  for (const bar of BARS) {
    const s = state.bars[bar.id];
    const el = document.getElementById(`bar-${bar.id}`);
    const fill = el.querySelector('.bar-fill');
    const limit = el.querySelector('.bar-limit');
    if (s.value === null) {
      el.querySelector('[data-value]').textContent = '–';
      fill.style.width = '0';
      limit.hidden = true;
      continue;
    }
    el.querySelector('[data-value]').textContent = Math.round(s.value).toLocaleString('en');
    fill.style.width = `${Math.min(100, (s.value / s.max) * 100)}%`;
    limit.hidden = s.limit === null;
    if (s.limit !== null) {
      limit.style.left = `${Math.min(100, (s.limit / s.max) * 100)}%`;
      el.dataset.state = s.value > s.limit ? 'over' : s.value > 0.8 * s.limit ? 'warn' : 'ok';
    }
    el.querySelector('[data-src]').textContent = s.source ?? '';
  }
}

buildLayers();
buildBars();
renderBars();
buildRoverPath();
loadTerrain().then((t) => {
  terrain = t;
  buildSlopeLayer(t);
});
