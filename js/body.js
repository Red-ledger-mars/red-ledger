// What a walk costs a body. This file holds the whole model, so it can be
// read, checked and reused on its own. Every constant names its source.
// `status` says how far the value was confirmed:
//   'primary'    read in the source document itself
//   'abstract'   read in the paper's abstract or a paper that quotes it
//   'assumption' chosen by us; shown on screen with the assumption mark

export const SOURCES = {
  walkCost: {
    label: 'Minetti et al. 2002, J Appl Physiol 93:1039',
    url: 'https://europepmc.org/article/MED/12183501',
    what: 'Energy cost of walking by slope at Earth gravity, gradients -0.45 to +0.45. Abstract values: 1.64 J/kg/m on the level, 17.33 at +0.45. The polynomial fit is taken from a paper that quotes it.',
    status: 'abstract',
  },
  gravity: {
    label: 'Farley and McMahon 1992, J Appl Physiol 73:2709',
    url: 'https://europepmc.org/article/MED/1490989',
    what: 'Walking at 0.25 of Earth gravity cost 33% less energy. Mars is 0.38: a straight line between the two measured points gives 27% less. Slope cost has never been measured at Mars gravity; the same factor is applied at every slope.',
    status: 'assumption',
  },
  suitMass: {
    label: 'NASA, Apollo A7L-B suit and backpack',
    url: 'https://www.nasa.gov/general/innovative-offloading-of-astronauts-for-more-effective-exploration/',
    what: 'Earth weight 212 lb (96 kg): 77 lb garment and 135 lb life-support backpack. No mass has been published for a Mars suit.',
    status: 'primary',
  },
  bodyMass: {
    label: 'NASA-STD-3001 Vol 1 Rev C, 4.1.1',
    url: 'https://www.nasa.gov/directorates/esdmd/hhp/human-spaceflight-and-aviation-standards/',
    what: 'An 80 kg crew member, the value NASA assumes in its spacewalk workload figures.',
    status: 'assumption',
  },
  workRange: {
    label: 'NASA-STD-3001 Vol 2 Rev F, [V2 11011]',
    url: 'https://www.nasa.gov/directorates/esdmd/hhp/human-spaceflight-and-aviation-standards/',
    what: 'Suited work is designed for 528 to 2220 kJ/h (147 to 617 W). The walker slows down on climbs to stay at or under 617 W.',
    status: 'primary',
  },
  pace: {
    label: 'Level walking speed in Minetti et al. 2002',
    url: 'https://europepmc.org/article/MED/12183501',
    what: 'The walker moves at 1.0 m/s unless the work limit forces a slower pace.',
    status: 'assumption',
  },
  cooling: {
    label: 'NASA NTRS 20130014146',
    url: 'https://ntrs.nasa.gov/citations/20130014146',
    what: 'A prototype spacesuit evaporator rated to reject 810 W in vacuum and 370 W in a Mars environment. It is a prototype rating, not a flight suit figure. The model lets the suit remove 370 W and nothing more.',
    status: 'primary',
  },
  heatLimit: {
    label: 'NASA-STD-3001 Vol 2 Rev F, [V2 11011] and [V2 6014]',
    url: 'https://www.nasa.gov/directorates/esdmd/hhp/human-spaceflight-and-aviation-standards/',
    what: 'Stored body heat must stay under 3.0 kJ/kg in suited work. 4.7 kJ/kg is the contingency limit, where thinking starts to be impaired.',
    status: 'primary',
  },
  coreTemp: {
    label: 'Specific heat of the body, 3.47 kJ/kg/°C',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10274559/',
    what: 'The conventional value used to turn stored heat into a mean body temperature rise. A 2022 paper notes it was never directly measured.',
    status: 'assumption',
  },
  load: {
    label: 'Carried load, chosen by the planner',
    url: 'https://ntrs.nasa.gov/citations/19760005584',
    what: 'Tools and rock samples carried by the walker. No Mars figure exists; the three settings (none, 15 kg, 30 kg) are ours.',
    status: 'assumption',
  },
  rest: {
    label: 'NASA-STD-3001 Vol 2 Rev F, [V2 11011]',
    url: 'https://www.nasa.gov/directorates/esdmd/hhp/human-spaceflight-and-aviation-standards/',
    what: 'A resting walker is taken to work at 147 W, the bottom of NASA\'s design range for suited work, so the suit can remove 223 W of stored heat. The rule for when to rest (stop at 90% of the limit, walk on at 50%) is ours.',
    status: 'assumption',
  },
  energyBudget: {
    label: 'Biomedical Results of Apollo, NASA SP-368',
    url: 'https://ntrs.nasa.gov/citations/19760005584',
    what: 'The Apollo 15 to 17 life-support backpack was budgeted for 7530 kJ (1800 kcal) of metabolic heat.',
    status: 'primary',
  },
  dose: {
    label: 'Guo et al. 2015, Curiosity RAD, arXiv:1507.03473',
    url: 'https://arxiv.org/abs/1507.03473',
    what: 'Dose equivalent on the surface at Gale crater about 0.7 mSv per day.',
    status: 'primary',
  },
  shielding: {
    label: 'Guo et al. 2026, JGR Planets, Table 1',
    url: 'https://elib.dlr.de/224554/',
    what: 'At eight places Curiosity measured 2% to 19% less dose where terrain blocked more sky: about 1% less dose for each extra percentage point of sky blocked (0.7 to 1.5 across the sites, no error bars given). The model applies 1% per point, counted from the 10% of sky blocked in the reference period of Guo et al. 2021. Applying it to dose equivalent is our assumption.',
    status: 'assumption',
  },
  comms: {
    label: 'NASA/JPL Horizons, orbiter positions for sol 4752',
    url: 'https://ssd.jpl.nasa.gov/horizons/',
    what: 'When the Mars Reconnaissance Orbiter, Mars Odyssey, the ExoMars Trace Gas Orbiter or Mars Express is above the terrain as seen by a walker 1.7 m tall, on 18 December 2025. Line of sight only: real relay sessions are scheduled and need more than a clear view. MAVEN is left out, because NASA lost contact with it on 6 December 2025.',
    status: 'assumption',
  },
  doseLimit: {
    label: 'NASA-STD-3001 Vol 1 Rev C, [V1 4030]',
    url: 'https://www.nasa.gov/directorates/esdmd/hhp/human-spaceflight-and-aviation-standards/',
    what: 'Career limit for an astronaut: under 600 mSv.',
    status: 'primary',
  },
};

