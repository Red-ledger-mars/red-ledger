# Red Ledger

**Every Mars map shows where things are. This one shows what each step costs a human body.**

**Try it:** https://red-ledger-mars.github.io/red-ledger/ opens on Mars. At Gale crater choose the story (https://red-ledger-mars.github.io/red-ledger/story.html) or the map tool (https://red-ledger-mars.github.io/red-ledger/classic.html). Every page is listed at https://red-ledger-mars.github.io/red-ledger/links.html. Nothing to install.

Red Ledger is a helmet display for a single Marswalk at Gale crater (Mount Sharp), the region the Curiosity rover has explored since 2012. It layers data from several NASA missions at the scale of one excursion and prices each walking route in four things: energy burned, heat against the suit's cooling limit, radiation dose, and whether there is enough left to walk back.

Built for the NASA Space Apps Challenge 2026, challenge "Interplanetary Survival Guide: Martian Map", by team Red Ledger (Raipur local event). All work started after the hackathon opened on 14 November 2026, 11:00 IST.

Made with NASA open data. This project is not endorsed by NASA.

## How it answers the challenge

| The challenge asks for | Red Ledger |
|---|---|
| A hyper-local view for one walk; regional tools such as JPL Mars Trek and the USGS-NASA maps stop at region scale | One patch, 1.5 by 1.9 km, at 4 m per cell: the boxwork ridges on Mount Sharp, NASA's own example. It uses Mars Trek tiles and the USGS Gale elevation model and works at the scale of one excursion |
| Data from several NASA missions | Five: Mars Reconnaissance Orbiter (HiRISE and CTX imagery, the elevation model), Mars Odyssey (THEMIS), Curiosity (RAD, REMS, cameras, its path), Mars Global Surveyor (MOLA) and the Viking Orbiters, with orbiter positions from NASA/JPL Horizons |
| At least three kinds of data | Seven: optical, thermal, topographic, radiation, atmospheric, rover photos, orbit geometry |
| A science goal | Four ready-made walks to places where Curiosity worked, each with its goal, and a walk the visitor places |
| Safety first: radiation, and the limits a suit and a load put on mobility | Stored body heat against NASA's limit, the rests it forces, the load carried, radiation dose with terrain shielding, energy left to walk home, radio contact with relay orbiters |
| A route that avoids major obstacles | Two routes for every walk. The body-cost route takes no ground steeper than 24 degrees, the steepest slope walking cost has been measured on. Rocks and ridges smaller than the 4 m grid are not seen |
| Rover point-of-view images | Curiosity's Navcam and MAHLI photos at four stops |

## What only Red Ledger does

1. **Body heat decides the walk.** Stored body heat against NASA's limit of 3.0 kJ/kg sets the rests and the route. Carrying 30 kg on the ridge and hollow survey, the body-cost route is 100 m longer, needs one rest fewer and is home 8 minutes sooner.
2. **The body model was tested against NASA's measurements of people, with the rule committed first.** It failed, was corrected, and every heat number shows its range (see "The test against NASA's measurements of people" below).
3. **The suit decides more than the route.** A slider sets the suit's cooling and prices the walk again: the climb to the layer contact needs 3 rests at 370 W, 1 at 450 W and none at 550 W.
4. **Radio contact is tied to the walk.** The terrain's comms shadow comes from real orbiter positions for one sol, and a walk slowed by its rests can outlast an orbiter pass.

## What is in it

This list grew as parts were finished.

- [x] Page and helmet display layout
- [x] NASA map layers: HiRISE colour, CTX, THEMIS day and night infrared, Curiosity's path
- [x] Elevation crop of the walk area (4 m) and a slope layer computed from it
- [x] A walk with a habitat and three stops, and two routes for it: the shortest, and the one with the least walking energy
- [x] Elevation profile and a walk control that moves along the route
- [x] Body-cost model: energy burned, body heat stored against NASA's limit, radiation dose, and energy left to walk home, all updating along the route
- [x] Demo copy in the repo: elevation, waypoints, photos, weather and the walk-area imagery (zoom 13 to 16), so the walk still shows if NASA's servers cannot be reached
- [x] Curiosity's measured temperature and pressure range for the site

