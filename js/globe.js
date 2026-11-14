import * as THREE from '../vendor/three/three.module.min.js';
import { dirFromLatLon, latLonFromDir, facing, molaAt, parseMola } from './globe-math.js';

const $ = (id) => document.getElementById(id);

// Each layer names its instrument and mission because that text is shown on
// screen and copied into CREDITS.md. Tiles are NASA Mars Trek, saved under
// tiles/global by tools/fetch_global.py.
const ZOOM = 2; // 8 x 4 tiles of 256 px = 2048 x 1024 px
const LAYERS = [
  { id: 'viking', label: 'Viking colour', ext: 'jpg', credit: 'Viking Orbiter mosaic, NASA/JPL-Caltech/USGS' },
  { id: 'mola', label: 'Elevation (MOLA)', ext: 'jpg', credit: 'MOLA, Mars Global Surveyor, NASA/GSFC' },
  { id: 'themis', label: 'Day heat (THEMIS)', ext: 'png', note: 'covers 65 S to 65 N only',
    credit: 'THEMIS, Mars Odyssey, NASA/JPL-Caltech/Arizona State University' },
];
const ELEV_SOURCE = 'MOLA 4 px/degree grid, NASA PDS';

const state = {
  layer: LAYERS[0],
  textures: {},   // layer id -> THREE.CanvasTexture, kept once loaded
  grid: null,     // MOLA int16 grid
  patches: [],
  yaw: 0, pitch: 0,
  dist: 3.2,
  idle: !matchMedia('(prefers-reduced-motion: reduce)').matches,
  pending: false,
};
const DIST_MIN = 1.5, DIST_MAX = 5;

/* Renderer */

const host = $('globe');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
} catch (err) {
  renderer = null;
}
if (!renderer) {
  $('nogl').hidden = false;
  throw new Error('WebGL is not available');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setClearColor(0x0c0908);
host.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
const globe = new THREE.Mesh(
  new THREE.SphereGeometry(1, 64, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
);
scene.add(globe);
{
  const f = facing(-4.6, 137.4); // start with Gale crater facing the viewer
  state.yaw = f.yaw;
  state.pitch = f.pitch;
}

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep the whole globe in view on a narrow screen.
  camera.fov = w / h < 1 ? 35 / Math.max(w / h, 0.5) : 35;
  camera.updateProjectionMatrix();
  requestRender();
}

/* Render on demand */

function requestRender() {
  if (state.pending) return;
  state.pending = true;
  requestAnimationFrame(draw);
}

function draw() {
  state.pending = false;
  globe.rotation.set(state.pitch, state.yaw, 0, 'XYZ');
  camera.position.set(0, 0, state.dist);
  globe.updateMatrixWorld(true);
  renderer.render(scene, camera);
  placeMarkers();
}

/* Textures: the tiles are stitched on one canvas. Its left edge is lon -180. */

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a missing tile leaves a dark gap
    img.src = src;
  });
}

async function textureFor(layer) {
  if (state.textures[layer.id]) return state.textures[layer.id];
  const cols = 2 << ZOOM, rows = 1 << ZOOM;
  const canvas = document.createElement('canvas');
  canvas.width = cols * 256;
  canvas.height = rows * 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#17100d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const jobs = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      jobs.push(loadImage(`tiles/global/${layer.id}/${ZOOM}/${row}/${col}.${layer.ext}`)
        .then((img) => { if (img) ctx.drawImage(img, col * 256, row * 256); }));
    }
  }
  await Promise.all(jobs);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  state.textures[layer.id] = tex;
  return tex;
}

async function showLayer(layer) {
  state.layer = layer;
  for (const b of $('layers').children) b.setAttribute('aria-pressed', String(b.dataset.id === layer.id));
  $('globe-credit').textContent = `${layer.label}: ${layer.credit}${layer.note ? '. Data ' + layer.note : ''}`;
  const tex = await textureFor(layer);
  if (state.layer !== layer) return; // the user already switched again
  globe.material.map = tex;
  globe.material.needsUpdate = true;
  requestRender();
}

function buildLayerButtons() {
  for (const layer of LAYERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = layer.label;
    btn.title = layer.credit;
    btn.dataset.id = layer.id;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => showLayer(layer));
    $('layers').append(btn);
  }
}

/* Surveyed patches: a ring and a label drawn over the globe, because the
   patch is about 2 km wide and would be invisible at globe scale. */

const tmp = new THREE.Vector3();

