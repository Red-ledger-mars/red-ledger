# Credits and sources

Every dataset, paper, library, image, sound and font used in Red Ledger, with its licence or usage terms. Updated as items are added.

## NASA data

| Layer or dataset | Mission and instrument | Data type | Credit | Where it is loaded from |
|---|---|---|---|---|
| HiRISE colour mosaic of Gale crater (about 0.3 m per pixel) | Mars Reconnaissance Orbiter, HiRISE camera | Optical | NASA/JPL-Caltech/University of Arizona | NASA's Curiosity location map, `mars.nasa.gov/mmgis-maps/MSL/Layers/MSL_Gale_HiRISE-LRGB_78quads/`; a copy of the walk area (zoom 13 to 16) is in `tiles/hirise/`, made by `tools/cache_tiles.py` |
| CTX orthomosaic of Gale crater (6 m per pixel) | Mars Reconnaissance Orbiter, Context Camera | Optical | NASA/JPL-Caltech/MSSS | NASA's Curiosity location map, `mars.nasa.gov/mmgis-maps/MSL/Layers/MSL_CTX_ortho_mosaic_6m/`; a copy of the walk area (zoom 10 to 13) is in `tiles/ctx/` |
| THEMIS night and day infrared mosaics (100 m per pixel) | Mars Odyssey, THEMIS | Thermal | NASA/JPL-Caltech/Arizona State University | NASA Mars Trek, `trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/` and `.../THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/` |
| MSL Gale Merged DEM, 1 m, version 3 (4 m overview level used) | Mars Reconnaissance Orbiter, HiRISE stereo pairs, merged by Parker and Calef | Topographic | NASA/JPL-Caltech/University of Arizona/USGS | USGS Astrogeology, `astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m`; the walk-area crop is in `data/dem_boxwork_4m.bin`, made by `tools/cut_dem.py`. The slope layer is computed from it in the page |
| Curiosity raw images at the walk stops (8 photos: Navcam sols 4558, 4789, 4893 and 4983; MAHLI sols 4570, 4789, 4893 and 4979). Unprocessed apart from resizing | Mars Science Laboratory (Curiosity), Navcam and MAHLI | Rover point-of-view images | Navcam: NASA/JPL-Caltech. MAHLI: NASA/JPL-Caltech/MSSS | `mars.nasa.gov/msl-raw-images/`; resized copies in `img/stops/`, with each source address in `data/photos.json` |
| Curiosity daily weather, sols 4540 to 4852 (air and ground temperature, pressure, UV class) | Mars Science Laboratory (Curiosity), REMS weather station | Atmospheric | NASA/JPL-Caltech/CAB (CSIC-INTA). The feed states it is provided by Centro de Astrobiologia for outreach purposes only; it is shown on the page as outreach data | `mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json`; a trimmed copy is in `data/rems_boxwork.json`, made by `tools/fetch_rems.py` |
| Viking Orbiter global colour mosaic (MDIM 2.1, 232 m per pixel) | Viking Orbiters | Optical, global | NASA/JPL-Caltech/USGS | NASA Mars Trek, layer `Mars_Viking_MDIM21_ClrMosaic_global_232m`; zoom 2 copy of the whole planet and zoom 3 copy around Gale crater in `tiles/global/` |
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
| NASA-STD-3001, NASA Spaceflight Human-System Standard, Volume 1 Rev C (crew health) and Volume 2 Rev F (human factors, habitability and environmental health) | Stored body heat limits [V2 11011], [V2 6014]; suited work range; career radiation limit [V1 4030]; the crew doctor's checks in the walk brief: [V1 6006], [V1 4002], [V2 11030], [V2 11037], [V2 11038], [V2 11039], [V2 6253]; 80 kg reference crew member | Read 14 Nov 2026 |
| NASA Office of the Chief Health and Medical Officer, NASA-STD-3001 technical briefs: Decompression Sickness Risk Mitigation (OCHMO-TB-037 Rev D), https://www.nasa.gov/sites/default/files/atoms/files/dcs_technical_brief_ochmo.pdf ; Water (OCHMO-TB-027 Rev B), https://www.nasa.gov/wp-content/uploads/2023/03/water-technical-brief-ochmo.pdf ; Lunar Dust (OCHMO-TB-011 Rev B), https://www.nasa.gov/wp-content/uploads/2023/03/lunar-dust-technical-brief-ochmo.pdf | Crew doctor's checks: prebreathe and [V2 6008], water lost, dust | Read 14 Nov 2026 |
| NASA (2020). Exploration EVA System Concept of Operations, EVA-EXP-0042 Rev B. https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf | Crew doctor's checks: walk-back distance (sections 9.6, 4.2.1.3.1) and loss of communication (section 9.5). Written for Moon walks | Read 14 Nov 2026 |
| Dunn, Benson, Norcross, Newby (2021). Evidence Report: Risk of Injury and Compromised Performance due to EVA Operations. NASA Human Research Program. NTRS 20220004017. https://ntrs.nasa.gov/citations/20220004017 | Crew doctor's checks: hand, fingernail and shoulder injuries | Read 14 Nov 2026 |
| NASA NTRS 20210024317. Extravehicular Activity Metabolic Rate Model: Metabolic Rate Estimated from Heart Rate. https://ntrs.nasa.gov/citations/20210024317 | Crew doctor's checks: work rate from heart rate | Read 14 Nov 2026 |
| NASA Space Radiation Analysis Group. How do we protect the astronauts from space radiation? https://srag.jsc.nasa.gov/spaceradiation/how/how.cfm | Crew doctor's checks: crew active dosimeters | Read 14 Nov 2026 |
| Bue, Trevino, Tsioulos, Mitchell, Settles (2013). Hollow-Fiber Spacesuit Water Membrane Evaporator. NASA Tech Briefs, July 2013. NTRS 20130014146. https://ntrs.nasa.gov/citations/20130014146 | Suit cooling: 810 W in vacuum, 370 W in a Mars environment (prototype rating) | Read 14 Nov 2026 |
| Waligora and Horrigan. Metabolism and heat dissipation during Apollo EVA periods. In Biomedical Results of Apollo, NASA SP-368. NTRS 19760005584. https://ntrs.nasa.gov/citations/19760005584 | Backpack energy budget, 1800 kcal (Apollo 15 to 17) | Read 14 Nov 2026 |
| Guo J et al. (2015). Modeling the variations of dose rate measured by RAD during the first MSL Martian year: 2012-2014. arXiv:1507.03473. https://arxiv.org/abs/1507.03473 | Surface dose equivalent rate at Gale crater, about 0.7 mSv per day | Read 14 Nov 2026 |
| Guo J, Tian C, Charpentier G, et al. (2026). Influence of Mars Topography on Radiation Dose Detected by the Mars Science Laboratory and Assessment of Mars Surface Albedo Radiation. JGR Planets 131(4), e2026JE009704. Open copy (CC BY): https://elib.dlr.de/224554/ | Definition of sky blocked by terrain; Table 1, the eight measurement periods, at five places, where Curiosity's RAD measured a dose drop, used to check our computation and to set the dose cut per point of sky blocked | Read 14 Nov 2026 |
| Guo J, et al. (2021). Directionality of the Martian Surface Radiation and Derivation of the Upward Albedo Radiation. Geophysical Research Letters 48(15), e2021GL093912 | Reference share of sky blocked (10%) | Abstract read 14 Nov 2026 |
| Allison M, McEwen M (2000). A post-Pathfinder evaluation of areocentric solar coordinates with improved timing recipes for Mars seasonal/diurnal climate studies. Planetary and Space Science 48:215-235 (the Mars24 algorithm) | Local solar time on Mars for the comms shadow | Formulas used as published |
| Xu, Rioux and Castellani (2022), on the specific heat of the human body. Temperature (Austin). https://pmc.ncbi.nlm.nih.gov/articles/PMC10274559/ | Note that the conventional body specific heat (3.47 kJ/kg/°C) was never directly measured; the page marks the temperature figure as an assumption | Read 14 Nov 2026 |
| NASA, Communication Delays, Disruptions, and Blackouts for Crewed Mars Missions (ASCEND 2022). https://ntrs.nasa.gov/api/citations/20220013418/downloads/ASCEND-Communication%20Delays%2C%20Disruptions%2C%20and%20Blackouts%20for%20Crewed%20Mars%20Missions.pdf | One-way signal delay to Mars of up to about 22 minutes | Checked in pre-event research, 7 Nov 2026 |
| Vos, Gernhardt, Lee (2007). The Walkback Test: A Study to Evaluate Suit and Life Support System Performance Requirements for a 10 Kilometer Traverse in a Planetary Suit. NTRS 20070016007. https://ntrs.nasa.gov/citations/20070016007 ; Norcross et al. (2008), Feasibility of Suited 10-km Ambulation "Walkback" on the Moon, NTRS 20080014853 | Measured metabolic rates of suited and unsuited walking at lunar and Mars gravity; used to test and correct the body model | Read 14 Nov 2026; values in `data/validation/human_walking.json` |
| Norcross et al. (2010). Metabolic Costs and Biomechanics of Inclined Ambulation and Exploration Tasks in a Planetary Suit. NASA/TP-2010-216125. https://ntrs.nasa.gov/citations/20110003409 ; Norcross et al. (2009), Metabolic and Subjective Results Review of the Integrated Suit Test Series, JSC-17770, NTRS 20090007828; Gernhardt, Norcross, Vos (2008), Integrated Suit Test 1, NTRS 20080013604 | Measured metabolic rates of suited walking on slopes of 10 to 30% at 0.12 to 0.32 of Earth gravity; used to test the revised slope term | Read 14 Nov 2026; values read from the reports' plotted lines |
| NASA, Curiosity mission updates (science.nasa.gov/blog): "Sols 4709-4715: Drilling High and Low in the Boxwork Unit", https://science.nasa.gov/blog/curiosity-blog-sols-4709-4715-drilling-high-and-low-in-the-boxwork-unit/ ; "Sols 4900-4907: Pasadena, We Have a Drill Sample", https://science.nasa.gov/blog/curiosity-blog-sols-4900-4907-pasadena-we-have-a-drill-sample/ ; "Sols 4975-4981: Happy 14th Landing Anniversary", https://science.nasa.gov/blog/curiosity-blog-sols-4975-4981-happy-14th-landing-anniversary/ ; with the updates for sols 4689-4694, 4695-4701, 4867-4872 and 4886-4892 | What Curiosity did at the stops of the ready-made walks (`data/walks.json`, `data/walk.json`): the Valle de la Luna and Nevado Sajama drill holes, the Atacama and Campo Marte drill sites, the layer contact | Read 14 Nov 2026 by one agent and rechecked by a second |
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
| three.js r160 | The Mars globe and the 3D view of the walk | MIT (copy in `vendor/three/LICENSE`) | https://threejs.org |

