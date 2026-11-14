// A light 3D view of the walk area: the elevation grid as a mesh, the HiRISE
// image draped over it, the two routes as tubes and a walker marker placed by
// distance along the active route. Plain three.js (no add-ons), drawn only when
// something changed.
//
// The first part of this file is pure maths with no browser objects, so it can
// be checked in node. The second part builds the scene.

import * as THREE from '../vendor/three/three.module.min.js';
import { SLOPE_RAMP } from './terrain.js';

const DEG = Math.PI / 180;

export const CREDIT_TEXT =
  'HiRISE: NASA/JPL-Caltech/University of Arizona. Elevation: NASA/JPL-Caltech/University of Arizona/USGS';

const TILE = 256;
const MAX_TEXTURE_PX = 2048;
const MESH_STEP = 2; // every second elevation cell

// ---------------------------------------------------------------- pure maths

// Pixel position on the whole-world Web Mercator image at zoom z. The tile
// scheme is the usual one with y counted down from the north edge.
export function mercatorPx(lat, lon, z) {
  const size = TILE * 2 ** z;
  const phi = lat * DEG;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
  };
}

// Inverse of mercatorPx, used when the slope tint is painted per pixel.
export function mercatorLatLon(x, y, z) {
  const size = TILE * 2 ** z;
  return {
    lon: (x / size) * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) / DEG,
  };
}

// Whole tiles that cover the elevation crop at zoom z (y counted from the
// north, as above). The block does not line up with the crop, so every texture
// coordinate goes through texCoord().
export function tileBlock(meta, z) {
  const pts = [
    [meta.north, meta.west], [meta.north, meta.east],
    [meta.south, meta.west], [meta.south, meta.east],
  ].map(([lat, lon]) => mercatorPx(lat, lon, z));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.floor(Math.min(...xs) / TILE);
  const x1 = Math.floor(Math.max(...xs) / TILE);
  const y0 = Math.floor(Math.min(...ys) / TILE);
  const y1 = Math.floor(Math.max(...ys) / TILE);
  return {
    z, x0, x1, y0, y1,
    width: (x1 - x0 + 1) * TILE,
    height: (y1 - y0 + 1) * TILE,
    originX: x0 * TILE,
    originY: y0 * TILE,
  };
}

// Highest zoom (16 down to 13, the tiles we hold) whose block fits the cap.
export function chooseBlock(meta, maxPx = MAX_TEXTURE_PX) {
  for (let z = 16; z >= 13; z--) {
    const b = tileBlock(meta, z);
    if (Math.max(b.width, b.height) <= maxPx) return b;
  }
  return tileBlock(meta, 13);
}

// Tiles on disk are in TMS row order: y_tms = 2^z - 1 - y_xyz.
export function tileUrl(z, x, yXyz) {
  return `tiles/hirise/${z}/${x}/${2 ** z - 1 - yXyz}.png`;
}

// Pixel on the stitched canvas and the matching texture coordinate (v points
// up, as three.js expects for a canvas texture).
export function texCoord(lat, lon, block) {
  const p = mercatorPx(lat, lon, block.z);
  const px = p.x - block.originX;
  const py = p.y - block.originY;
  return { px, py, u: px / block.width, v: 1 - py / block.height };
}

// Elevation grid sampled every `step` cells. Heights are stored relative to the
// lowest cell so the mesh sits near y = 0. Gaps in the data are filled with that
// lowest value.
export function buildGrid(terrain, step = MESH_STEP) {
  const nx = Math.floor((terrain.cols - 1) / step) + 1;
  const nz = Math.floor((terrain.rows - 1) / step) + 1;
  let zMin = Infinity;
  for (const v of terrain.z) if (v < zMin) zMin = v;
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const v = terrain.z[j * step * terrain.cols + i * step];
      h[j * nx + i] = Number.isNaN(v) ? 0 : v - zMin;
    }
  }
  const width = terrain.cols * terrain.px;
  const depth = terrain.rows * terrain.px;
  return {
    nx, nz, step, h, zMin, width, depth,
    // Local metres of vertex (0, 0): the centre of cell (0, 0).
    x0: 0.5 * terrain.px - width / 2,
    z0: 0.5 * terrain.px - depth / 2,
    dx: step * terrain.px,
  };
}

// Local metres (x east, z south, origin at the crop centre) of a point.
export function localXZ(terrain, lat, lon) {
  const { col, row } = terrain.toCell(lat, lon);
  return {
    x: col * terrain.px - (terrain.cols * terrain.px) / 2,
    z: row * terrain.px - (terrain.rows * terrain.px) / 2,
  };
}

// Inverse of localXZ: latitude and longitude of local metres (x east, z south).
export function localToLatLon(terrain, x, z) {
  const col = x / terrain.px + terrain.cols / 2;
  const row = z / terrain.px + terrain.rows / 2;
  // toLatLon takes the index of a cell, whose centre is half a cell in.
  return terrain.toLatLon(col - 0.5, row - 0.5);
}

