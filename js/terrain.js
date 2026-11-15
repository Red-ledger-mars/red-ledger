// The elevation crop for the walk area: loading, lookups and slope.
// The file is cut by tools/cut_dem.py from the USGS Gale crater terrain model.

const DEG = Math.PI / 180;

export class Terrain {
  constructor(meta, z) {
    Object.assign(this, {
      meta,
      z,
      cols: meta.cols,
      rows: meta.rows,
      px: meta.pixel_m,
      radius: meta.radius_m,
    });
    this.slope = computeSlope(this);
  }

  // Leaflet bounds of the crop: [[south, west], [north, east]].
  get bounds() {
    const m = this.meta;
    return [[m.south, m.west], [m.north, m.east]];
  }

  // Fractional column and row of a point; the grid is a plain
  // longitude/latitude grid scaled by the Mars radius.
  toCell(lat, lon) {
    const m = this.meta;
    return {
      col: (this.radius * lon * DEG - m.x_left_m) / this.px,
      row: (m.y_top_m - this.radius * lat * DEG) / this.px,
    };
  }

  // Latitude and longitude of the centre of a cell.
  toLatLon(col, row) {
    const m = this.meta;
    return {
      lat: (m.y_top_m - (row + 0.5) * this.px) / this.radius / DEG,
      lon: (m.x_left_m + (col + 0.5) * this.px) / this.radius / DEG,
    };
  }

  inside(col, row) {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  // Elevation in metres at a point, or null outside the crop.
  elevAt(lat, lon) {
    const { col, row } = this.toCell(lat, lon);
    const c = Math.floor(col);
    const r = Math.floor(row);
    if (!this.inside(c, r)) return null;
    return this.z[r * this.cols + c];
  }

  // Elevation blended between the four nearest cell centres, so a walker
  // moving less than a cell at a time sees a smooth slope and not steps.
  elevSmooth(lat, lon) {
    const { col, row } = this.toCell(lat, lon);
    const c = col - 0.5;
    const r = row - 0.5;
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= this.cols || r0 + 1 >= this.rows) return null;
    const fc = c - c0;
    const fr = r - r0;
    const at = (cc, rr) => this.z[rr * this.cols + cc];
    return (at(c0, r0) * (1 - fc) + at(c0 + 1, r0) * fc) * (1 - fr) + (at(c0, r0 + 1) * (1 - fc) + at(c0 + 1, r0 + 1) * fc) * fr;
  }

  slopeAt(lat, lon) {
    const { col, row } = this.toCell(lat, lon);
    const c = Math.floor(col);
    const r = Math.floor(row);
    if (!this.inside(c, r)) return null;
    return this.slope[r * this.cols + c];
  }
}

// Slope in degrees for every cell, from the eight neighbours (Horn's method,
// the same one GIS tools use). At 4 m spacing this smooths features smaller
// than a few metres, so single boxwork ridges read gentler than they are.
function computeSlope(t) {
  const { cols, rows, px, z } = t;
  const out = new Float32Array(cols * rows);
  const at = (c, r) => z[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = at(c - 1, r - 1), b = at(c, r - 1), d = at(c + 1, r - 1);
      const e = at(c - 1, r), f = at(c + 1, r);
      const g = at(c - 1, r + 1), h = at(c, r + 1), i = at(c + 1, r + 1);
      const dzdx = ((d + 2 * f + i) - (a + 2 * e + g)) / (8 * px);
      const dzdy = ((g + 2 * h + i) - (a + 2 * b + d)) / (8 * px);
      out[r * cols + c] = Math.atan(Math.hypot(dzdx, dzdy)) / DEG;
    }
  }
  return out;
}

export async function loadTerrain() {
  const meta = await (await fetch('data/dem_boxwork_4m.json')).json();
  const raw = new Uint16Array(await (await fetch(`data/${meta.file}`)).arrayBuffer());
  const z = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    z[i] = raw[i] === meta.nodata ? NaN : meta.base_m + raw[i] / 100;
  }
  return new Terrain(meta, z);
}

// How slope is drawn. Ground a walker crosses without thinking stays clear,
// so the picture underneath is visible; colour starts at 12 degrees and is
// full at 30. No claim is made here about what a suited walker can climb.
export const SLOPE_RAMP = {
  title: 'Slope',
  note: 'The body-cost route takes no ground steeper than 24°. Rocks and ridges smaller than the 4 m elevation grid are not seen.',
  unit: '°',
  min: 12,
  max: 30,
  color(deg) {
    const t = Math.max(0, Math.min(1, (deg - this.min) / (this.max - this.min)));
    return [255, Math.round(190 - 150 * t), Math.round(70 - 30 * t), Math.round(235 * Math.min(1, t * 1.6))];
  },
};

// Draws a grid of values to an image the map can lay over the terrain.
// The outer cells fade out so the layer has no hard edge.
export function rampImage(values, cols, rows, ramp, scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cols, rows);
  const fade = Math.max(2, Math.round(Math.min(cols, rows) * 0.03));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = values[r * cols + c] * scale;
      if (Number.isNaN(v)) continue;
      const [red, green, blue, alpha] = ramp.color(v);
      const edge = Math.min(1, Math.min(c, r, cols - 1 - c, rows - 1 - r) / fade);
      img.data.set([red, green, blue, alpha * edge], (r * cols + c) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export const slopeImage = (t) => rampImage(t.slope, t.cols, t.rows, SLOPE_RAMP);
