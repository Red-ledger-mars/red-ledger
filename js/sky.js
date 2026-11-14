// How much of the sky the terrain blocks at each point of the walk area.
// Less open sky means less radiation arriving from above. The grid is made
// by tools/shielding.mjs with the definition used by the Curiosity RAD team
// (Guo et al. 2026): the blocked share of the upper hemisphere, weighted by
// solid angle, seen from 1 m above the ground, out to 20 km.

const DEG = Math.PI / 180;
const RADIUS_M = 3396190;

export class Sky {
  constructor(meta, values) {
    Object.assign(this, { meta, values, cols: meta.cols, rows: meta.rows, spacing: meta.spacing_m });
  }

  // Percent of sky blocked at a point, taken from the nearest grid point,
  // or null outside the grid.
  at(lat, lon) {
    const m = this.meta;
    const c = Math.round((RADIUS_M * lon * DEG - m.origin_x_m) / this.spacing);
    const r = Math.round((m.origin_y_m - RADIUS_M * lat * DEG) / this.spacing);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return null;
    return this.values[r * this.cols + c] / 2;
  }

  // Leaflet bounds of the grid; each value stands for a 16 m square around
  // its point, so the bounds reach half a square past the outer points.
  get bounds() {
    const m = this.meta;
    const half = this.spacing / 2;
    const lat = (y) => y / RADIUS_M / DEG;
    const lon = (x) => x / RADIUS_M / DEG;
    return [
      [lat(m.origin_y_m - (this.rows - 1) * this.spacing - half), lon(m.origin_x_m - half)],
      [lat(m.origin_y_m + half), lon(m.origin_x_m + (this.cols - 1) * this.spacing + half)],
    ];
  }
}

export async function loadSky() {
  const meta = await (await fetch('data/shielding/boxwork_sky_blocked.json')).json();
  const values = new Uint8Array(await (await fetch(`data/shielding/${meta.file}`)).arrayBuffer());
  return new Sky(meta, values);
}

export const SKY_STEPS = [
  { upTo: 8, color: [120, 190, 255, 0] },
  { upTo: 12, color: [120, 190, 255, 70] },
  { upTo: 16, color: [90, 150, 255, 120] },
  { upTo: 20, color: [80, 105, 245, 160] },
  { upTo: 25, color: [110, 70, 225, 195] },
  { upTo: Infinity, color: [160, 50, 200, 225] },
];

export function skyImage(sky) {
  const canvas = document.createElement('canvas');
  canvas.width = sky.cols;
  canvas.height = sky.rows;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(sky.cols, sky.rows);
  for (let i = 0; i < sky.values.length; i++) {
    img.data.set(SKY_STEPS.find((step) => sky.values[i] / 2 < step.upTo).color, i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
