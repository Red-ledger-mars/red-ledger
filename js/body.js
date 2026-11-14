// What walking costs a body. Every constant here carries its source and a
// `checked` flag. A value with `checked: false` has not yet been confirmed
// against the primary source and is shown on screen as an assumption.

export const SOURCES = {
  walkCost: {
    label: 'Minetti et al. 2002, J Appl Physiol 93:1039',
    url: 'https://europepmc.org/article/MED/12183501',
    what: 'Energy cost of walking by slope, measured at Earth gravity for gradients from -0.45 to +0.45',
    checked: false,
  },
  gravity: {
    label: 'Farley and McMahon 1992, J Appl Physiol 73:2709',
    url: 'https://europepmc.org/article/MED/1490989',
    what: 'Walking at a quarter of Earth gravity cost about 33% less energy',
    checked: false,
  },
};

export const ASSUMPTIONS = {
  // Mars gravity is 0.38 of Earth's. The saving is read off a straight line
  // between the two measured points (Earth gravity: none; 0.25 g: 33%).
  marsWalkFactor: 1 - 0.33 * (1 - 0.38) / (1 - 0.25),
  // Slope cost has only been measured at Earth gravity. The same Mars factor
  // is applied at every slope.
  slopeAtMarsGravity: 'same factor at every slope',
  bodyMassKg: 75,
  suitMassKg: 80,
};

// Steepest gradient (rise over run) in the walking measurements.
export const MAX_MEASURED_GRADIENT = 0.45;

// Energy cost of walking at Earth gravity, joules per kg per metre, for a
// gradient i (rise over run). Polynomial fit from Minetti et al. 2002.
export function walkCostEarth(i) {
  const g = Math.max(-MAX_MEASURED_GRADIENT, Math.min(MAX_MEASURED_GRADIENT, i));
  return 280.5 * g ** 5 - 58.7 * g ** 4 - 76.8 * g ** 3 + 51.9 * g ** 2 + 19.6 * g + 2.5;
}

// The same cost at Mars gravity, joules per kg per metre.
export function walkCostMars(i) {
  return walkCostEarth(i) * ASSUMPTIONS.marsWalkFactor;
}

export const JOULES_PER_KCAL = 4184;

export function totalMassKg() {
  return ASSUMPTIONS.bodyMassKg + ASSUMPTIONS.suitMassKg;
}