// True when the point lies inside the elevation crop, so the mesh exists there.
export function inCrop(terrain, lat, lon) {
  const { col, row } = terrain.toCell(lat, lon);
  return col >= 0 && col <= terrain.cols && row >= 0 && row <= terrain.rows;
}

// Unit vector on the ground for a compass heading (0 = north, 90 = east,
// clockwise). North is -z and east is +x in local metres.
export function headingToDir(deg) {
  const a = deg * DEG;
  return { x: Math.sin(a), z: -Math.cos(a) };
}

// Where a walker ends up after `metres` along a compass heading. Used by pages
// that steer the free walk, so the maths lives next to the view that draws it.
export function walkForward(terrain, lat, lon, headingDeg, metres) {
  const l = localXZ(terrain, lat, lon);
  const d = headingToDir(headingDeg);
  return localToLatLon(terrain, l.x + d.x * metres, l.z + d.z * metres);
}

// Height of the drawn mesh at local (x, z), relative to grid.zMin. The quad
// split matches the index order used when the mesh is built.
export function surfaceHeight(grid, x, z) {
  const gx = Math.min(grid.nx - 1.000001, Math.max(0, (x - grid.x0) / grid.dx));
  const gz = Math.min(grid.nz - 1.000001, Math.max(0, (z - grid.z0) / grid.dx));
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const a = grid.h[j * grid.nx + i];
  const b = grid.h[j * grid.nx + i + 1];
  const c = grid.h[(j + 1) * grid.nx + i];
  const d = grid.h[(j + 1) * grid.nx + i + 1];
  // Diagonal runs from b (east, north) to c (west, south).
  return fx + fz <= 1 ? a + fx * (b - a) + fz * (c - a) : d + (1 - fx) * (c - d) + (1 - fz) * (b - d);
}

// Full-resolution elevation in metres (bilinear between cell centres). This is
// how the route elevations were made, so it should match route.elev to rounding.
export function elevBilinear(terrain, lat, lon) {
  const { col, row } = terrain.toCell(lat, lon);
  const c = col - 0.5, r = row - 0.5;
  const c0 = Math.floor(c), r0 = Math.floor(r);
  const fc = c - c0, fr = r - r0;
  const at = (cc, rr) =>
    terrain.z[Math.min(terrain.rows - 1, Math.max(0, rr)) * terrain.cols + Math.min(terrain.cols - 1, Math.max(0, cc))];
  return (1 - fr) * ((1 - fc) * at(c0, r0) + fc * at(c0 + 1, r0)) + fr * ((1 - fc) * at(c0, r0 + 1) + fc * at(c0 + 1, r0 + 1));
}

// A route as flat arrays in local metres, with the drawn-surface height under
// every point.
export function prepareRoute(terrain, grid, route) {
  const n = route.points.length;
  const x = new Float32Array(n), z = new Float32Array(n), y = new Float32Array(n), d = new Float32Array(n);
  route.points.forEach((p, i) => {
    const l = localXZ(terrain, p.lat, p.lon);
    x[i] = l.x;
    z[i] = l.z;
    y[i] = surfaceHeight(grid, l.x, l.z);
    d[i] = p.dist;
  });
  return { n, x, z, y, d, total: d[n - 1], stops: route.stops };
}

// Position at a distance along a prepared route (clamped to its ends).
export function sampleRoute(r, dist) {
  const dd = Math.min(r.total, Math.max(0, dist));
  let lo = 0, hi = r.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.d[mid] <= dd) lo = mid; else hi = mid;
  }
  const span = r.d[hi] - r.d[lo];
  const t = span > 0 ? (dd - r.d[lo]) / span : 0;
  return {
    x: r.x[lo] + t * (r.x[hi] - r.x[lo]),
    z: r.z[lo] + t * (r.z[hi] - r.z[lo]),
    y: r.y[lo] + t * (r.y[hi] - r.y[lo]),
  };
}

// Direction of travel as a unit vector in the ground plane, taken over a
// window around the walker so a zigzag does not whip the camera round.
export function routeHeading(r, dist, half = 25) {
  const a = sampleRoute(r, dist - half);
  const b = sampleRoute(r, dist + half);
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  return len > 1e-6 ? { x: dx / len, z: dz / len } : null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- scene

function stitchTiles(block) {
  const canvas = document.createElement('canvas');
  canvas.width = block.width;
  canvas.height = block.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1210';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const jobs = [];
  for (let ty = block.y0; ty <= block.y1; ty++) {
    for (let tx = block.x0; tx <= block.x1; tx++) {
      jobs.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, (tx - block.x0) * TILE, (ty - block.y0) * TILE);
          resolve(true);
        };
        img.onerror = () => resolve(false); // a missing tile stays dark
        img.src = tileUrl(block.z, tx, ty);
      }));
    }
  }
  return Promise.all(jobs).then((ok) => ({ canvas, missing: ok.filter((v) => !v).length }));
}

