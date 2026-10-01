> **Moved:** this study guide now lives in [study-guides](https://github.com/gabeling121/study-guides) at https://gabeling121.github.io/study-guides/7th-grade/roman-map/

# Orbis Terrārum Rōmānus -- Map Quiz

A study app for a Roman-world geography quiz. It works on Chromebook, iPad, and any browser.
It's a static site with no server; progress is saved on each device.

- `docs/` -- the app, published by GitHub Pages
- `build/build.py` -- regenerates `docs/mapdata.js` from Natural Earth coastline and river data
  plus the quiz places defined in `PLACES` (edit that list to add or change places)

To rebuild the map, download `ne_10m_land`, `ne_10m_lakes` and `ne_10m_rivers_lake_centerlines`
GeoJSON from https://github.com/nvkelso/natural-earth-vector into `build/`, then run `python build.py`.

Map data: Natural Earth (public domain).