- [x] The body model tested against NASA's measurements of people. Its method and pass rule were committed before the data was collected; it failed, and was revised (see "The test against NASA's measurements of people" below)
- [x] Heat decides the walk: at 1.0 m/s on flat ground a suited walker makes 436 W of heat against 370 W of suit cooling, so heat builds up even with no slope. With a 30 kg load the direct route would reach 5.6 kJ/kg of stored heat against NASA's limit of 3.0; the plan adds three rests and the route takes 65 minutes. The body-cost route needs two rests and takes 57. To walk either with no rest, a suit would have to remove 451 W or 432 W
- [x] Comms shadow: when a relay orbiter (MRO, Mars Odyssey, Trace Gas Orbiter, Mars Express) is above the terrain as seen by the walker, from NASA/JPL Horizons orbit data for sol 4752, with a start-time choice and the share of each route in contact. A second computation from spacecraft position vectors, with separate code (`tools/check_comms_passes.py`), found the same 13 passes with rise and set times within 1 minute; the record is in `data/comms/check_passes.json`
- [x] Walk brief: for the chosen route, load and start time the page writes what to expect before, during and after the walk (where the pace must drop, where heat nears the limit, where to rest, where the radio link is lost), and lists what it cannot forecast
- [x] Crew doctor's checks in the walk brief: 13 checks that NASA publishes for a spacewalk (clearance, fitness, prebreathe, water, body heat, work rate, carbon dioxide, distance from shelter, loss of radio, hands and shoulders, water lost, dosimeter, dust), each with NASA's value and its source. Beside each one the page sets its own forecast for this route, or says that it has none
- [x] Forecast file: the expected pace, work rate, stored heat, dose and orbiter contact at every point of a route, as JSON or CSV, for an onboard system to compare with what a suit measures
- [x] Free walk: steer the walker over the terrain with the arrow keys; the same body model runs on the ground you choose, refuses slopes no walking study covers, and forces a rest when stored heat nears the limit
- [x] Four ready-made walks to places where Curiosity worked, each with its science goal (`data/walks.json`): the ridge and hollow survey, a first sample run to Altadena, the sulfate rock above the boxwork at the Campo Marte drill site, and a climb to a contact between two rock layers. Every stop but one is a place where the rover worked. They run from 0.34 km and 6 minutes to 3.06 km, 76 minutes and three rests with a 30 kg load
- [x] What decides the walk: each walk priced again for suits that remove 300 to 550 W (`tools/sensitivity.mjs`, shown in the test sheet). Carrying 30 kg, the climb to the layer contact needs 6 rests at 300 W, 3 at the model's 370 W, 1 at 450 W and none at 550 W; the choice of route changes the count by one rest at most
- [x] Suit-cooling slider: drag the heat the suit can remove from 300 to 600 W and the routes on screen are priced again at once, with their rests, times and heat. It asks the question the result points to: how many watts must a Mars suit remove?
- [x] Curiosity's own photos at four stops: a Navcam view of the ground and a MAHLI view of the rock at each
- [x] Plan your own walk: place up to four stops anywhere on the surveyed patch and the page plans both routes there and back, with the rests, the heat, the cooling a suit would need and the orbiter contact. The search runs in the page (about one to two seconds) with the same route code and body model as the stored walk
- [x] Body-reach layer: for every 4 m cell of the patch and each load, the rests the plan adds to walk from the habitat to that point and back by the body-cost route (`data/reach/`, made by `tools/reach.mjs`). With no load a walker can go 630 to 1,140 m from the habitat, depending on the ground, and return with no rest; with 30 kg, 490 to 700 m. A second agent checked the layer against the route planner on 75 walks: the rests agreed on every one, and stored heat and time differ only by rounding
- [x] 3D view of the walk on the real terrain (HiRISE imagery over the 4 m elevation model); pressing Walk switches to it and follows the walker
- [x] Radiation layer: how much sky the terrain blocks, computed with the method of the Curiosity RAD team and checked against the eight measurement periods, at five places, where the rover measured a dose drop (6 of 8 within 1 percentage point; the other two are 3 and 9 points off; shown in the page under "How we tested it")
- [x] A story of the walk (`story.html`, and `full.html` with more detail): the two routes drawn in body heat on the 3D ground, the reach of a body, the test against NASA's measurements, and a comparison that follows the load and the start time
- [x] A whole-Mars globe (`index.html`, the front page): the surveyed patch is ringed and opens the story or the map tool; any other point shows its coordinates and MOLA elevation and is labelled as not yet surveyed at walk scale

