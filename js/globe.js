import * as THREE from '../vendor/three/three.module.min.js';
import { dirFromLatLon, latLonFromDir, facing, molaAt, parseMola } from './globe-math.js';

const $ = (id) => document.getElementById(id);

// Each layer names its instrument and mission because that text is shown on
// screen and copied into CREDITS.md. Tiles are NASA Mars Trek, saved under
// tiles/global by tools/fetch_global.py.
const ZOOM = 2; // 8 x 4 tiles of 256 px = 2048 x 1024 px
const LAYERS = [
  { id: 'viking', label: 'Colour', full: 'Viking colour', ext: 'jpg', credit: 'Viking Orbiter mosaic, NASA/JPL-Caltech/USGS' },
  { id: 'mola', label: 'Elevation', full: 'Elevation (MOLA)', ext: 'jpg', credit: 'MOLA, Mars Global Surveyor, NASA/GSFC' },
  { id: 'themis', label: 'Day heat', full: 'Day heat (THEMIS)', ext: 'png', note: 'covers 65 S to 65 N only',
    credit: 'THEMIS, Mars Odyssey, NASA/JPL-Caltech/Arizona State University' },
];
const ELEV_SOURCE = 'MOLA 4 px/degree grid, NASA PDS';

const state = {
  layer: LAYERS[0],
  textures: {},   // layer id -> THREE.CanvasTexture, kept once loaded
  grid: null,     // MOLA int16 grid
  patches: [],
  yaw: 0, pitch: 0,
  dist: 3.6,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  idle: false,
  settle: null,   // opening move: from the far side and far away to Gale
  go: null,       // camera move toward the patch before the walk page opens
  leaving: false,
  pending: false,
  lastDraw: 0,
};
state.idle = !state.reduced;
const GALE = { lat: -4.6, lon: 137.4 };
const SETTLE_MS = 3600, GO_MS = 1200, SWAY_MS = 44000, SWAY_AMP = 0.16;
// Sun direction in view space: upper left, toward the viewer, so Gale starts in daylight.
const SUN = new THREE.Vector3(-0.85, 0.25, 0.5).normalize();
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

