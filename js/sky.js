// How much of the sky the terrain blocks at each point of the walk area.
// Less open sky means less radiation arriving from above. The grid is made
// by tools/shielding.mjs with the definition used by the Curiosity RAD team
// (Guo et al. 2026): the blocked share of the upper hemisphere, weighted by
// solid angle, seen from 1 m above the ground, out to 20 km.

import { rampImage } from './terrain.js';

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

// How the layer is drawn: clear where the sky is open, deeper violet where
// more of it is blocked.
export const SKY_RAMP = {
  title: 'Sky blocked',
  unit: '%',
  min: 12,
  max: 32,
  color(pct) {
    const t = Math.max(0, Math.min(1, (pct - this.min) / (this.max - this.min)));
    return [Math.round(110 + 60 * t), Math.round(150 - 100 * t), 255, Math.round(225 * Math.min(1, t * 1.5))];
  },
};

// Stored values are half-percent steps, hence the 0.5.
export const skyImage = (sky) => rampImage(sky.values, sky.cols, sky.rows, SKY_RAMP, 0.5);
