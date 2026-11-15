# Terra on Replit

## Current app
Serve the existing static HTML/CSS/JavaScript application in `terra/`.
`backend/`, `frontend/`, and `requirements.txt` belong to the earlier Python
prototype and are not needed to run the current app. Do not migrate the stack
or reorganize the imported project as part of environment setup.

## Run
- The **Start application** workflow runs `npm start`.
- `npm start` copies MapLibre's JavaScript and CSS from the locked npm dependency
  into `terra/vendor/`, then serves `terra/` on `0.0.0.0:5000` with Python's
  static HTTP server.
- After a fresh checkout, install the root npm dependencies with `npm ci`.
- Run `npm run fetch:data` to download real NASA POWER weather and optional
  SoilGrids measurements for the four demo farms into `terra/data/demo.json`.
  This is a one-time preparation step, not a requirement on every server start.
- Run `npm test` for the existing crop-rotation engine tests.

## External data
No secrets, database, or Python application packages are needed. NASA POWER,
MODIS/ORNL, ISRIC SoilGrids, map tiles, and Google Fonts require internet access.
If bundled demo data is absent, the app requests weather live; service outages
must remain visible rather than being replaced with fabricated values.
Generated demo data and vendor bundles are already ignored by Git.

## Map library
The imported MapLibre 5.24.1 was blocked by Replit's package security policy.
The project now uses lockfile-controlled MapLibre 6.18.0 and its ES module
bundles, including the shared and worker modules. The GitHub Pages workflow
uses the same dependency and copy script to keep both environments consistent.
