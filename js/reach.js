// Body-reach map: what a walk from the habitat to a point and straight back
// costs the body, for every 4 m cell of the elevation crop and each carried
// load. The route is the body-cost one (least walking energy, nothing
// steeper than the walking measurements), the same planWalk finds.
//
// Per cell and load the grid holds the rests the planner adds, the peak
// stored heat if the walker never rests, and the time with the rests. It is
// made by tools/reach.mjs with the model in js/body.js; this module only
// looks it up and draws it.

const DEG = Math.PI / 180;
const NO_ROUTE = 255;
const HEAT_SCALE = 20;

// Legend for the layer, in the order of the colours below. The colours are
// chosen to read on orange Mars imagery and to stay apart from the heat red
// used elsewhere on the page.
export const REACH_LEGEND = [
  { label: 'No rest', color: 'rgba(0, 0, 0, 0)' },
  { label: '1 rest', color: 'rgba(99, 214, 193, 0.45)' },
  { label: '2 rests', color: 'rgba(255, 181, 71, 0.55)' },
  { label: '3 or more rests', color: 'rgba(255, 85, 51, 0.6)' },
  { label: 'No route', color: 'rgba(20, 16, 14, 0.7)' },
];

// The same colours as [red, green, blue, alpha 0-255] for the image.
const RGBA = [
  [0, 0, 0, 0],
  [99, 214, 193, 115],
  [255, 181, 71, 140],
  [255, 85, 51, 153],
  [20, 16, 14, 179],
];
const colourOf = (rests) => RGBA[rests === NO_ROUTE ? 4 : Math.min(3, rests)];

export class Reach {
  constructor(meta, bytes) {
    Object.assign(this, { meta, cols: meta.cols, rows: meta.rows, loads: meta.loads_kg });
    const size = meta.cols * meta.rows;
    // Layers in the file: for each load, rests, heat, minutes.
    this.layers = this.loads.map((_, i) => ({
      rests: bytes.subarray((3 * i) * size, (3 * i + 1) * size),
      heat: bytes.subarray((3 * i + 1) * size, (3 * i + 2) * size),
      minutes: bytes.subarray((3 * i + 2) * size, (3 * i + 3) * size),
    }));
  }

  // Leaflet bounds of the grid: [[south, west], [north, east]].
  get bounds() { return this.meta.bounds; }

  // Cell of a point, found as Terrain.toCell finds it, or null off the grid.
  cell(lat, lon) {
    const m = this.meta;
    const c = Math.floor((m.radius_m * lon * DEG - m.x_left_m) / m.pixel_m);
    const r = Math.floor((m.y_top_m - m.radius_m * lat * DEG) / m.pixel_m);
    // The comparisons below are all false for a point that is not a number.
    if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return null;
    return r * this.cols + c;
  }

  // What going to a point and back costs, for one of the stored loads, or
  // null off the grid or for a load that is not stored. Heat is rounded to
  // 0.05 kJ/kg and time to the minute.
  at(lat, lon, loadKg) {
    const cell = this.cell(lat, lon);
    const layer = this.layers[this.loads.indexOf(loadKg)];
    if (cell == null || !layer) return null;
    const rests = layer.rests[cell];
    if (rests === NO_ROUTE) return { reachable: false, rests: null, peakHeatKJkg: null, minutes: null };
    return { reachable: true, rests, peakHeatKJkg: layer.heat[cell] / HEAT_SCALE, minutes: layer.minutes[cell] };
  }

  // The layer for one load as a PNG data URL for a Leaflet imageOverlay,
  // coloured by rests. Each cell is drawn as a block of `scale` pixels with
  // no smoothing and no faded edge, so the boundary on the map is where the
  // grid puts it. (Setting image-rendering: pixelated on the overlay keeps
  // it sharp at any zoom.)
  image(loadKg, scale = 3) {
    const layer = this.layers[this.loads.indexOf(loadKg)];
    if (!layer) return null;
    const { cols, rows } = this;
    const canvas = document.createElement('canvas');
    canvas.width = cols * scale;
    canvas.height = rows * scale;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(canvas.width, canvas.height);
    const data = img.data;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const colour = colourOf(layer.rests[r * cols + c]);
        if (colour[3] === 0) continue;
        for (let y = r * scale; y < (r + 1) * scale; y++) {
          for (let x = c * scale; x < (c + 1) * scale; x++) data.set(colour, (y * canvas.width + x) * 4);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }
}

// The layers are stored gzip-compressed. If a server has already undone
// the compression (Content-Encoding), the bytes arrive plain.
async function gunzip(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadReach(base = 'data/reach/') {
  const meta = await (await fetch(base + 'reach.json')).json();
  const bytes = await gunzip(await (await fetch(base + meta.file)).arrayBuffer());
  if (bytes.length !== meta.loads_kg.length * 3 * meta.cols * meta.rows) throw new Error('reach grid has the wrong size');
  return new Reach(meta, bytes);
}