export const MODEL = {
  marsGravity: 3.71,             // m/s2
  marsWalkFactor: 1 - 0.33 * (1 - 0.38) / (1 - 0.25), // Farley point, read off a straight line
  bodyMassKg: 80,
  suitMassKg: 96,
  paceMs: 1.0,
  workLimitW: 617,
  coolingW: 370,
  restW: 147,                    // work rate while standing still
  restAt: 0.9,                   // rest when stored heat reaches this share of the limit
  resumeAt: 0.5,                 // walk on when it has fallen to this share
  heatLimitKJkg: 3.0,
  heatContingencyKJkg: 4.7,
  bodySpecificHeat: 3.47,        // kJ/kg/°C
  energyBudgetKcal: 1800,
  doseRateUSvPerS: 700 / 86400,  // 0.7 mSv per day
  skyReferencePct: 10,           // sky blocked where that rate was measured
  dosePerSkyPoint: 0.01,         // share of dose lost per extra point of sky blocked
  careerLimitUSv: 600000,
};

// Steepest gradient (rise over run) in the walking measurements.
export const MAX_MEASURED_GRADIENT = 0.45;
export const JOULES_PER_KCAL = 4184;

// Mass the walker moves: body, suit and whatever is carried.
export const totalMassKg = (loadKg = 0) => MODEL.bodyMassKg + MODEL.suitMassKg + loadKg;

