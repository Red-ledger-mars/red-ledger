# Credits and sources

Every dataset, paper, library, image, sound and font used in Red Ledger, with its licence or usage terms. Updated as items are added.

## NASA data

| Layer or dataset | Mission and instrument | Data type | Credit | Where it is loaded from |
|---|---|---|---|---|
| HiRISE colour mosaic of Gale crater (about 0.3 m per pixel) | Mars Reconnaissance Orbiter, HiRISE camera | Optical | NASA/JPL-Caltech/University of Arizona | NASA's Curiosity location map, `mars.nasa.gov/mmgis-maps/MSL/Layers/MSL_Gale_HiRISE-LRGB_78quads/` |
| CTX orthomosaic of Gale crater (6 m per pixel) | Mars Reconnaissance Orbiter, Context Camera | Optical | NASA/JPL-Caltech/MSSS | NASA's Curiosity location map, `mars.nasa.gov/mmgis-maps/MSL/Layers/MSL_CTX_ortho_mosaic_6m/` |
| THEMIS night and day infrared mosaics (100 m per pixel) | Mars Odyssey, THEMIS | Thermal | NASA/JPL-Caltech/Arizona State University | NASA Mars Trek, `trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/` and `.../THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/` |
| Curiosity end-of-drive waypoints (position and elevation per sol) | Mars Science Laboratory (Curiosity) | Rover localisation | NASA/JPL-Caltech | `mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json`; a trimmed copy is in `data/msl_waypoints.json`, made by `tools/fetch_waypoints.py` |

## Space agency partner data and other references

_To be filled as each source is added._

## Software

| Item | Use | Licence | Link |
|---|---|---|---|
| Leaflet 1.9.4 | Map display | BSD 2-Clause (copy in `vendor/leaflet/LICENSE`) | https://leafletjs.com |

## Fonts

System fonts only. No font files are shipped.

## AI use

See the "Use of AI" section in [README.md](README.md).
