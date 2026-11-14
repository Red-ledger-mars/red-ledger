// Body heat as colour, the only colour on the story page. White when cool,
// amber at three quarters of NASA's limit, red at the limit and above. The
// three colours come from the theme; the limit comes from the body model.
import { MODEL } from './body.js';

const WARM_AT = 0.75; // share of the limit where the colour reaches amber

function hex(c) {
  const v = c.trim().replace('#', '');
  const full = v.length === 3 ? [...v].map((x) => x + x).join('') : v;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

let ramp = null;
function colours() {
  if (!ramp) {
    const css = getComputedStyle(document.documentElement);
    ramp = ['--heat-cool', '--heat-warm', '--heat-hot'].map((name) => hex(css.getPropertyValue(name) || '#ffffff'));
  }
  return ramp;
}

const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

// 0 when the body holds no extra heat, 1 at NASA's limit.
export const heatShare = (kJkg) => Math.max(0, kJkg / MODEL.heatLimitKJkg);

export function heatColor(kJkg) {
  const [cool, warm, hot] = colours();
  const s = heatShare(kJkg);
  const rgb = s <= WARM_AT ? mix(cool, warm, s / WARM_AT) : mix(warm, hot, Math.min(1, (s - WARM_AT) / (1 - WARM_AT)));
  return `rgb(${rgb.join(', ')})`;
}

export const heatState = (kJkg) => {
  const s = heatShare(kJkg);
  return s >= 1 ? 'over' : s >= WARM_AT ? 'warm' : 'cool';
};
