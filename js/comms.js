// Comms shadow: when a walker can see a Mars relay orbiter over the terrain.
//
// Orbiter positions come from NASA/JPL Horizons for one sol (sol 4752,
// 18 Dec 2025 UTC), seen from the "ridges" stop. The terrain horizon at each
// point of the 16 m walk-area grid comes from the USGS Gale elevation model.
// Both are made by tools/comms.mjs; this module only looks them up.
//
// This is geometric visibility only: a line of sight from 1.7 m above the
// ground. A real relay session is also scheduled in advance, needs the
// orbiter's antenna and radio to be used for the surface, and needs enough
// link margin. None of that is modelled here.

import { rampImage } from './terrain.js';

const DEG = Math.PI / 180;
const RADIUS_M = 3396190;

// Terrain horizon at one grid cell for an azimuth (degrees clockwise from
// north), linear between the stored azimuths. Stored as int8 half-degrees.
export function horizonAt(horizon, cell, az, nAz) {
  const k = (((az % 360) + 360) % 360) / (360 / nAz);
  const i0 = Math.floor(k) % nAz;
  const i1 = (i0 + 1) % nAz;
  const t = k - Math.floor(k);
  const base = cell * nAz;
  return (horizon[base + i0] * (1 - t) + horizon[base + i1] * t) / 2;
}

// One sample is in view when it is above both the terrain and the mask.
export const visible = (el, horizonDeg, minElev) => el > minElev && el > horizonDeg;

export class Comms {
  constructor({ horizonMeta, horizon, gridMeta, minutes0, minutes10, passes }) {
    Object.assign(this, {
      horizonMeta, horizon, gridMeta, minutes0, minutes10, passes,
      cols: horizonMeta.cols, rows: horizonMeta.rows, spacing: horizonMeta.spacing_m,
      nAz: horizonMeta.azimuths,
      values: minutes0, // what the map layer draws
      solMinutes: passes.time.samples,
    });
    // Per orbiter: minute of the sol -> [az, el]. Only samples above -5 deg are stored.
    this.orbiters = passes.orbiters.map((o) => {
      const byMinute = new Map();
      for (const [m, az, el] of o.samples) byMinute.set(m, [az, el]);
      return { name: o.name, byMinute };
    });
  }

  cell(lat, lon) {
    const m = this.horizonMeta;
    const c = Math.round((RADIUS_M * lon * DEG - m.origin_x_m) / this.spacing);
    const r = Math.round((m.origin_y_m - RADIUS_M * lat * DEG) / this.spacing);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return null;
    return r * this.cols + c;
  }

  // Minutes per sol with at least one orbiter above the terrain (0 deg mask),
  // or null outside the grid. minElev 10 uses the second grid.
  at(lat, lon, minElev = 0) {
    const cell = this.cell(lat, lon);
    if (cell == null) return null;
    return (minElev === 10 ? this.minutes10 : this.minutes0)[cell];
  }

  namesAtCell(cell, minute, minElev = 0) {
    const out = [];
    for (const o of this.orbiters) {
      const s = o.byMinute.get(minute);
      if (s && visible(s[1], horizonAt(this.horizon, cell, s[0], this.nAz), minElev)) out.push(o.name);
    }
    return out;
  }

  // Orbiters in view at a point at a whole minute of the sol (0 = 00:00 UTC
  // on the start date); null outside the grid.
  inView(lat, lon, minuteOfSol, minElev = 0) {
    const cell = this.cell(lat, lon);
    if (cell == null) return null;
    return this.namesAtCell(cell, this.wrap(minuteOfSol), minElev);
  }

  // Orbiters above the mask that the terrain hides at that moment: the
  // "terrain cuts the link" case. null outside the grid.
  blockedBy(lat, lon, minuteOfSol, minElev = 0) {
    const cell = this.cell(lat, lon);
    if (cell == null) return null;
    const m = this.wrap(minuteOfSol);
    return this.orbiters.filter((o) => {
      const s = o.byMinute.get(m);
      return s && s[1] > minElev && !visible(s[1], horizonAt(this.horizon, cell, s[0], this.nAz), minElev);
    }).map((o) => o.name);
  }