// One lit sphere: the texture times a soft day/night factor. The night side
// stays at 22 percent so the texture can still be read there.
const globeMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: null }, sun: { value: SUN } },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vN;
    void main() {
      vUv = uv;
      vN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D map;
    uniform vec3 sun;
    varying vec2 vUv;
    varying vec3 vN;
    void main() {
      vec4 c = texture2D(map, vUv);
      float d = dot(normalize(vN), sun);
      float day = smoothstep(-0.25, 0.5, d);
      vec3 shade = mix(vec3(0.20, 0.22, 0.30), vec3(1.0), day);
      gl_FragColor = vec4(c.rgb * shade, 1.0);
      #include <colorspace_fragment>
    }`,
});
const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), globeMat);
scene.add(globe);

// Thin atmosphere: a larger back-facing sphere, brightest at the planet's edge
// and fading outward. Warm on the sunlit side, dim on the night side.
const rim = new THREE.Mesh(
  new THREE.SphereGeometry(1.07, 48, 24),
  new THREE.ShaderMaterial({
    uniforms: { sun: { value: SUN } },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 sun;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float t = clamp(-dot(vN, vV), 0.0, 1.0);
        float glow = pow(smoothstep(0.0, 0.3, t), 2.6);
        float lit = 0.3 + 0.7 * smoothstep(-0.4, 0.6, dot(normalize(vN * vec3(1.0, 1.0, -1.0)), sun));
        gl_FragColor = vec4(vec3(1.0, 0.55, 0.36) * glow * lit * 0.32, 1.0);
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  }),
);
scene.add(rim);

const GALE_VIEW = facing(GALE.lat, GALE.lon); // Gale crater facing the viewer
state.yaw = GALE_VIEW.yaw;
state.pitch = GALE_VIEW.pitch;
if (!state.reduced) {
  state.settle = { t0: 0, yaw: GALE_VIEW.yaw + 1.9, pitch: GALE_VIEW.pitch + 0.3, dist: 5 };
  state.yaw = state.settle.yaw;
  state.pitch = state.settle.pitch;
  state.dist = state.settle.dist;
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
  requestAnimationFrame(frame);
}

const ease = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

// Advances the opening move, the idle sway or the walk move. Returns true while
// something is still moving, so the page draws again; otherwise it sleeps.
function update(now) {
  const s = state.settle, g = state.go;
  if (g) {
    if (!g.t0) g.t0 = now;
    const e = easeInOut(Math.min(1, (now - g.t0) / GO_MS));
    state.yaw = g.yaw + (g.toYaw - g.yaw) * e;
    state.pitch = g.pitch + (g.toPitch - g.pitch) * e;
    state.dist = g.dist + (g.toDist - g.dist) * e;
    return e < 1;
  }
  if (s) {
    if (!s.t0) s.t0 = now;
    const p = Math.min(1, (now - s.t0) / SETTLE_MS), e = ease(p);
    state.yaw = s.yaw + (GALE_VIEW.yaw - s.yaw) * e;
    state.pitch = s.pitch + (GALE_VIEW.pitch - s.pitch) * e;
    state.dist = s.dist + (3.6 - s.dist) * e;
    if (p >= 1) { state.settle = null; state.swayT0 = now; }
    return true;
  }
  if (state.idle) {
    // Slow turn back and forth around Gale, so the ring stays in view for a recording.
    state.swayT0 = state.swayT0 || now;
    const a = (2 * Math.PI * (now - state.swayT0)) / SWAY_MS;
    state.yaw = GALE_VIEW.yaw + SWAY_AMP * Math.sin(a);
    state.pitch = GALE_VIEW.pitch + 0.05 * Math.sin(a * 0.5);
    return true;
  }
  return false;
}

function frame(now) {
  state.pending = false;
  const busy = state.settle || state.go;
  // The idle sway needs about 30 frames a second at most.
  if (!busy && state.idle && now - state.lastDraw < 33) { requestRender(); return; }
  const more = update(now);
  state.lastDraw = now;
  draw();
  // The browser itself holds frames back while the tab is hidden and
  // resumes them when it is shown, so the loop never has to stop here.
  if (more) requestRender();
}

function draw() {
  globe.rotation.set(state.pitch, state.yaw, 0, 'XYZ');
  camera.position.set(0, 0, state.dist);
  globe.updateMatrixWorld(true);
  rim.position.set(0, 0, 0);
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
  $('globe-credit').textContent = `${layer.full}: ${layer.credit}${layer.note ? '. Data ' + layer.note : ''}`;
  const tex = await textureFor(layer);
  if (state.layer !== layer) return; // the user already switched again
  globeMat.uniforms.map.value = tex;
  requestRender();
}

function buildLayerButtons() {
  for (const layer of LAYERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = layer.label;
    btn.title = `${layer.full}. ${layer.credit}`;
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
  $('intro-count').textContent = `${n} patch${n === 1 ? '' : 'es'} surveyed`;
  for (const id of ['patch-ring', 'patch-label']) {
    $(id).href = patches[0].href;
    $(id).title = `${patches[0].name}. ${patches[0].summary}`;
  }
  requestRender();
}

/* Walk: ease the camera to the patch while the ring grows and fades, fade the
   page to the background colour, then open the walk page. */

function walk() {
  if (state.leaving) return;
  state.leaving = true;
  state.idle = false;
  state.settle = null;
  hideHint();
  const href = state.patches[0] ? state.patches[0].href : 'index.html';
  if (state.reduced) { location.href = href; return; }
  const t = facing(state.patches[0] ? state.patches[0].centre.lat : GALE.lat,
    state.patches[0] ? state.patches[0].centre.lon : GALE.lon);
  let dy = t.yaw - state.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // the short way round
  state.go = { t0: 0, yaw: state.yaw, pitch: state.pitch, dist: state.dist,
    toYaw: state.yaw + dy, toPitch: t.pitch, toDist: 1.7 };
  document.body.classList.add('leaving');
  requestRender();
  // Timers, not frames, so a throttled tab still gets there.
  setTimeout(() => $('fade').classList.add('on'), GO_MS - 50);
  setTimeout(() => { location.href = href; }, GO_MS + 450);
}

for (const id of ['patch-ring', 'patch-label']) {
  $(id).addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    walk();
  });
}

// Coming back with the browser's back button: undo the exit.
addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  state.leaving = false;
  state.go = null;
  document.body.classList.remove('leaving');
  $('fade').classList.remove('on');
  requestRender();
});

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

function stopIdle() { state.idle = false; state.settle = null; hideHint(); }

function hideHint() { $('hint').classList.add('gone'); }
setTimeout(hideHint, 6000);

function zoomBy(factor) {
  state.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, state.dist * factor));
  requestRender();
}

host.addEventListener('pointerdown', (e) => {
  if (state.leaving) return;
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
  if (state.leaving) return;
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
  if (state.leaving) return;
  stopIdle();
  zoomBy(Math.exp(e.deltaY * 0.0012));
}, { passive: false });

function readout(e) {
  if (e.pointerType === 'touch') return;
  const p = pick(e.clientX, e.clientY);
  $('cursor-coord').textContent = p
    ? `${fmtLat(p.lat)}  ${p.lon.toFixed(2)}°E  ·  ${fmtElev(molaAt(state.grid, p.lat, p.lon))} (MOLA)`
    : '';
}
host.addEventListener('pointerleave', () => { $('cursor-coord').textContent = ''; });

function openCard(e) {
  const p = pick(e.clientX, e.clientY);
  if (!p) { $('card').hidden = true; return; }
  $('card-coord').textContent = `${fmtLat(p.lat)}  ${p.lon.toFixed(2)}°E`;
  $('card-elev').textContent = `Elevation ${fmtElev(molaAt(state.grid, p.lat, p.lon))}. Source: ${ELEV_SOURCE}.`;
  $('card').hidden = false;
}
$('card-close').addEventListener('click', () => { $('card').hidden = true; });

/* Keys for running a recording without the mouse */

addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') { $('card').hidden = true; return; }
  const i = ['1', '2', '3'].indexOf(e.key);
  if (i >= 0) { showLayer(LAYERS[i]); return; }
  const onControl = e.target.closest && e.target.closest('a, button');
  if (e.key === 'w' || e.key === 'W' || (e.key === 'Enter' && !onControl)) {
    e.preventDefault();
    walk();
  }
});

// Resume the idle sway after the tab was hidden.
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestRender(); });

addEventListener('resize', resize);

/* Start */

buildLayerButtons();
resize();
showLayer(state.layer);
loadPatches().catch(() => { $('intro-count').textContent = ''; });
fetch('data/global/mola_4ppd.bin')
  .then((r) => r.arrayBuffer())
  .then((buf) => { state.grid = parseMola(buf); })
  .catch(() => { /* readout then says "not loaded" */ });

// For checks in the browser console only.
window.__globe = { state, pick, camera, globe, draw, walk };