Keys on the map tool (`classic.html`): Space plays or pauses the walk, D and B choose the direct or the body-cost route, 1 to 7 choose the overlay, L changes the carried load, V switches between the map and the 3D view, O starts or leaves a walk of your own, R switches the clean screen for filming on and off, P plays a fixed sequence of about 16 seconds and Shift+P a longer one of about 50 seconds (Escape stops either). Opening `index.html?rec` plays everything in one take, from the whole planet to the end of the short sequence.

## Run it

It is a static page with no build step. Any web server works; this one also stops the browser from keeping old copies while files change:

```bash
python3 tools/serve.py
```

Then open http://localhost:8765 for the globe, http://localhost:8765/story.html for the story, or http://localhost:8765/classic.html for the map tool.

## The test against NASA's measurements of people

The body model predicts how hard a suited walker works from the slope, the gravity, the mass moved and the speed. NASA has measured exactly that on people: the Walkback Test and the Integrated Suit Tests put subjects in the Mark III suit on a treadmill, partly lifted to simulate lunar and Mars gravity, on the level and on slopes up to 30%.

1. **The rule came first.** Commit `ea6f315` fixed the prediction formula and the pass mark (measurements within 15% of the model) before any measurement was collected. Commit `b6f9b1d` holds the result.
2. **The data.** One agent transcribed 40 measurements (19 of people in the suit, 21 of the same kind of test without it) from five NASA reports into [`data/validation/human_walking.json`](data/validation/human_walking.json), with page and figure for each. A second agent reopened the reports and checked all 40; it found no mismatch. Only one value comes from a table; the rest were read from the reports' plotted lines.
3. **The model failed on level ground.** Suited people used 36% more energy than predicted (median of seven; from +8% to +66%). By the rule, the level cost is now multiplied by 1.364, and the spread (1.155 to 1.637) is carried as the uncertainty of every heat number.
4. **It failed on slopes in the other direction.** The first model scaled the whole cost by one gravity factor and predicted up to 2.2 times the measured cost of a climb. Climbing is work against weight, so the slope part of the cost is now scaled by gravity itself.
5. **The revised model against the sloped measurements**, which played no part in setting the correction: all twelve lie within 14%, median +3%. This revision was made after seeing them, so it shows consistency, not a blind prediction.

Limits of the test: the sloped walking speed is known only as a range; none of the sloped tests was at Mars gravity; the two level tests at Mars gravity read higher than the corrected model (by 10% and 22%); the reports' authors say the rig probably helped the subjects on slopes. Run it with `node tools/test_body_model.mjs` and `node tools/test_body_model_slopes.mjs`.

## What this is for

Tools that watch a crew member's body during a spacewalk assume someone on Earth is reading the screen. On Mars a signal takes up to about 22 minutes each way (NASA), so the answer to a question can take over 40 minutes; on the sol used here it was 20.1 minutes each way (NASA/JPL Horizons). Parts of a route also have no relay orbiter in view. A system on board cannot tell hard ground from a body in trouble unless it knows what that stretch of ground should cost. Red Ledger produces that expectation from the terrain, before the walk: per point of the route, the pace, work rate and stored heat a healthy walker would show. It is a planning aid. It does not diagnose anything and has not been tested on people.

## Known limits

- The elevation used is the 4 m level of the 1 m terrain model. It agrees with Curiosity's own waypoint heights (median difference 0.16 m, largest 1.2 m over 140 waypoints), but it smooths features smaller than a few metres, so single boxwork ridges (1 to 2 m tall) read gentler than they are.

