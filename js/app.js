import { SITE, LAYERS } from './layers.js';

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

// Mars Trek serves tiles on a plain latitude/longitude grid, so the map uses
// the same grid instead of the web default made for Earth.
const map = L.map('map', {
  crs: L.CRS.EPSG4326,
  center: SITE.center,
  zoom: SITE.zoom,
  zoomControl: false,
  attributionControl: true,
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
map.attributionControl.setPrefix(false);

const coordEl = document.getElementById('cursor-coord');
map.on('mousemove', (e) => {
  const { lat, lng } = e.latlng;
  coordEl.textContent = `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}  ${lng.toFixed(4)}°E`;
});

function buildLayers() {
  const nav = document.getElementById('layers');
  for (const layer of LAYERS) {
    const tile = L.tileLayer(layer.url, layer.options);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = layer.label;
    btn.title = layer.credit;
    btn.setAttribute('aria-pressed', String(Boolean(layer.on)));
    if (layer.on) tile.addTo(map);
    btn.addEventListener('click', () => {
      const on = !map.hasLayer(tile);
      if (on) tile.addTo(map); else tile.remove();
      btn.setAttribute('aria-pressed', String(on));
    });
    nav.append(btn);
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
