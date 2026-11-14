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
| Viking Orbiter global colour mosaic (MDIM 2.1, 232 m per pixel) | Viking Orbiters | Optical, global | NASA/JPL-Caltech/USGS | NASA Mars Trek, layer `Mars_Viking_MDIM21_ClrMosaic_global_232m`; zoom 2 copy in `tiles/global/` |
| MOLA colour shaded relief (463 m per pixel) and the MOLA 4 pixel per degree gridded topography (`megt90n000cb`) | Mars Global Surveyor, Mars Orbiter Laser Altimeter | Topographic, global | NASA/GSFC | Picture: NASA Mars Trek, layer `Mars_MGS_MOLA_ClrShade_merge_global_463m`. Numbers: NASA Planetary Data System, Geosciences Node; stored as `data/global/mola_4ppd.bin` by `tools/fetch_global.py` |
| THEMIS day infrared global mosaic (100 m per pixel) | Mars Odyssey, THEMIS | Thermal, global | NASA/JPL-Caltech/Arizona State University | NASA Mars Trek, layer `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018`; zoom 2 copy in `tiles/global/` |
| Orbiter and Sun positions as seen from the walk site, and the Earth to Mars light time, for 18 December 2025 (sol 4752) | NASA/JPL Horizons system (trajectories of Mars Reconnaissance Orbiter, Mars Odyssey, ExoMars Trace Gas Orbiter, Mars Express) | Orbit geometry | NASA/JPL-Caltech, Solar System Dynamics group. Trace Gas Orbiter and Mars Express are ESA spacecraft | `ssd.jpl.nasa.gov/api/horizons.api`; results in `data/comms/`, made by `tools/comms_fetch.py` and `tools/comms.mjs` |
| Curiosity end-of-drive waypoints (position and elevation per sol) | Mars Science Laboratory (Curiosity) | Rover localisation | NASA/JPL-Caltech | `mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json`; a trimmed copy is in `data/msl_waypoints.json`, made by `tools/fetch_waypoints.py` |

## Space agency partner data and other references

| Source | Used for | Status |
|---|---|---|
| Minetti AE, Moia C, Roi GS, Susta D, Ferretti G (2002). Energy cost of walking and running at extreme uphill and downhill slopes. J Appl Physiol 93:1039-1046. https://europepmc.org/article/MED/12183501 | Walking energy as a function of slope | Measured values confirmed from the abstract; the polynomial fit is taken from a paper that quotes it, because the full text could not be opened |
| Farley CT, McMahon TA (1992). Energetics of walking and running: insights from simulated reduced-gravity experiments. J Appl Physiol 73:2709-2712. https://europepmc.org/article/MED/1490989 | Scaling walking energy to Mars gravity | The 33% figure at 0.25 g confirmed from the abstract; the value for Mars (0.38 g) is our straight-line reading and is marked as an assumption |
| NASA (2020). Innovative Offloading of Astronauts for More Effective Exploration. https://www.nasa.gov/general/innovative-offloading-of-astronauts-for-more-effective-exploration/ | Apollo A7L-B suit and backpack mass, 212 lb | Read 14 Nov 2026 |
| NASA-STD-3001, NASA Spaceflight Human-System Standard, Volume 1 Rev C (crew health) and Volume 2 Rev F (human factors, habitability and environmental health) | Stored body heat limits [V2 11011], [V2 6014]; suited work range; career radiation limit [V1 4030]; 80 kg reference crew member | Read 14 Nov 2026 |
| Bue, Trevino, Tsioulos, Mitchell, Settles (2013). Hollow-Fiber Spacesuit Water Membrane Evaporator. NASA Tech Briefs, July 2013. NTRS 20130014146. https://ntrs.nasa.gov/citations/20130014146 | Suit cooling: 810 W in vacuum, 370 W in a Mars environment (prototype rating) | Read 14 Nov 2026 |
| Waligora and Horrigan. Metabolism and heat dissipation during Apollo EVA periods. In Biomedical Results of Apollo, NASA SP-368. NTRS 19760005584. https://ntrs.nasa.gov/citations/19760005584 | Backpack energy budget, 1800 kcal (Apollo 15 to 17) | Read 14 Nov 2026 |
| Guo J et al. (2015). Modeling the variations of dose rate measured by RAD during the first MSL Martian year: 2012-2014. arXiv:1507.03473. https://arxiv.org/abs/1507.03473 | Surface dose equivalent rate at Gale crater, about 0.7 mSv per day | Read 14 Nov 2026 |
| Guo J, Tian C, Charpentier G, et al. (2026). Influence of Mars Topography on Radiation Dose Detected by the Mars Science Laboratory and Assessment of Mars Surface Albedo Radiation. JGR Planets 131(4), e2026JE009704. Open copy (CC BY): https://elib.dlr.de/224554/ | Definition of sky blocked by terrain; Table 1, the eight places where Curiosity's RAD measured a dose drop, used to check our computation and to set the dose cut per point of sky blocked | Read 14 Nov 2026 |
| Guo J, et al. (2021). Directionality of the Martian Surface Radiation and Derivation of the Upward Albedo Radiation. Geophysical Research Letters 48(15), e2021GL093912 | Reference share of sky blocked (10%) | Abstract read 14 Nov 2026 |
| NASA Jet Propulsion Laboratory news, "NASA's Curiosity Mars Rover Starts Unpacking Boxwork Formations", 23 June 2025. https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-starts-unpacking-boxwork-formations/ | The Altadena drill stop | Read 14 Nov 2026 |

Space agency partner data: the ExoMars Trace Gas Orbiter and Mars Express are European Space Agency (ESA) missions; their trajectories are used for the comms shadow layer.

## Related work

Red Ledger is not the first tool to plan a walking route by what it costs the walker. It was written without using the code below, and it is named here so the difference is clear.

| Work | What it does | How Red Ledger differs |
|---|---|---|
| SEXTANT, the Surface Exploration Traverse Analysis and Navigation Tool (MIT; Johnson, Hoffman, Newman and others, from 2010), and its Python version Pextant, made for NASA's BASALT field campaign (Norheim 2018; code at https://github.com/norheim/pextant, MIT licence) | Plans a traverse over an elevation model and scores it by distance, time or the explorer's metabolic energy. A 2011 field evaluation found that real traverse time and energy were higher than the tool predicted | Red Ledger adds body heat stored against the suit's cooling limit in a Mars environment and against NASA's heat-storage standard, a radiation layer checked against Curiosity's measurements, a real Mars site with the rover's own path and photos, and a source link on every number. The finding of that 2011 evaluation applies to this model too: it has not been tested on people and may read low |

## Software

| Item | Use | Licence | Link |
|---|---|---|---|
| Leaflet 1.9.4 | Map display | BSD 2-Clause (copy in `vendor/leaflet/LICENSE`) | https://leafletjs.com |
| three.js r160 | The Mars globe | MIT (copy in `vendor/three/LICENSE`) | https://threejs.org |

## Fonts

System fonts only. No font files are shipped.

## AI use

See the "Use of AI" section in [README.md](README.md).
