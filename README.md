# Red Ledger

**Every Mars map shows where things are. This one shows what each step costs a human body.**

Red Ledger is a helmet display for a single Marswalk at Gale crater (Mount Sharp), the region the Curiosity rover has explored since 2012. It layers data from several NASA missions at the scale of one excursion and prices each walking route in four things: energy burned, heat against the suit's cooling limit, radiation dose, and whether there is enough left to walk back.

Built for the NASA Space Apps Challenge 2026, challenge "Interplanetary Survival Guide: Martian Map", by team Red Ledger (Raipur local event). All work started after the hackathon opened on 14 November 2026, 11:00 IST.

Made with NASA open data. This project is not endorsed by NASA.

## Status

Work in progress. This section is updated as parts are finished.

- [x] Page and helmet display layout
- [x] NASA map layers: HiRISE colour, CTX, THEMIS day and night infrared, Curiosity's path
- [x] Elevation crop of the walk area (4 m) and a slope layer computed from it
- [x] A walk with a habitat and three stops, and two routes for it: the shortest, and the one with the least walking energy
- [x] Elevation profile and a walk control that moves along the route
- [x] Body-cost model: energy burned, body heat stored against NASA's limit, radiation dose, and energy left to walk home, all updating along the route
- [x] Curiosity's own photos at the two stops it visited
- [x] Demo copy in the repo: elevation, waypoints, photos, weather and the walk-area imagery (zoom 13 to 16), so the walk still shows if NASA's servers cannot be reached
- [x] Curiosity's measured temperature and pressure range for the site

- [x] Heat decides the walk: with a 30 kg load the direct route passes NASA's stored-heat limit (3.7 against 3.0 kJ/kg), so the plan adds a 7 minute rest and the route takes 56 minutes; the body-cost route needs no rest and takes 45
- [x] Radiation layer: how much sky the terrain blocks, computed with the method of the Curiosity RAD team and checked against the eight places where the rover measured a dose drop (6 of 8 within 1 percentage point; shown in the page under "Check vs RAD")
- [x] A whole-Mars globe (`globe.html`): the surveyed patch is ringed and opens the walk; any other point shows its coordinates and MOLA elevation and is labelled as not yet surveyed at walk scale

Keys on the walk page: Space plays or pauses the walk, D and B choose the direct or the body-cost route, 1 to 5 choose the overlay, L changes the carried load, R switches the clean screen for filming on and off, P plays a fixed sequence (Escape stops it). Opening `globe.html?rec` plays everything in one take, from the whole planet to the end of the walk.

## Run it

It is a static page with no build step. Serve the folder with any web server:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765 for the walk, or http://localhost:8765/globe.html for the globe.

## Known limits

- The elevation used is the 4 m level of the 1 m terrain model. It agrees with Curiosity's own waypoint heights (median difference 0.16 m, largest 1.2 m over 140 waypoints), but it smooths features smaller than a few metres, so single boxwork ridges (1 to 2 m tall) read gentler than they are.

- The habitat position and the third stop are assumptions, marked on the map with a dashed amber ring. No landing site has been chosen in this area.
- Walking cost on slopes has only been measured at Earth gravity. The page applies one Mars-gravity factor at every slope and says so on screen.
- The sky-blocked map uses a 4 m elevation grid; the published values used 1 m. In narrow valleys ours reads low (9 points low at Maria Gordon Notch). The check covers the terrain computation only, not the dose model.
- The dose is cut by 1% for each extra percentage point of sky blocked. That rate is read from the eight published measurements (which range from 0.7 to 1.5) and is marked as an assumption.
- The suit is modelled as removing 370 W of heat and nothing more. That figure is a prototype evaporator rating in a Mars environment, not a flight suit value.
- Time spent working at the stops is not counted, only walking.

- The model has not been tested on people. An earlier route planner of this kind (MIT's SEXTANT) was found in a field test to predict less time and energy than explorers actually used; the same may be true here. See "Related work" in [CREDITS.md](CREDITS.md).

## How the numbers are made

Every number on screen names its source. A value that is not measured or published is marked on screen as an assumption. The whole body model is in one file, [`js/body.js`](js/body.js), with each constant, its source and how far it was confirmed, so it can be checked or reused on its own.

For each step of a route the model takes the slope from the elevation grid and computes:

1. **Energy**: the cost of walking at that slope (Minetti et al. 2002), scaled to Mars gravity (Farley and McMahon 1992), for an 80 kg walker in a 96 kg suit (the Apollo A7L-B suit and backpack).
2. **Pace**: 1.0 m/s, slowed on climbs so the work rate stays at or under 617 W, the top of NASA's design range for suited work.
3. **Heat**: metabolic power, less the part stored as height on a climb, plus the part given back on a descent. The suit removes up to 370 W. Heat above that is stored in the body and compared with NASA's 3.0 kJ/kg limit.
4. **Radiation**: time on the route times the surface dose rate measured by Curiosity's RAD detector (about 0.7 mSv per day), reduced where the terrain blocks more of the sky.
5. **Load and rest**: the planner can give the walker a carried load (none, 15 kg or 30 kg; our settings, marked as an assumption). When stored heat reaches 90% of NASA's limit the plan makes the walker stand still until it falls to 50%; a resting walker works at 147 W, the bottom of NASA's suited range. The page shows both the time with rests and the heat the route would cause with none.
6. **Way back**: at every point, the energy budget (1800 kcal, the Apollo 15 to 17 backpack) less what has been used and less the cheapest way home from there. The full list of datasets, papers, libraries and licences is in [CREDITS.md](CREDITS.md).

## Use of AI

The idea for this project is the team's own. The code in this repository was written with an AI coding assistant (Claude, by Anthropic) under the team's direction, and AI agents were used to find and check sources. Every science number was checked against its primary source before use. Any AI-generated image or video in the project carries a visible watermark, and any AI-generated audio is named in CREDITS.md.

## Licence

Code: MIT. Data and images keep the terms of their sources, listed in CREDITS.md.