function placeMarkers() {
  const w = host.clientWidth, h = host.clientHeight;
  const patch = state.patches[0]; // one ring element for now; more patches need one each
  if (!patch) return;
  tmp.fromArray(dirFromLatLon(patch.centre.lat, patch.centre.lon));
  globe.localToWorld(tmp);
  // On a unit sphere a point faces the camera when dot(p, camera) > 1.
  const visible = tmp.dot(camera.position) > 1.02;
  const ring = $('patch-ring'), label = $('patch-label');
  ring.hidden = label.hidden = !visible;
  if (!visible) return;
  tmp.project(camera);
  const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h;
  ring.style.left = label.style.left = `${x}px`;
  ring.style.top = label.style.top = `${y}px`;
}

async function loadPatches() {
  const { patches } = await (await fetch('data/global/patches.json')).json();
  state.patches = patches;
  const n = patches.length;
  $('intro-title').textContent = `Mars at walk scale: ${n} patch${n === 1 ? '' : 'es'} surveyed`;
  for (const id of ['patch-ring', 'patch-label']) {
    $(id).href = patches[0].href;
    $(id).title = `${patches[0].name}. ${patches[0].summary}`;
  }
  requestRender();
}

/* Pointer: drag to turn, wheel or pinch to zoom, hover to read, click for a card */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pick(clientX, clientY) {
  const r = host.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(globe)[0];
  if (!hit) return null;
  const local = globe.worldToLocal(hit.point.clone());
  return latLonFromDir(local.toArray());
}

const fmtLat = (lat) => `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}`;
const fmtElev = (m) => (m == null ? 'not loaded' : `${m.toLocaleString('en-US')} m`);

const pointers = new Map();
let down = null, pinch = 0;

function stopIdle() { state.idle = false; }

function zoomBy(factor) {
  state.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, state.dist * factor));
  requestRender();
}

host.addEventListener('pointerdown', (e) => {
  host.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  down = { x: e.clientX, y: e.clientY, moved: 0 };
  if (pointers.size === 2) pinch = pinchSpan();
  stopIdle();
});

function pinchSpan() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

host.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) { readout(e); return; }
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const span = pinchSpan();
    if (pinch) zoomBy(pinch / span);
    pinch = span;
    if (down) down.moved = 99;
    return;
  }
  if (down) down.moved += Math.abs(dx) + Math.abs(dy);
  if (down && down.moved > 4) {
    host.classList.add('dragging');
    // Slower turning when zoomed in, so the surface follows the pointer.
    const k = 0.005 * (state.dist - 1) / 2.2;
    state.yaw += dx * k;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch + dy * k));
    requestRender();
  }
  readout(e);
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  host.classList.remove('dragging');
  pinch = 0;
  if (e.type === 'pointerup' && down && down.moved <= 4 && pointers.size === 0) openCard(e);
  if (pointers.size === 0) down = null;
}
host.addEventListener('pointerup', endPointer);
host.addEventListener('pointercancel', endPointer);

host.addEventListener('wheel', (e) => {
  e.preventDefault();
  stopIdle();
  zoomBy(Math.exp(e.deltaY * 0.0012));
}, { passive: false });

function readout(e) {
  if (e.pointerType === 'touch') return;
  const p = pick(e.clientX, e.clientY);
  $('cursor-coord').textContent = p
    ? `${fmtLat(p.lat)}  ${p.lon.toFixed(2)}°E  ·  ${fmtElev(molaAt(state.grid, p.lat, p.lon))} (MOLA)`
    : 'move over the globe';
}

function openCard(e) {
  const p = pick(e.clientX, e.clientY);
  if (!p) { $('card').hidden = true; return; }
  $('card-coord').textContent = `${fmtLat(p.lat)}  ${p.lon.toFixed(2)}°E`;
  $('card-elev').textContent = `Elevation ${fmtElev(molaAt(state.grid, p.lat, p.lon))}. Source: ${ELEV_SOURCE}.`;
  const card = $('card');
  card.hidden = false;
  card.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 270)}px`;
  card.style.top = `${Math.min(e.clientY + 14, window.innerHeight - 150)}px`;
}
$('card-close').addEventListener('click', () => { $('card').hidden = true; });
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('card').hidden = true; });

/* Idle rotation: about 12 frames a second, stopped by the first touch or wheel turn */

setInterval(() => {
  if (!state.idle || document.hidden) return;
  state.yaw += 0.0045;
  requestRender();
}, 80);

addEventListener('resize', resize);

/* Start */

buildLayerButtons();
resize();
showLayer(state.layer);
loadPatches().catch(() => { $('intro-title').textContent = 'Mars at walk scale'; });
fetch('data/global/mola_4ppd.bin')
  .then((r) => r.arrayBuffer())
  .then((buf) => { state.grid = parseMola(buf); })
  .catch(() => { /* readout then says "not loaded" */ });

// For checks in the browser console only.
window.__globe = { state, pick, camera, globe, draw };