  wrap(minute) {
    return ((Math.round(minute) % this.solMinutes) + this.solMinutes) % this.solMinutes;
  }

  // Contact windows over the sol: [startMinute, endMinute (exclusive), names].
  windows(lat, lon, minElev = 0) {
    const cell = this.cell(lat, lon);
    if (cell == null) return null;
    const out = [];
    let cur = null;
    for (let m = 0; m < this.solMinutes; m++) {
      const names = this.namesAtCell(cell, m, minElev);
      if (names.length) {
        if (!cur) { cur = [m, m + 1, new Set()]; out.push(cur); }
        cur[1] = m + 1;
        names.forEach((n) => cur[2].add(n));
      } else cur = null;
    }
    return out.map(([a, b, s]) => [a, b, [...s]]);
  }

  // For route points with seconds from the start: whether any orbiter is in
  // view at each point (null outside the grid), and the longest stretch out
  // of contact in minutes (from the first point without contact to the next
  // point with contact, or to the end of the route).
  routeContact(points, startMinute = 0, minElev = 0) {
    const flags = points.map((p) => {
      const names = this.inView(p.lat, p.lon, startMinute + p.seconds / 60, minElev);
      return names == null ? null : names.length > 0;
    });
    let longest = 0, since = null;
    points.forEach((p, i) => {
      if (flags[i] === false && since == null) since = p.seconds;
      if (flags[i] === true && since != null) { longest = Math.max(longest, (p.seconds - since) / 60); since = null; }
    });
    if (since != null) longest = Math.max(longest, (points[points.length - 1].seconds - since) / 60);
    return { inContact: flags, longestGapMin: longest };
  }

  // Local mean solar time at the site for a minute of the sol, "HH:MM".
  localTime(minuteOfSol) {
    const t = this.passes.time;
    const h = (((t.lmst_at_minute0_h + minuteOfSol / t.earth_minutes_per_mars_hour) % 24) + 24) % 24;
    const mm = Math.floor(h * 60 + 1e-6);
    return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
  }

  // Leaflet bounds; each value stands for a 16 m square around its point.
  get bounds() {
    const m = this.horizonMeta;
    const half = this.spacing / 2;
    const lat = (y) => y / RADIUS_M / DEG;
    const lon = (x) => x / RADIUS_M / DEG;
    return [
      [lat(m.origin_y_m - (this.rows - 1) * this.spacing - half), lon(m.origin_x_m - half)],
      [lat(m.origin_y_m + half), lon(m.origin_x_m + (this.cols - 1) * this.spacing + half)],
    ];
  }
}

export async function loadComms(base = 'data/comms/') {
  const get = (f) => fetch(base + f);
  const [horizonMeta, gridMeta, passes] = await Promise.all(
    ['horizon.json', 'in_view_minutes.json', 'passes.json'].map(async (f) => (await get(f)).json()),
  );
  const [h, m0, m10] = await Promise.all(
    [horizonMeta.file, gridMeta.grids['0'].file, gridMeta.grids['10'].file].map(async (f) => (await get(f)).arrayBuffer()),
  );
  return new Comms({
    horizonMeta, horizon: new Int8Array(h), gridMeta,
    minutes0: new Uint16Array(m0), minutes10: new Uint16Array(m10), passes,
  });
}

// How the layer is drawn: clear at the best-connected point of the grid,
// deeper blue-grey where the terrain takes more minutes away. min and max are
// the lowest and highest grid values in data/comms/in_view_minutes.json
// (0 deg mask). Over a flat plain the same orbiters would give 336 minutes.
export const COMMS_RAMP = {
  title: 'Orbiter in view',
  unit: ' min per sol',
  min: 145,
  max: 304,
  color(minutes) {
    const t = Math.max(0, Math.min(1, (this.max - minutes) / (this.max - this.min)));
    return [Math.round(90 - 50 * t), Math.round(140 - 80 * t), Math.round(200 - 60 * t), Math.round(230 * Math.min(1, t * 1.4))];
  },
};

export const commsImage = (comms) => rampImage(comms.values, comms.cols, comms.rows, COMMS_RAMP);