- The habitat position and the third stop are assumptions, marked on the map with a dashed amber ring. No landing site has been chosen in this area.
- The body model is corrected from measurements on people in one suit (the Mark III, 121 kg) at lunar and Mars gravity; the walker here wears a 96 kg suit. The heat numbers carry a wide range for that reason: for the direct route with 30 kg, 3.8 to 7.7 kJ/kg.
- Whether a route passes the heat limit depends on the suit's cooling. 370 W is a prototype rating; the page therefore also gives the cooling each route would need.
- The sky-blocked map uses a 4 m elevation grid; the published values used 1 m. In narrow valleys ours reads low (9 points low at Maria Gordon Notch). The check covers the terrain computation only, not the dose model.
- The dose is cut by 1% for each extra percentage point of sky blocked. That rate is read from the eight published measurements (which range from 0.7 to 1.5) and is marked as an assumption.
- The suit is modelled as removing 370 W of heat and nothing more. That figure is a prototype evaporator rating in a Mars environment, not a flight suit value.
- Time spent working at the stops is not counted, only walking.

- Comms shadow is line of sight only, for one sol (18 December 2025). Real relay sessions are scheduled and need link margin. The elevation model ends 14 to 17 km east and west of the site, so low passes may be blocked more than shown. MAVEN is left out because NASA lost contact with it on 6 December 2025.
- The 3D view uses every second elevation cell (8 m), so it is a picture of the ground, not a measurement tool; numbers come from the 4 m grid.
- The energy model has been tested against NASA's treadmill measurements of people, but not on people walking this terrain, and the heat forecast has not been tested on people at all. An earlier route planner of this kind (MIT's SEXTANT) was found in a field test to predict less time and energy than explorers actually used; the same may be true here. See "Related work" in [CREDITS.md](CREDITS.md).

## How the numbers are made

Every number on screen names its source. A value that is not measured or published is marked on screen as an assumption. The whole body model is in one file, [`js/body.js`](js/body.js), with each constant, its source and how far it was confirmed, so it can be checked or reused on its own.

For each step of a route the model takes the slope from the elevation grid and computes:

1. **Energy**: the cost of walking on the level (Minetti et al. 2002), scaled to Mars gravity (Farley and McMahon 1992) and multiplied by 1.364 for the suit (from the test against NASA's measurements), plus the extra cost of the slope scaled by gravity, for an 80 kg walker in a 96 kg suit (the Apollo A7L-B suit and backpack).
2. **Pace**: 1.0 m/s, slowed on climbs so the work rate stays at or under 617 W, the top of NASA's design range for suited work.
3. **Heat**: metabolic power, less the part stored as height on a climb, plus the part given back on a descent. The suit removes up to 370 W. Heat above that is stored in the body and compared with NASA's 3.0 kJ/kg limit.
4. **Radiation**: time on the route times the surface dose rate measured by Curiosity's RAD detector (about 0.7 mSv per day), reduced where the terrain blocks more of the sky.
5. **Load and rest**: the planner can give the walker a carried load (none, 15 kg or 30 kg; our settings, marked as an assumption). When stored heat reaches 90% of NASA's limit the plan makes the walker stand still until it falls to 50%; a resting walker works at 147 W, the bottom of NASA's suited range. The page shows both the time with rests and the heat the route would cause with none.
6. **Way back**: at every point, the energy budget (1800 kcal, the Apollo 15 to 17 backpack) less what has been used and less the cheapest way home from there. The full list of datasets, papers, libraries and licences is in [CREDITS.md](CREDITS.md).

## Use of AI

The idea for this project is the team's own. The code in this repository was written with an AI coding assistant (Claude, by Anthropic) under the team's direction. AI agents also downloaded and cropped the NASA data, read the 40 measurements from NASA's reports and rechecked them, searched for the published limits, and drafted this README, CREDITS.md and the project page text, which the team reviewed. Each science number was checked against its source by a separate agent; where only an abstract or a second-hand quotation could be read, or a value is our own reading, CREDITS.md and the page say so. One image in the project is AI-made: the walker figure in the 3D view (`img/walker.png`), drawn by a program that an AI agent wrote. The 3D view says so on screen whenever the figure is shown, and CREDITS.md lists it. Any other AI-generated image or video would carry a visible watermark, and any AI-generated audio is named in CREDITS.md.

## Licence

Code: MIT. Data and images keep the terms of their sources, listed in CREDITS.md.
