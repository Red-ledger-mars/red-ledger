// Free walk: the viewer steers the walker over the ground, and the same body
// model as the planned routes runs on whatever ground they choose. The steps
// and the messages are the planner page's free walk (js/app.js) as a module,
// so the story can use it too.
import { MODEL, MAX_MEASURED_GRADIENT, step, Ledger } from './body.js';
import { MARS_RADIUS_M } from './layers.js';

const DEG = Math.PI / 180;
export const FREE = {
  timeScale: 30,   // one second on screen is this many seconds of walking
  lookAhead: 4,    // metres ahead used to read the slope under the walker
  turnDegPerS: 100,
  arriveM: 14,     // how close counts as reaching a stop
};

// A point `metres` away from (lat, lon) in the direction `headingDeg`
// (clockwise from north).
export function ahead(lat, lon, headingDeg, metres) {
  return {
    lat: lat + (metres * Math.cos(headingDeg * DEG)) / MARS_RADIUS_M / DEG,
    lon: lon + (metres * Math.sin(headingDeg * DEG)) / (MARS_RADIUS_M * Math.cos(lat * DEG)) / DEG,
  };
}

export function metresBetween(a, b) {
  return Math.hypot((a.lat - b.lat) * DEG * MARS_RADIUS_M, (a.lon - b.lon) * DEG * MARS_RADIUS_M * Math.cos(a.lat * DEG));
}

// A walk from the habitat, facing the first stop. Call tick() every frame
// with the keys held down; it returns true when the trail grew.
export function createFreeWalk({ terrain, sky, walk, loadKg = 0 }) {
  const home = walk.habitat;
  const first = walk.stops[0];
  const f = {
    lat: home.lat,
    lon: home.lon,
    heading: Math.atan2((first.lon - home.lon) * Math.cos(home.lat * DEG), first.lat - home.lat) / DEG,
    ledger: new Ledger(),
    dist: 0,
    rests: 0,
    peakHeat: 0,
    trail: [{ lat: home.lat, lon: home.lon }],
    reached: new Set(),
    reachedStop: null,
    pausedUntil: 0,
    message: 'Arrow keys: turn and walk. Reach stop 3 without overheating.',
  };

  f.tick = (now, dt, keys) => {
    f.reachedStop = null;
    if (now < f.pausedUntil) return false;
    if (keys.has('ArrowLeft')) f.heading -= FREE.turnDegPerS * dt;
    if (keys.has('ArrowRight')) f.heading += FREE.turnDegPerS * dt;
    if (!keys.has('ArrowUp')) return false;
    const here = terrain.elevSmooth(f.lat, f.lon);
    const probe = ahead(f.lat, f.lon, f.heading, FREE.lookAhead);
    const there = terrain.elevSmooth(probe.lat, probe.lon);
    if (here == null || there == null) {
      f.message = 'Edge of the surveyed patch.';
      return false;
    }
    const gradient = (there - here) / FREE.lookAhead;
    if (Math.abs(gradient) > MAX_MEASURED_GRADIENT) {
      f.message = `Too steep to walk: ${Math.round(Math.atan(Math.abs(gradient)) / DEG)}°. No walking study covers ground this steep.`;
      return false;
    }
    // The model sets the pace for this slope; the walker covers what that
    // pace allows in this slice of time.
    const pace = step(FREE.lookAhead, gradient * FREE.lookAhead, loadKg).speed;
    const run = pace * dt * FREE.timeScale;
    const next = ahead(f.lat, f.lon, f.heading, run);
    const skyPct = sky?.at(next.lat, next.lon) ?? MODEL.skyReferencePct;
    const taken = step(run, gradient * run, loadKg);
    f.ledger.add(taken, skyPct);
    f.lat = next.lat;
    f.lon = next.lon;
    f.dist += taken.length;
    f.skyPct = skyPct;
    f.peakHeat = Math.max(f.peakHeat, f.ledger.heatKJkg);
    f.message = '';
    if (f.ledger.needsRest) {
      const seconds = f.ledger.rest(skyPct);
      f.rests++;
      f.pausedUntil = now + 1800;
      f.message = `Body heat near NASA's limit. Resting ${(seconds / 60).toFixed(0)} min to shed it.`;
    }
    walk.stops.forEach((stop, i) => {
      if (f.reached.has(stop.id) || metresBetween(stop, f) > FREE.arriveM) return;
      f.reached.add(stop.id);
      f.reachedStop = stop;
      f.message = `Reached stop ${i + 1} in ${(f.ledger.seconds / 60).toFixed(0)} min. Peak body heat ${f.peakHeat.toFixed(1)} kJ/kg, ${f.rests} forced rest${f.rests === 1 ? '' : 's'}.`;
      f.pausedUntil = now + 1500;
    });
    const last = f.trail[f.trail.length - 1];
    if (metresBetween(last, f) > 3) {
      f.trail.push({ lat: f.lat, lon: f.lon });
      return true;
    }
    return false;
  };
  return f;
}