// The imagery with slope colour blended over it, same ramp as the 2D map.
function bakeSlope(terrain, block, base) {
  const canvas = document.createElement('canvas');
  canvas.width = block.width;
  canvas.height = block.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const m = terrain.meta;
  const cols = new Float32Array(canvas.width);
  const rows = new Float32Array(canvas.height);
  for (let px = 0; px < canvas.width; px++) {
    const { lon } = mercatorLatLon(block.originX + px + 0.5, block.originY, block.z);
    cols[px] = (terrain.radius * lon * DEG - m.x_left_m) / terrain.px - 0.5;
  }
  for (let py = 0; py < canvas.height; py++) {
    const { lat } = mercatorLatLon(block.originX, block.originY + py + 0.5, block.z);
    rows[py] = (m.y_top_m - terrain.radius * lat * DEG) / terrain.px - 0.5;
  }
  const s = terrain.slope;
  const data = img.data;
  for (let py = 0; py < canvas.height; py++) {
    const r = rows[py];
    if (r < 0 || r > terrain.rows - 1) continue;
    const r0 = Math.min(terrain.rows - 2, Math.floor(r));
    const fr = r - r0;
    for (let px = 0; px < canvas.width; px++) {
      const c = cols[px];
      if (c < 0 || c > terrain.cols - 1) continue;
      const c0 = Math.min(terrain.cols - 2, Math.floor(c));
      const fc = c - c0;
      const i = r0 * terrain.cols + c0;
      const deg = (1 - fr) * ((1 - fc) * s[i] + fc * s[i + 1]) + fr * ((1 - fc) * s[i + terrain.cols] + fc * s[i + terrain.cols + 1]);
      const [cr, cg, cb, ca] = SLOPE_RAMP.color(deg);
      if (ca <= 0) continue;
      const a = ca / 255;
      const o = (py * canvas.width + px) * 4;
      data[o] += (cr - data[o]) * a;
      data[o + 1] += (cg - data[o + 1]) * a;
      data[o + 2] += (cb - data[o + 2]) * a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function labelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fillStyle = 'rgba(14,10,8,0.92)';
  g.fill();
  g.lineWidth = 9;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = '#f3ebe0';
  g.font = '700 68px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A tube along a route. Its radius changes with how far away the camera is, so
// it stays readable in the wide view and does not swallow the chase view; the
// vertex positions are rewritten in place when that happens.
class RouteTube {
  constructor(route, grid, lift, color) {
    this.route = route;
    this.lift = lift;
    this.sides = 6;
    const n = route.n;
    const S = this.sides;
    this.centre = new Float32Array(n * 3);
    this.side = new Float32Array(n * 3);
    this.up = new Float32Array(n * 3);
    let px = 1, pz = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const tx = route.x[b] - route.x[a];
      const ty = route.y[b] - route.y[a];
      const tz = route.z[b] - route.z[a];
      // side = T x up(0,1,0) = (-tz, 0, tx), flattened to the ground plane
      let sx = -tz, sz = tx;
      const sl = Math.hypot(sx, sz);
      if (sl < 1e-6) { sx = px; sz = pz; } else { sx /= sl; sz /= sl; }
      px = sx; pz = sz;
      // up = side x T, normalised
      let ux = -sz * ty;
      let uy = sz * tx - sx * tz;
      let uz = sx * ty;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      if (uy < 0) { ux = -ux; uy = -uy; uz = -uz; }
      this.centre.set([route.x[i], route.y[i] + lift, route.z[i]], i * 3);
      this.side.set([sx, 0, sz], i * 3);
      this.up.set([ux, uy, uz], i * 3);
    }
    const index = [];
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < S; k++) {
        const a = i * S + k, b = i * S + ((k + 1) % S), c = (i + 1) * S + k, d = (i + 1) * S + ((k + 1) % S);
        index.push(a, c, b, b, c, d);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * S * 3), 3));
    this.geometry.setIndex(index);
    this.material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.radius = 0;
    this.setRadius(1.5);
  }

  setRadius(r) {
    if (r === this.radius) return;
    this.radius = r;
    const S = this.sides, n = this.route.n;
    const pos = this.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < S; k++) {
        const a = (k / S) * Math.PI * 2;
        const cs = Math.cos(a) * r, sn = Math.sin(a) * r;
        const o = (i * S + k) * 3;
        pos[o] = this.centre[i * 3] + cs * this.side[i * 3] + sn * this.up[i * 3];
        pos[o + 1] = this.centre[i * 3 + 1] + cs * this.side[i * 3 + 1] + sn * this.up[i * 3 + 1];
        pos[o + 2] = this.centre[i * 3 + 2] + cs * this.side[i * 3 + 2] + sn * this.up[i * 3 + 2];
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function inertView(root, message) {
  root.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'v3d-msg';
  p.textContent = message;
  root.appendChild(p);
  let shown = false;
  const noop = () => {};
  return {
    show() { shown = true; root.style.display = ''; },
    hide() { shown = false; root.style.display = 'none'; },
    isShown: () => shown,
    setWalkerAt: () => false, setTrail: noop, clearTrail: noop, setRoutesVisible: noop,
    setRoute: noop, setWalker: noop, setMode: noop, setExaggeration: noop,
    setSlopeTint: noop, resize: noop,
    dispose() { root.remove(); },
    available: false,
  };
}

export async function createView3D(container, { terrain, routes, colors = {} }) {
  const root = document.createElement('div');
  root.className = 'v3d-root';
  root.style.display = 'none';
  container.appendChild(root);

  if (!hasWebGL()) {
    return inertView(root, '3D view needs WebGL, which this browser or graphics driver does not offer. The map view still works.');
  }

  const grid = buildGrid(terrain);
  let ids = [];
  let prepared = {};
  const colorOf = (id) => colors[id] || '#ffb547';

  // ---- renderer
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
  } catch {
    return inertView(root, '3D view could not start the graphics driver. The map view still works.');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.domElement.className = 'v3d-canvas';
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#120c0a');
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 12000);

  // Relief light from the north-west, the usual map convention. HiRISE already
  // carries its own shading, so this is kept gentle.
  scene.add(new THREE.AmbientLight(0xffffff, 0.8 * Math.PI));
  const sun = new THREE.DirectionalLight(0xfff1e0, 0.75 * Math.PI);
  sun.position.set(-0.6, 0.8, -0.6).multiplyScalar(1000);
  scene.add(sun);

  // ---- terrain
  const block = chooseBlock(terrain.meta);
  const { canvas: imageCanvas, missing } = await stitchTiles(block);
  const imageTex = new THREE.CanvasTexture(imageCanvas);
  imageTex.colorSpace = THREE.SRGBColorSpace;
  imageTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let slopeTex = null;

  const terrainGroup = new THREE.Group(); // scaled in y for the exaggeration
  scene.add(terrainGroup);

  const { nx, nz } = grid;
  const positions = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      positions[k * 3] = grid.x0 + i * grid.dx;
      positions[k * 3 + 1] = grid.h[k];
      positions[k * 3 + 2] = grid.z0 + j * grid.dx;
      const { lat, lon } = terrain.toLatLon(i * grid.step, j * grid.step);
      const t = texCoord(lat, lon, block);
      uvs[k * 2] = t.u;
      uvs[k * 2 + 1] = t.v;
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      indices.set([a, c, b, b, c, d], q); // diagonal b-c, as in surfaceHeight()
      q += 6;
    }
  }
  const terrainGeo = new THREE.BufferGeometry();
  terrainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  terrainGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  terrainGeo.setIndex(new THREE.BufferAttribute(indices, 1));
  terrainGeo.computeVertexNormals();
  const terrainMat = new THREE.MeshLambertMaterial({ map: imageTex });
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainGroup.add(terrainMesh);

  // Dark walls round the edge so the crop reads as a block, not a floating sheet.
  const skirtBase = -30;
  const skirtPos = [];
  const edge = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
      skirtPos.push(ax, ay, az, ax, skirtBase, az, bx, by, bz, bx, by, bz, ax, skirtBase, az, bx, skirtBase, bz);
    }
  };
  const vert = (i, j) => [positions[(j * nx + i) * 3], positions[(j * nx + i) * 3 + 1], positions[(j * nx + i) * 3 + 2]];
  edge(Array.from({ length: nx }, (_, i) => vert(i, 0)));
  edge(Array.from({ length: nx }, (_, i) => vert(i, nz - 1)));
  edge(Array.from({ length: nz }, (_, j) => vert(0, j)));
  edge(Array.from({ length: nz }, (_, j) => vert(nx - 1, j)));
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
  skirtGeo.computeVertexNormals();
  const skirtMat = new THREE.MeshLambertMaterial({ color: 0x2a1b15, side: THREE.DoubleSide });
  terrainGroup.add(new THREE.Mesh(skirtGeo, skirtMat));

  // ---- routes
  const LIFT = 0.8; // metres above the drawn ground
  let tubes = {};
  // (Re)builds the tubes for a set of routes: { direct: {...}, body: {...} }.
  // The page can hand over a new set when the carried load changes.
  function installRoutes(set) {
    const next = set.routes || set;
    for (const id of ids) {
      terrainGroup.remove(tubes[id].mesh);
      tubes[id].dispose();
    }
    ids = Object.keys(next);
    prepared = {};
    tubes = {};
    for (const id of ids) {
      prepared[id] = prepareRoute(terrain, grid, next[id]);
      tubes[id] = new RouteTube(prepared[id], grid, LIFT, colorOf(id));
      tubes[id].mesh.visible = routesVisible;
      terrainGroup.add(tubes[id].mesh);
    }
  }

  // ---- pins (outside the scaled group so they are not stretched)
  const pinGroup = new THREE.Group();
  scene.add(pinGroup);
  const pinPole = new THREE.CylinderGeometry(1, 1, 1, 6);
  const pinPoleMat = new THREE.MeshBasicMaterial({ color: 0xf3ebe0 });
  const pins = []; // { group, pole, sprite, tex }
  const labelTextures = [];

  function rebuildPins() {
    for (const p of pins) {
      pinGroup.remove(p.group);
      p.sprite.material.dispose();
    }
    pins.length = 0;
    for (const t of labelTextures) t.dispose();
    labelTextures.length = 0;
    const r = prepared[activeId];
    const stops = r.stops;
    stops.forEach((s, i) => {
      const last = i === stops.length - 1;
      const label = i === 0 || last ? 'H' : String(i);
      const a = { x: r.x[s.index], z: r.z[s.index], y: r.y[s.index] };
      // The walk ends where it starts; one pin is enough.
      if (last && Math.hypot(a.x - r.x[stops[0].index], a.z - r.z[stops[0].index]) < 8) return;
      const group = new THREE.Group();
      const pole = new THREE.Mesh(pinPole, pinPoleMat);
      const tex = labelTexture(label, colorOf(activeId));
      labelTextures.push(tex);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.renderOrder = 10;
      group.add(pole, sprite);
      pinGroup.add(group);
      pins.push({ group, pole, sprite, a });
    });
  }

  // ---- walker
  const walker = new THREE.Group();
  const walkerBody = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
  );
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.8, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.45 });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6), beamMat);
  walker.add(walkerBody, ring, beam);
  scene.add(walker);

  // Wedge on the ground in front of a free walker. Drawn over the terrain (no
  // depth test) so a slope in front of it cannot hide which way it points.
  const markerGeo = new THREE.BufferGeometry();
  markerGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 0, 3.2], 3));
  markerGeo.setIndex([0, 1, 2]);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95 });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.renderOrder = 6;
  marker.visible = false;
  scene.add(marker);

  // Trail of a free walk: a flat ribbon in a buffer sized once, so a growing
  // path never allocates new geometry. Long paths are thinned to fit.
  const TRAIL_MAX = 4000;
  const TRAIL_EVERY_MS = 200;
  const TRAIL_LIFT = 0.5;
  const trail = {
    xs: [], zs: [], first: null, half: 1.2, step: null,
    mesh: null, geo: null, mat: null, lastBuild: 0, timer: 0,
  };
  function ensureTrailMesh() {
    if (trail.mesh) return;
    const idx = new Uint32Array((TRAIL_MAX - 1) * 6);
    for (let i = 0; i < TRAIL_MAX - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.set([a, c, b, b, c, d], i * 6);
    }
    trail.geo = new THREE.BufferGeometry();
    trail.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 6), 3));
    trail.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    trail.geo.setDrawRange(0, 0);
    trail.mat = new THREE.MeshBasicMaterial({ color: '#f3ebe0', side: THREE.DoubleSide });
    trail.mesh = new THREE.Mesh(trail.geo, trail.mat);
    trail.mesh.frustumCulled = false;
    trail.mesh.renderOrder = 3;
    terrainGroup.add(trail.mesh);
  }
  function rebuildTrail() {
    trail.timer = 0;
    trail.lastBuild = performance.now();
    if (disposed || !trail.mesh) return;
    const n = trail.xs.length;
    if (n < 2) { trail.geo.setDrawRange(0, 0); invalidate(); return; }
    const stride = Math.ceil(n / TRAIL_MAX);
    const keep = [];
    for (let i = 0; i < n; i += stride) keep.push(i);
    if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
    const m = Math.min(keep.length, TRAIL_MAX);
    const pos = trail.geo.attributes.position.array;
    let sx = 1, sz = 0;
    for (let k = 0; k < m; k++) {
      const a = keep[Math.max(0, k - 1)], b = keep[Math.min(m - 1, k + 1)];
      const tx = trail.xs[b] - trail.xs[a], tz = trail.zs[b] - trail.zs[a];
      const len = Math.hypot(tx, tz);
      if (len > 1e-6) { sx = -tz / len; sz = tx / len; }
      const cx = trail.xs[keep[k]], cz = trail.zs[keep[k]];
      for (let side = 0; side < 2; side++) {
        const sgn = side ? -1 : 1;
        const vx = cx + sgn * sx * trail.half, vz = cz + sgn * sz * trail.half;
        const o = (k * 2 + side) * 3;
        pos[o] = vx;
        pos[o + 1] = surfaceHeight(grid, vx, vz) + TRAIL_LIFT;
        pos[o + 2] = vz;
      }
    }
    trail.geo.attributes.position.needsUpdate = true;
    trail.geo.setDrawRange(0, (m - 1) * 6);
    invalidate();
  }
  function clearTrailNow() {
    if (trail.timer) clearTimeout(trail.timer);
    trail.timer = 0;
    trail.xs.length = 0;
    trail.zs.length = 0;
    trail.first = null;
    if (trail.geo) trail.geo.setDrawRange(0, 0);
  }

  // ---- state
  let mode = 'orbit';
  let exag = 1;
  let walkerDist = 0;
  let shown = false;
  let disposed = false;
  let raf = 0;
  let lastT = 0;
  let transition = 0; // seconds left of the slower glide after a mode change
  let chaseBack = 55;
  let heading = 0; // eased heading of the walker, radians; forward = (sin, cos) in (x, z)
  let tubeStep = null;
  let routesVisible = true;
  // Free walk: when set, the walker stands at a chosen point and heading
  // instead of at a distance along the active route.
  const free = { on: false, x: 0, z: 0, y: 0, deg: 0 };

  installRoutes(routes);
  let activeId = ids.includes('direct') ? 'direct' : ids[0];
  const centreOfRoutes = (() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const id of ids) {
      const r = prepared[id];
      for (let i = 0; i < r.n; i++) {
        x0 = Math.min(x0, r.x[i]); x1 = Math.max(x1, r.x[i]);
        z0 = Math.min(z0, r.z[i]); z1 = Math.max(z1, r.z[i]);
      }
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    return { x: cx, z: cz, radius: Math.hypot(x1 - x0, z1 - z0) / 2, y: surfaceHeight(grid, cx, cz) };
  })();

  const orbit = { az: 0, pol: 58 * DEG, dist: 1400 };
  function fitDistance() {
    const vf = camera.fov * DEG;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    return clamp((centreOfRoutes.radius * 1.15) / Math.tan(Math.min(vf, hf) / 2), 300, 3500);
  }
  function resetOrbit() {
    orbit.az = 0; // camera south of the walk, looking north: north is up
    orbit.pol = 58 * DEG;
    orbit.dist = fitDistance();
  }

  const cur = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const des = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const yOf = (h) => h * exag;

  function walkerWorld(out = new THREE.Vector3()) {
    if (free.on) return out.set(free.x, yOf(free.y + LIFT + 0.6), free.z);
    const s = sampleRoute(prepared[activeId], walkerDist);
    return out.set(s.x, yOf(s.y + LIFT + 0.6), s.z);
  }

  function targetHeading() {
    if (free.on) {
      const d = headingToDir(free.deg);
      return Math.atan2(d.x, d.z); // camera heading uses forward = (sin, cos) in (x, z)
    }
    const h = routeHeading(prepared[activeId], walkerDist);
    return h ? Math.atan2(h.x, h.z) : null;
  }

  function computeDesired() {
    if (mode === 'chase') {
      const w = walkerWorld(new THREE.Vector3());
      const fx = Math.sin(heading), fz = Math.cos(heading);
      des.pos.set(w.x - fx * chaseBack, w.y + chaseBack * 0.42, w.z - fz * chaseBack);
      des.look.set(w.x + fx * 18, w.y + 1, w.z + fz * 18);
    } else {
      const t = new THREE.Vector3(centreOfRoutes.x, yOf(centreOfRoutes.y), centreOfRoutes.z);
      const sp = Math.sin(orbit.pol);
      des.look.copy(t);
      des.pos.set(t.x + orbit.dist * sp * Math.sin(orbit.az), t.y + orbit.dist * Math.cos(orbit.pol), t.z + orbit.dist * sp * Math.cos(orbit.az));
    }
    // Keep the camera above the ground it is over.
    const gy = yOf(surfaceHeight(grid, des.pos.x, des.pos.z)) + 6;
    if (des.pos.y < gy) des.pos.y = gy;
  }

  // Moves the camera part of the way to where it should be. Returns true while
  // it is still moving, so the loop keeps going.
  function stepCamera(dt, instant = false) {
    let moving = false;
    if (mode === 'chase') {
      const target = targetHeading();
      if (target !== null) {
        let diff = target - heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const f = instant ? 1 : 1 - Math.exp(-2.2 * dt);
        heading += diff * f;
        if (Math.abs(diff * (1 - f)) > 0.002) moving = true;
      }
    }
    computeDesired();
    const k = transition > 0 ? 3.2 : mode === 'chase' ? 4.5 : 14;
    const f = instant ? 1 : 1 - Math.exp(-k * dt);
    cur.pos.lerp(des.pos, f);
    cur.look.lerp(des.look, f);
    if (transition > 0) { transition = Math.max(0, transition - dt); moving = true; }
    if (cur.pos.distanceTo(des.pos) > 0.05 || cur.look.distanceTo(des.look) > 0.05) moving = true;
    return moving;
  }

  const tmp = new THREE.Vector3();
  const compassNeedle = document.createElement('div');
  compassNeedle.className = 'v3d-compass-needle';
  const compass = document.createElement('div');
  compass.className = 'v3d-compass';
  compass.setAttribute('aria-label', 'North indicator');
  compass.appendChild(compassNeedle);
  const badge = document.createElement('div');
  badge.className = 'v3d-badge';
  badge.textContent = 'Height x2';
  badge.hidden = true;
  const credit = document.createElement('div');
  credit.className = 'v3d-credit';
  credit.textContent = CREDIT_TEXT;
  const hint = document.createElement('div');
  hint.className = 'v3d-hint';
  root.append(compass, badge, credit, hint);

  function updateHint() {
    hint.textContent = mode === 'orbit' ? 'Drag to turn, wheel to zoom, double-click to reset' : 'Wheel to move the camera closer or further back';
  }

  // Draw the scene once with the camera where it is now.
  function renderNow() {
    camera.position.copy(cur.pos);
    camera.lookAt(cur.look);
    camera.updateMatrixWorld();

    // Tube radius follows the camera distance, in coarse steps.
    const dist = cur.pos.distanceTo(cur.look);
    const step = Math.round(Math.log2(clamp(dist * 0.0035, 0.35, 2.4)) * 3);
    if (step !== tubeStep) {
      tubeStep = step;
      const r = 2 ** (step / 3);
      for (const id of ids) tubes[id].setRadius(id === activeId ? r : r * 0.6);
    }

    // The trail ribbon widens with the tube radius, in the same coarse steps.
    if (trail.mesh && trail.step !== step) {
      trail.step = step;
      trail.half = 0.9 * 2 ** (step / 3);
      rebuildTrail();
    }

    // Walker and pins keep a readable size on screen.
    walkerWorld(walker.position);
    const ws = clamp(camera.position.distanceTo(walker.position) * 0.004, 1.1, 8);
    walker.scale.setScalar(ws);
    beam.scale.set(0.14, Math.min(dist * 0.04, 60) / ws, 0.14);
    beam.position.y = Math.min(dist * 0.04, 60) / ws / 2;
    marker.visible = free.on;
    if (free.on) {
      const d = headingToDir(free.deg);
      const mx = free.x + d.x * ws * 4.2, mz = free.z + d.z * ws * 4.2;
      marker.position.set(mx, yOf(surfaceHeight(grid, mx, mz) + LIFT + 0.3), mz);
      marker.rotation.y = Math.atan2(d.x, d.z);
      marker.scale.setScalar(ws * 1.4);
    }
    for (const p of pins) {
      p.group.position.set(p.a.x, yOf(p.a.y + LIFT), p.a.z);
      const u = clamp(camera.position.distanceTo(p.group.position) * 0.02, 1.5, 30);
      p.pole.scale.set(0.1 * u, 2.5 * u, 0.1 * u);
      p.pole.position.y = 1.25 * u;
      p.sprite.scale.setScalar(2 * u);
      p.sprite.position.y = 3.4 * u;
    }

    // North arrow: heading of the camera, clockwise from north (-z).
    camera.getWorldDirection(tmp);
    const yaw = Math.atan2(tmp.x, -tmp.z) / DEG;
    compassNeedle.style.transform = `rotate(${(-yaw).toFixed(1)}deg)`;

    renderer.render(scene, camera);
  }

  function tick(t) {
    raf = 0;
    if (!shown || disposed) return;
    const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 1 / 60;
    lastT = t;
    const moving = stepCamera(dt);
    renderNow();
    if (moving) raf = requestAnimationFrame(tick);
    else lastT = 0;
  }
  function invalidate() {
    if (!shown || disposed || raf) return;
    raf = requestAnimationFrame(tick);
  }

  // ---- input (orbit mode only; the wheel also works in chase)
  const el = renderer.domElement;
  const pointers = new Map();
  let pinch = 0;
  function onDown(e) {
    el.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) zoom(pinch / d);
      pinch = d;
    } else if (mode === 'orbit') {
      orbit.az -= dx * 0.006;
      orbit.pol = clamp(orbit.pol - dy * 0.005, 8 * DEG, 84 * DEG);
      invalidate();
    }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    pinch = 0;
  }
  function zoom(factor) {
    if (mode === 'orbit') orbit.dist = clamp(orbit.dist * factor, 90, 4000);
    else chaseBack = clamp(chaseBack * factor, 25, 160);
    invalidate();
  }
  function onWheel(e) {
    e.preventDefault();
    zoom(Math.exp(e.deltaY * 0.0012));
  }
  function onDouble() {
    if (mode === 'orbit') { resetOrbit(); invalidate(); }
  }
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('dblclick', onDouble);

  function resize() {
    if (disposed) return;
    const rect = root.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (w < 2 || h < 2) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(root);

  // The active route is solid; the other is dimmed and drawn underneath.
  function styleRoutes() {
    tubeStep = null;
    for (const k of ids) {
      tubes[k].material.opacity = k === activeId ? 1 : 0.4;
      tubes[k].material.depthWrite = k === activeId;
      tubes[k].mesh.renderOrder = k === activeId ? 2 : 1;
    }
    ringMat.color.set(colorOf(activeId));
  }

  // ---- start state
  styleRoutes();
  camera.aspect = 16 / 9;
  resetOrbit();
  rebuildPins();
  updateHint();
  computeDesired();
  cur.pos.copy(des.pos);
  cur.look.copy(des.look);

  const api = {
    available: true,
    show() {
      if (disposed) return;
      shown = true;
      root.style.display = '';
      resize();
      invalidate();
    },
    hide() {
      shown = false;
      root.style.display = 'none';
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastT = 0;
    },
    isShown: () => shown,
    setRoute(id) {
      if (!prepared[id] || id === activeId) return;
      activeId = id;
      walkerDist = Math.min(walkerDist, prepared[id].total);
      styleRoutes();
      rebuildPins();
      invalidate();
    },
    // Extra to the agreed API: swap in a new set of routes (for example when the
    // carried load changes). Keeps the active route id, mode and walker distance.
    setRoutes(next) {
      installRoutes(next);
      if (!prepared[activeId]) activeId = ids[0];
      walkerDist = Math.min(walkerDist, prepared[activeId].total);
      styleRoutes();
      rebuildPins();
      invalidate();
    },
    setWalker(dist) {
      free.on = false;
      walkerDist = clamp(Number(dist) || 0, 0, prepared[activeId].total);
      invalidate();
    },
    // Free walk. Puts the walker at a latitude and longitude, facing a compass
    // heading (degrees clockwise from north). Does nothing and returns false
    // outside the elevation crop. In chase mode the camera follows through the
    // same easing as the route chase, so a turn does not snap.
    setWalkerAt(lat, lon, headingDeg) {
      lat = Number(lat); lon = Number(lon); headingDeg = Number(headingDeg);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inCrop(terrain, lat, lon)) return false;
      const l = localXZ(terrain, lat, lon);
      free.on = true;
      free.x = l.x;
      free.z = l.z;
      free.y = surfaceHeight(grid, l.x, l.z);
      free.deg = Number.isFinite(headingDeg) ? headingDeg : 0;
      invalidate();
      return true;
    },
    // Path walked so far, as [{ lat, lon }]. Cheap to call on every step: new
    // points are converted once and the ribbon is rebuilt at most five times a second.
    setTrail(points) {
      if (disposed || !Array.isArray(points)) return;
      ensureTrailMesh();
      const n = points.length;
      const f = points[0];
      const same = trail.first && f && f.lat === trail.first.lat && f.lon === trail.first.lon;
      if (!same || n < trail.xs.length) {
        trail.xs.length = 0;
        trail.zs.length = 0;
        trail.first = f ? { lat: f.lat, lon: f.lon } : null;
      }
      for (let i = trail.xs.length; i < n; i++) {
        const l = localXZ(terrain, points[i].lat, points[i].lon);
        trail.xs.push(l.x);
        trail.zs.push(l.z);
      }
      const wait = TRAIL_EVERY_MS - (performance.now() - trail.lastBuild);
      if (wait <= 0) rebuildTrail();
      else if (!trail.timer) trail.timer = setTimeout(rebuildTrail, wait);
    },
    clearTrail() {
      clearTrailNow();
      invalidate();
    },
    // Hides or shows the planned route tubes and their stop pins, so a free
    // trail can be seen alone.
    setRoutesVisible(on) {
      const v = !!on;
      for (const id of ids) tubes[id].mesh.visible = v;
      pinGroup.visible = v;
      routesVisible = v;
      invalidate();
    },
    setMode(m) {
      const next = m === 'chase' ? 'chase' : 'orbit';
      if (next === mode) return;
      mode = next;
      if (mode === 'chase') {
        const t = targetHeading();
        if (t !== null) heading = t;
      }
      transition = 1.1;
      updateHint();
      invalidate();
    },
    setExaggeration(v) {
      exag = Number(v) === 2 ? 2 : 1;
      terrainGroup.scale.y = exag;
      badge.hidden = exag !== 2;
      invalidate();
    },
    setSlopeTint(on) {
      if (on && !slopeTex) {
        slopeTex = new THREE.CanvasTexture(bakeSlope(terrain, block, imageCanvas));
        slopeTex.colorSpace = THREE.SRGBColorSpace;
        slopeTex.anisotropy = imageTex.anisotropy;
      }
      terrainMat.map = on ? slopeTex : imageTex;
      terrainMat.needsUpdate = true;
      invalidate();
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      shown = false;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDouble);
      clearTrailNow();
      if (trail.mesh) { trail.geo.dispose(); trail.mat.dispose(); }
      markerGeo.dispose(); markerMat.dispose();
      for (const id of ids) tubes[id].dispose();
      for (const p of pins) p.sprite.material.dispose();
      for (const t of labelTextures) t.dispose();
      terrainGeo.dispose(); skirtGeo.dispose(); terrainMat.dispose(); skirtMat.dispose();
      imageTex.dispose(); slopeTex?.dispose();
      pinPole.dispose(); pinPoleMat.dispose();
      walkerBody.geometry.dispose(); walkerBody.material.dispose();
      ring.geometry.dispose(); ringMat.dispose(); beam.geometry.dispose(); beamMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
    },
    // For the test page and for checks: run the camera to rest and draw, without
    // waiting for animation frames.
    debug: {
      settle() {
        resize();
        for (let i = 0; i < 600 && stepCamera(1 / 30); i++);
        stepCamera(1 / 30, true);
        renderNow();
      },
      state: () => ({
        mode, exag, activeId, walkerDist, missingTiles: missing,
        cam: cur.pos.toArray(), look: cur.look.toArray(), orbit: { ...orbit },
        block, vertices: grid.nx * grid.nz,
      }),
      grid, prepared, block,
      setOrbit(o) { Object.assign(orbit, o); },
    },
  };
  return api;
}