## Fonts

Four typefaces are shipped in `fonts/`, each under the SIL Open Font License 1.1, with a copy of its licence beside it. They were downloaded from Google Fonts; the pages load nothing from Google when they run. The classic map page uses system fonts.

| Typeface | Use | Copyright | Licence |
|---|---|---|---|
| Barlow Condensed 700 | Headings and large numbers in the story | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) | SIL OFL 1.1, `fonts/OFL-barlowcondensed.txt` |
| Inter (variable) | Body text and small labels in the story | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) | SIL OFL 1.1, `fonts/OFL-inter.txt` |
| Michroma 400 | The RED LEDGER mark only | Copyright 2011 The Michroma Project Authors (https://github.com/googlefonts/Michroma-font) | SIL OFL 1.1, `fonts/OFL-michroma.txt` |
| Instrument Serif Italic | Accent words and the mark in the story's Editorial style (`?theme=editorial`) | Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif) | SIL OFL 1.1, `fonts/OFL-instrumentserif.txt` |

## Instruction files given to the AI assistant

These are written instructions ("skills") that the AI coding assistant was given while the project was built. None of their text, code or images is part of the product; they are listed so that everything used is named.

| Item | Use | Author and source | Licence |
|---|---|---|---|
| better-ui | Checks of spacing, surfaces, icons and motion in the interface | Jakub Krehel, https://github.com/jakubkrehel/skills, through https://github.com/23jmo/jmo-skills | MIT |
| animate | Decisions on motion: what moves, how long, which easing | Emil Kowalski, https://github.com/emilkowalski/skills, through https://github.com/23jmo/jmo-skills | MIT |
| ste | Plain technical English in the text | Johnathan Mo, https://github.com/23jmo/jmo-skills | MIT |
| interview | Questions to the builder before the redesign | Johnathan Mo, https://github.com/23jmo/jmo-skills | MIT |
| unslop | Review of the interface for an AI-generated look | Damir Sokolovsky (@heydamir), https://github.com/heydamir/unslop | CC BY 4.0 |

## AI-made images

| Item | Use | How it was made | Label on screen |
|---|---|---|---|
| `img/walker.png`, an astronaut walk-cycle strip of ten frames (800 x 80 pixels) | The walker figure in the 3D view | Drawn by a program that an AI agent wrote, at the team's request. It shows no real person and no agency mark | The 3D view's credit line reads "Walker figure made with AI" whenever the figure is shown |

## AI use

See the "Use of AI" section in [README.md](README.md).
