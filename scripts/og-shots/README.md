# OpenGravel screenshot gallery

From this checkout, run `npm ci` once, then:

```sh
npm run shots -- --devices iphone17,desktop --themes light --map fixture --repeat 2
```

The command builds this checkout and starts its own production server in fixture mode, on a free port (never 3200 or 3210). It writes `shots-out/<time>-<commit>/index.html`, `manifest.json`, and PNGs. Open the gallery on a phone: each row is a screen and each column is a device/theme. Tap a picture for the full viewport image or the full device frame link for Safari chrome. Red tiles include the error; the command exits nonzero if any capture failed. Repeat comparisons count pixels whose RGBA values differ at all, with no tolerance or masking. Differences are reported, not hidden or treated as a pass.

Options:

- `--target local|URL`: local is the default. A URL must be an HTTP(S) origin. The remote app must provide its own fixture data; this command cannot switch its server configuration. Planner-error injection only works with local.
- `--devices iphone17,desktop`: default. Optional entries: `iphone16e`, `iphone17promax`, `ipad11`, `chromium-320`. iOS entries use the existing simulator IDs configured in the runner; no simulator or runtime is created. Desktop is 1440 × 900 and chromium-320 is 320 × 568.
- `--themes light,dark`: default. Either or both.
- `--map fixture|real`: fixture uses the deterministic empty basemap; real uses OpenFreeMap and requires network access. Both still use fixture routes with `--target local`.
- `--repeat N`: captures each state N times (1–20); the maximum difference against the first is recorded.
- `--states a,b`: choose from `plan-idle`, `search-focused`, `route-choices`, `route-sheet-expanded`, `active-ride`, `explore`, `rides-library`, `settings`, `planner-error`.

Safari requires SSH access to `macbook`, Xcode's existing simulators and safaridriver. The runner starts safaridriver if needed, opens its own SSH tunnel including a localhost reverse forward to the local app, sets simulator appearance and status bar, and closes its session and tunnel afterward. The reverse forward makes the local app a secure localhost origin for simulator geolocation. Simulator screenshot files on the Mac are removed after copying. Safari only allows one WebDriver session; if an unknown session is active, stop it before running. Safari's driver does not provide a sessions-list endpoint, so the runner does not kill another owner's session. Chrome uses the installed Playwright and its cached browsers; it never downloads one. `playwright.config.ts` describes Playwright 1.61.1, but `package.json` pins 1.63.0; the installed package and matching cached browser are authoritative.

The local runner clears app storage on its own ephemeral origin between captures and supplies a fixed location in the browser. It injects a 503 for the error screenshot through its local proxy, without changing the app. External targets are not cleared or given error injection, and may contain existing state. Use a disposable target for repeatable results.

Map captures wait for the app's `data-map-load=ready`, a canvas, loaded fonts and a stable published camera and geometry, and reject a white canvas. This is not a full MapLibre tile-idle signal: the app does not publish pending tile requests. Real-map loading and changing online data can still vary. A screenshot cannot establish route correctness. Search focus requests the keyboard; verify the Safari full-frame image to see whether the simulator actually displayed it. Simulator Safari is not a physical iPhone: it cannot establish sunlight readability, physical touch, GPS behavior, battery use, or real-device performance.

Safari driving notes: simulator Safari's WebDriver turns clicks on buttons into text selection and does not deliver typed text, so the Safari driver clicks, focuses, fills and presses Enter through the page's DOM (native value setter plus input event, then a keydown). A journey that times out is retried up to twice; the gallery says "needed retries" on any picture that required it, and a failed tile shows the screen at the moment of failure. Between captures the runner clears local storage, IndexedDB, caches, service workers and OPFS, leaving through a non-app page so the app cannot write its state back.
