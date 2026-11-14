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
- [ ] Body-cost model: walking energy is in (source check pending); heat, radiation dose and the way back are not built yet
- [ ] Rover photos at the stops
- [ ] Demo walk stored in the repo

## Run it

It is a static page with no build step. Serve the folder with any web server:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Known limits

- The elevation used is the 4 m level of the 1 m terrain model. It agrees with Curiosity's own waypoint heights (median difference 0.16 m, largest 1.2 m over 140 waypoints), but it smooths features smaller than a few metres, so single boxwork ridges (1 to 2 m tall) read gentler than they are.

- The habitat position and the third stop are assumptions, marked on the map with a dashed amber ring. No landing site has been chosen in this area.
- Walking cost on slopes has only been measured at Earth gravity. The page applies one Mars-gravity factor at every slope and says so on screen.

## How the numbers are made

Every number on screen names its source. A value that is not measured or published is marked on screen as an assumption. The full list of datasets, papers, libraries and licences is in [CREDITS.md](CREDITS.md).

## Use of AI

The idea for this project is the team's own. The code in this repository was written with an AI coding assistant (Claude, by Anthropic) under the team's direction, and AI agents were used to find and check sources. Every science number was checked against its primary source before use. Any AI-generated image or video in the project carries a visible watermark, and any AI-generated audio is named in CREDITS.md.

## Licence

Code: MIT. Data and images keep the terms of their sources, listed in CREDITS.md.
