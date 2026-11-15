# Terra

**Crop rotations for a drier Arizona, built on NASA Earth observations.**
NASA Space Apps Challenge 2026 · Field Shift: Adapting Farms with NASA Data

Terra is a phone-first web app that helps a farmer compare crop rotations for their own field. A three-step setup asks where the field is, what grows there now, how much water the farm can count on and what matters most. Terra then downloads 20 years of NASA weather for that spot, works out how much water each crop would really use, and replays about 12,000 three-year rotations through every real year since 2005.

**Field.** A 3D globe flies into your field. Switch the map between satellite, MODIS greenness, SMAP soil moisture and GRACE groundwater change. See rain, crop water demand, 110°F days and freezes for the spot, the last 90 days compared with normal, the topsoil from SoilGrids, and a satellite greenness history that shows when the field sat bare.

**Plans.** Your current rotation next to the three best matches. Each plan is named for what it does best (least water, best for soil, most income, safest in dry years) and leads with the gallons it saves. Simple grades show water, soil, dry-year safety and income, along with a 36-month calendar with bare months and heat or freeze risk, and a square for each past year showing whether the plan fit your water. "Why this plan" explains the reasons, what Terra doesn't know, what to ask a local expert and how confident it is. "Month by month" turns the plan into dated steps you can add to your phone calendar or print.

**Build.** Tap any season to swap the crop and watch every score update instantly. Push the "what if" sliders to test hotter or drier weather, and leave out crops you can't grow or sell.

**Learn.** How Terra works in four steps, plain-language terms, and every data source.

English and Spanish. Installable on a phone and works offline once loaded. Terra supports the farmer's decision. It does not make it.

## Run it

The app is plain HTML, CSS and JavaScript in [`terra/`](terra). There is no server code.

- **Live site:** every push to `main` downloads fresh NASA data for the demo farms, copies in the map library, runs the tests and publishes `terra/` to GitHub Pages through [`.github/workflows/pages.yml`](.github/workflows/pages.yml). One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
- **On your own computer:** run `node scripts/fetch-data.mjs`, copy `maplibre-gl.js` and `maplibre-gl.css` from the `maplibre-gl` npm package into `terra/vendor/`, then `cd terra && python3 -m http.server 8000` and open http://localhost:8000.

NASA data loads live in the browser, so the page needs internet access. Nothing is made up: if a NASA service is down, Terra says so.

## Test it

```
node terra/test/engine.test.mjs
```

The tests check that calendars never overlap, that excluded crops never appear, that hotter weather raises water need, that priorities change the ranking, and that modeled seasonal water use for each crop lands within 30% of published Arizona measurements (alfalfa 72 in, cotton 41 in, wheat and barley 24 in, sorghum 25 in, guar 400 mm).

## How it works

1. **Weather.** NASA POWER daily max and min temperature, dew point, wind, sunlight and rain for crop years 2005 to 2024 (Nov to Oct).
2. **Reference water demand.** FAO-56 Penman-Monteith (eq. 6). Inside Arizona it is bias-corrected month by month against 12 University of Arizona AZMET farm weather stations (2020 to 2024); the check is leave-one-station-out and is shown in the app. Days missing sunlight, humidity or wind fall back to Hargreaves (eq. 52).
3. **Crop water use.** FAO-56 crop coefficient curves, adjusted for dry desert air (eq. 62). Irrigation need = crop water use minus 75% of rain. Gross water = need divided by irrigation efficiency (flood 70%, sprinkler 80%, drip 90%).
4. **Rotations.** Every 3-year plan that fits central Arizona planting dates, about 12,000 of them.
5. **Replay.** Each plan runs through each real year at the farm's water supply after any Colorado River shortage (share of water from the CAP canal x the cut: 60% in 2022, 100% since 2023).
6. **Money.** University of Arizona crop budgets and USDA NASS/ERS 2024 prices. Water is costed at the farmer's own price. When water runs short, yield drops by the FAO yield response factor (Ky). Shown as a range across the 20 years.
7. **Heat.** 110°F days and their trend (Theil-Sen). Cotton canopy temperature from a model fitted to AZMET's own canopy temperature, counted against the University of Arizona heat stress threshold (82.4°F).
8. **Groundwater.** ADWR management area for the field, and depth to water in nearby monitored wells (USGS Water Data, includes ADWR measurements).
9. **Satellite check.** MODIS NDVI for 2020 to 2024 compared with the rotation the farmer says they grow.
10. **Scores.** Water, soil health, dry-year safety and income (rank of average profit among all plans). Your priorities weight them.

Outside Arizona the app runs in basic mode: same NASA data and water math, Arizona crop calendar and costs, no station calibration.

## Project layout

```
terra/
  index.html        page
  css/styles.css    design
  js/crops.js       crop facts with sources
  js/engine.js      water model, rotations, scoring, explanations
  js/et.js          Penman-Monteith, Hargreaves, canopy temperature
  js/economics.js   crop budgets, prices, water shortage tiers
  js/local.js       groundwater areas, well trends, satellite check
  js/nasa.js        NASA POWER, MODIS NDVI, GIBS layers, SoilGrids
  js/charts.js      rings, calendar strip, year replay, icons
  js/i18n.js        English and Spanish text
  js/worker.js      runs the engine off the main thread
  js/art.js         crop drawings and scenes
  data/demo.json    NASA weather, soil, NDVI and wells for 4 demo farms (made by scripts/fetch-data.mjs)
  data/validation.json  model checks against 12 AZMET stations
  data/ama.json     ADWR groundwater management areas
  vendor/           MapLibre GL map library (copied in by the workflow)
  js/app.js         interface
  sw.js             offline support
  manifest.webmanifest  install on a phone
  test/             engine tests
scripts/
  fetch-data.mjs    downloads NASA POWER and SoilGrids data for the demo farms
docs/
  DATA_SOURCES.md   every dataset, for the submission page
  SLIDES.md         draft of the 7 slides
backend/, frontend/ first prototype (FastAPI), kept for reference
```

## Limits

- Planting dates and crop list are written for the central Arizona low desert. Elsewhere Terra still runs but marks confidence as low.
- NASA POWER and SMAP cover areas miles wide, not one field. MODIS greenness is 250 m. GRACE covers whole regions.
- Hargreaves can underestimate water demand where days and nights are close in temperature.
- Money uses 2024 Arizona yields and prices and published budgets, not your farm's books. Guar and sesame use Texas budgets because Arizona has none.
- Guar, sesame and cover crop water use are approximate because FAO-56 has no exact values for them.
