# Credits and sources

Every dataset, paper, library, image, sound and font used in Red Ledger, with its licence or usage terms. Updated as items are added.

## NASA data

| Layer or dataset | Mission and instrument | Data type | Credit | Where it is loaded from |
|---|---|---|---|---|
| HiRISE colour mosaic of Gale crater (about 0.3 m per pixel) | Mars Reconnaissance Orbiter, HiRISE camera | Optical | NASA/JPL-Caltech/University of Arizona | NASA's Curiosity location map, `mars.nasa.gov/mmgis-maps/MSL/Layers/MSL_Gale_HiRISE-LRGB_78quads/`; a copy of the walk area (zoom 13 to 16) is in `tiles/hirise/`, made by `tools/cache_tiles.py` |
| CTX orthomosaic of Gale crater (6 m per pixel) | Mars Reconnaissance Orbiter, Context Camera | Optical | NASA/JPL-Caltech/MSSS | NASA's Curiosity location map, `mars.nasa.gov/mmgis-maps/MSL/Layers/MSL_CTX_ortho_mosaic_6m/`; a copy of the walk area (zoom 10 to 13) is in `tiles/ctx/` |
| THEMIS night and day infrared mosaics (100 m per pixel) | Mars Odyssey, THEMIS | Thermal | NASA/JPL-Caltech/Arizona State University | NASA Mars Trek, `trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/` and `.../THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/` |
| MSL Gale Merged DEM, 1 m, version 3 (4 m overview level used) | Mars Reconnaissance Orbiter, HiRISE stereo pairs, merged by Parker and Calef | Topographic | NASA/JPL-Caltech/University of Arizona/USGS | USGS Astrogeology, `astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m`; the walk-area crop is in `data/dem_boxwork_4m.bin`, made by `tools/cut_dem.py`. The slope layer is computed from it in the page |
| Curiosity raw images at the walk stops (4 photos: Navcam sols 4558 and 4789, MAHLI sols 4570 and 4789) | Mars Science Laboratory (Curiosity), Navcam and MAHLI | Rover point-of-view images | Navcam: NASA/JPL-Caltech. MAHLI: NASA/JPL-Caltech/MSSS | `mars.nasa.gov/msl-raw-images/`; resized copies in `img/stops/`, with each source address in `data/photos.json` |
| Curiosity daily weather, sols 4540 to 4852 (air and ground temperature, pressure, UV class) | Mars Science Laboratory (Curiosity), REMS weather station | Atmospheric | NASA/JPL-Caltech/CAB (CSIC-INTA). The feed states it is provided by Centro de Astrobiologia for outreach purposes only; it is shown on the page as outreach data | `mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json`; a trimmed copy is in `data/rems_boxwork.json`, made by `tools/fetch_rems.py` |
| Curiosity end-of-drive waypoints (position and elevation per sol) | Mars Science Laboratory (Curiosity) | Rover localisation | NASA/JPL-Caltech | `mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json`; a trimmed copy is in `data/msl_waypoints.json`, made by `tools/fetch_waypoints.py` |

## Space agency partner data and other references

| Source | Used for | Status |
|---|---|---|
| Minetti AE, Moia C, Roi GS, Susta D, Ferretti G (2002). Energy cost of walking and running at extreme uphill and downhill slopes. J Appl Physiol 93:1039-1046. https://europepmc.org/article/MED/12183501 | Walking energy as a function of slope | In use; values are being re-checked against the paper and are marked as assumptions on screen until then |
| Farley CT, McMahon TA (1992). Energetics of walking and running: insights from simulated reduced-gravity experiments. J Appl Physiol 73:2709-2712. https://europepmc.org/article/MED/1490989 | Scaling walking energy to Mars gravity | In use; same status |
| NASA Jet Propulsion Laboratory news, "NASA's Curiosity Mars Rover Starts Unpacking Boxwork Formations", 23 June 2025. https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-starts-unpacking-boxwork-formations/ | The Altadena drill stop | Read 14 Nov 2026 |

## Software

| Item | Use | Licence | Link |
|---|---|---|---|
| Leaflet 1.9.4 | Map display | BSD 2-Clause (copy in `vendor/leaflet/LICENSE`) | https://leafletjs.com |

## Fonts

System fonts only. No font files are shipped.

## AI use

See the "Use of AI" section in [README.md](README.md).
