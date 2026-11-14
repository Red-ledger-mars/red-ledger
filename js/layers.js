// Map layers. Every entry names the mission and instrument it comes from,
// because that text is shown on screen and copied into CREDITS.md.
// Each address below was requested and returned an image on 14 Nov 2026.

// The walk area: the boxwork ridges on Mount Sharp, where Curiosity worked
// from May 2025 to March 2026 (sols 4540 to 4852).
export const SITE = {
  name: 'Gale crater, Mount Sharp',
  center: [-4.805, 137.3825], // lat, lon (east positive)
  zoom: 16,
  minZoom: 9,
  maxZoom: 19,
  bounds: [[-5.6, 136.6], [-4.0, 138.2]],
};

// Mars radius used by the elevation model and by NASA's rover map, in metres.
// All distances on the page are computed with it, not with Earth's.
export const MARS_RADIUS_M = 3396190;

const MMGIS = 'https://mars.nasa.gov/mmgis-maps/MSL/Layers';
const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ';

// One Mars Trek tile (zoom 9, row 269, column 902) covers the whole area the
// rover has driven, so thermal layers are placed as a single image.
const TREK_Z9_BOUNDS = [[-4.921875, 137.109375], [-4.5703125, 137.4609375]];

export const LAYERS = [
  {
    id: 'ctx',
    label: 'Context 6 m',
    kind: 'tiles',
    type: 'optical',
    on: true,
    base: true,
    url: `${MMGIS}/MSL_CTX_ortho_mosaic_6m/{z}/{x}/{y}.png`,
    options: { tms: true, minNativeZoom: 6, maxNativeZoom: 13, bounds: [[-7.84, 135.98], [-3.40, 139.49]] },
    credit: 'Context Camera (CTX), Mars Reconnaissance Orbiter. NASA/JPL-Caltech/MSSS',
  },
  {
    id: 'hirise',
    label: 'HiRISE colour 0.3 m',
    kind: 'tiles',
    type: 'optical',
    on: true,
    base: true,
    url: `${MMGIS}/MSL_Gale_HiRISE-LRGB_78quads/{z}/{x}/{y}.png`,
    options: { tms: true, minNativeZoom: 10, maxNativeZoom: 18, bounds: [[-4.8756, 137.3267], [-4.5551, 137.4786]] },
    credit: 'HiRISE camera, Mars Reconnaissance Orbiter. NASA/JPL-Caltech/University of Arizona',
  },
  {
    id: 'night',
    label: 'Night heat',
    kind: 'image',
    type: 'thermal',
    on: false,
    url: `${TREK}/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/9/269/902.png`,
    bounds: TREK_Z9_BOUNDS,
    options: { opacity: 0.6 },
    credit: 'THEMIS night infrared, Mars Odyssey. NASA/JPL-Caltech/Arizona State University. Brightness is relative night temperature, not kelvin',
  },
  {
    id: 'day',
    label: 'Day heat',
    kind: 'image',
    type: 'thermal',
    on: false,
    url: `${TREK}/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/9/269/902.png`,
    bounds: TREK_Z9_BOUNDS,
    options: { opacity: 0.6 },
    credit: 'THEMIS day infrared, Mars Odyssey. NASA/JPL-Caltech/Arizona State University. Brightness is relative day temperature, not kelvin',
  },
];
