# Global data for globe.html

| File | What it is | Source | Credit | Size |
|---|---|---|---|---|
| `mola_4ppd.bin` | Mars elevation grid, 1440 x 720 cells (4 per degree), int16 little-endian, metres relative to the areoid. Row 0 starts at 90 N, column 0 starts at 0 E, east positive. Converted from the big-endian original. | https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/megt90n000cb.img | MOLA, Mars Global Surveyor, NASA/GSFC (NASA PDS Geosciences Node) | 2.07 MB |
| `mola_4ppd.json` | Layout, unit and source of the grid. | same | same | under 1 KB |
| `patches.json` | Patches surveyed at walk scale. The globe reads this list. | Red Ledger | n/a | under 1 KB |

Textures are in `tiles/global/<layer>/2/<row>/<col>.<ext>` (8 x 4 tiles of 256 px per layer), from NASA Mars Trek, `https://trek.nasa.gov/tiles/Mars/EQ/{LAYER}/1.0.0/default/default028mm/{z}/{row}/{col}.{ext}`:

| Folder | Trek layer | Credit | Size |
|---|---|---|---|
| `viking` | Mars_Viking_MDIM21_ClrMosaic_global_232m | Viking Orbiter mosaic, NASA/JPL-Caltech/USGS | 1.8 MB |
| `mola` | Mars_MGS_MOLA_ClrShade_merge_global_463m | MOLA, Mars Global Surveyor, NASA/GSFC | 2.0 MB |
| `themis` | THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018 (65 S to 65 N only) | THEMIS, Mars Odyssey, NASA/JPL-Caltech/Arizona State University | 1.5 MB |

Rebuild everything with `python3 tools/fetch_global.py`.