// Energy cost of walking at Earth gravity, joules per kg per metre walked,
// for a gradient i (rise over run). Polynomial fit from Minetti et al. 2002.
// It gives 2.5 on the level; the value measured on the level was 1.64.
export function walkCostEarth(i) {
  const g = Math.max(-MAX_MEASURED_GRADIENT, Math.min(MAX_MEASURED_GRADIENT, i));
  return 280.5 * g ** 5 - 58.7 * g ** 4 - 76.8 * g ** 3 + 51.9 * g ** 2 + 19.6 * g + 2.5;
}

// The same cost at Mars gravity.
export const walkCostMars = (i) => walkCostEarth(i) * MODEL.marsWalkFactor;

// One step of a walk: `run` metres on the map, rising `rise` metres.
// Returns what it costs and how fast the walker can take it.
export function step(run, rise, loadKg = 0) {
  const mass = totalMassKg(loadKg);
  const length = Math.hypot(run, rise);
  const joules = walkCostMars(rise / run) * length * mass;
  // At the planned pace the step would need this much power; if that is over
  // the work limit, the walker slows until it is not.
  const speed = Math.min(MODEL.paceMs, MODEL.workLimitW / (joules / length));
  const seconds = length / speed;
  const metabolicW = joules / seconds;
  // Climbing stores part of the effort as height. Descending gives that
  // energy back, and the muscles that brake the descent turn it into heat.
  const heatW = metabolicW - (mass * MODEL.marsGravity * rise) / seconds;
  return { length, joules, seconds, speed, metabolicW, heatW };
}

// A running record of the body along a walk. Call `add` for each step in
// order and read the totals after each call.
export class Ledger {
  constructor() {
    this.seconds = 0;
    this.joules = 0;
    this.storedJ = 0;      // body heat the suit has not removed
    this.peakStoredJ = 0;
    this.overLimitM = 0;   // metres walked while over the 3.0 kJ/kg limit
    this.doseUSv = 0;
  }

  // `skyPct` is the share of sky the terrain blocks during this step.
  add(s, skyPct = MODEL.skyReferencePct) {
    this.doseUSv += s.seconds * MODEL.doseRateUSvPerS * doseFactor(skyPct);
    this.seconds += s.seconds;
    this.joules += s.joules;
    // The suit removes up to its limit. Heat above that stays in the body;
    // spare cooling on easier ground takes stored heat back out.
    this.storedJ = Math.max(0, this.storedJ + (s.heatW - MODEL.coolingW) * s.seconds);
    this.peakStoredJ = Math.max(this.peakStoredJ, this.storedJ);
    if (this.heatKJkg > MODEL.heatLimitKJkg) this.overLimitM += s.length;
  }

  // Standing still until stored heat has fallen to the resume level.
  // Returns the seconds rested. Dose and energy keep counting.
  rest(skyPct = MODEL.skyReferencePct) {
    const target = MODEL.resumeAt * MODEL.heatLimitKJkg * 1000 * MODEL.bodyMassKg;
    const seconds = Math.max(0, (this.storedJ - target) / (MODEL.coolingW - MODEL.restW));
    this.seconds += seconds;
    this.joules += MODEL.restW * seconds;
    this.doseUSv += seconds * MODEL.doseRateUSvPerS * doseFactor(skyPct);
    this.storedJ -= (MODEL.coolingW - MODEL.restW) * seconds;
    return seconds;
  }

  // True when the walker should stop and cool down before the next step.
  get needsRest() { return this.heatKJkg >= MODEL.restAt * MODEL.heatLimitKJkg; }

  get kcal() { return this.joules / JOULES_PER_KCAL; }
  get heatKJkg() { return this.storedJ / 1000 / MODEL.bodyMassKg; }
  get peakHeatKJkg() { return this.peakStoredJ / 1000 / MODEL.bodyMassKg; }
}

// Dose rate at a place relative to the reference rate, from how much sky
// the terrain blocks there.
export const doseFactor = (skyPct) => 1 - MODEL.dosePerSkyPoint * (skyPct - MODEL.skyReferencePct);

// Mean body temperature rise for a given stored heat.
export const tempRiseC = (heatKJkg) => heatKJkg / MODEL.bodySpecificHeat;
