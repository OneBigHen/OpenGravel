import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The critical-path browser gate (16-TEST-AND-RELEASE-GATES §2, §6, §7).
 *
 * One project, one spec, one browser: the first vertical slice exercised the way
 * a rider exercises it — place a start, place a destination, plan, compare, and
 * cancel. It runs against a **production build** (`next start`, never `next
 * dev`), because 16 §12 is explicit that a dev server is not product evidence.
 *
 * ## Why the server is started in fixture mode
 *
 * The gate must be deterministic and must not depend on a router being up, so
 * the web server is launched with `OGV_ROUTE_PLAN_FIXTURE=1`
 * (`src/server/planning/plan-service.ts`): the plan answers come from
 * `tests/fixtures/route-plan/candidates-basic.json` and every answer says so in
 * its diagnostics. The live path (real GraphHopper) is untouched and keeps its
 * own gate (`npm run test:real-router`); a fixture is never labeled as live.
 *
 * `OGV_ROUTE_PLAN_FIXTURE_DELAY_MS` gives the fixture answer a latency window.
 * It is not decoration: the in-flight state (status copy, the cancel control)
 * and the "cancel during planning" requirement in 16 §6 #10 are only testable
 * if the answer does not arrive in the same tick, and a real router never
 * answers in zero milliseconds.
 *
 * ## Browsers
 *
 * `@playwright/test` is pinned to 1.61.1, which resolves chromium-1228,
 * chromium-headless-shell-1228, webkit-2311 and ffmpeg-1011. All four are
 * already present in this host's `/root/.cache/ms-playwright`, so the gate runs
 * with `PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright` and never
 * downloads a browser. A revision mismatch is fixed by pinning the Playwright
 * version to the cached revision, never by fetching browsers on a CI-less host.
 *
 * `critical-webkit` (16 §6 runs the critical workflows on Chromium *and*
 * WebKit) is registered only when `OGV_E2E_WEBKIT=1`, so the default gate stays
 * a single fast Chromium pass while the same spec stays one flag away from the
 * second engine. `--project=critical-webkit` without the flag is an error
 * rather than a silent pass — a project that does not exist cannot be reported
 * as skipped.
 */

/**
 * The port the production build is served on for this gate.
 *
 * Deliberately **not** 3200: on the build host that port is the live preview
 * origin (the configured Playwright webServer, published
 * through the Cloudflare tunnel). With `reuseExistingServer` a gate on 3200
 * silently attaches to that deployment and then reports on somebody else's
 * bytes — a green run that proves nothing about this checkout. The gate owns its
 * own port, and `OGV_E2E_PORT` exists for a host where 3210 is taken.
 */
const PORT = Number(process.env.OGV_E2E_PORT ?? 3210);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Fixture latency (ms) that makes the in-flight and cancel steps deterministic. */
const FIXTURE_DELAY_MS = "2000";

/** The second engine is opt-in; see the "Browsers" note above. */
const webkitEnabled = process.env.OGV_E2E_WEBKIT === "1";

/** The viewport 16 §10 lists for the desktop tier of the matrix. */
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

export default defineConfig({
  testDir: "tests/e2e",
  // A critical gate reports what happened: no retries that could hide a flake.
  retries: 0,
  forbidOnly: process.env.CI !== undefined,
  // One file, one server: tests run in order so their traces read as one story.
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  // A slow machine must not turn a truthful assertion into a failure. This is a
  // wait bound, not a retry budget; every assertion still has to hold.
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "critical-chromium",
      use: { ...devices["Desktop Chrome"], viewport: DESKTOP_VIEWPORT },
    },
    ...(webkitEnabled
      ? [
          {
            name: "critical-webkit",
            use: { ...devices["Desktop Safari"], viewport: DESKTOP_VIEWPORT },
          },
        ]
      : []),
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    // Fail loudly on a busy port rather than testing whatever holds it: a stale
    // server from an earlier run is stale code, and the gate's whole claim is
    // that it verified the build this checkout just produced.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      OGV_ROUTE_PLAN_FIXTURE: "1",
      OGV_CATALOG_FIXTURE: "1",
      COMMUNITY_DB_PATH: ":memory:",
      OGV_SHARE_DB_PATH: join(mkdtempSync(join(tmpdir(), "og-share-e2e-")), "shares.sqlite"),
      OGV_ROUTE_PLAN_FIXTURE_DELAY_MS: FIXTURE_DELAY_MS,
      // This flag only turns on the optional surface. The M8 critical spec
      // intercepts `/api/advisor` with a deterministic response.
      OGV_ADVISOR_FIXTURE: "1",
      OGV_WEATHER_FIXTURE: "1",
      OGV_PLACES_FIXTURE: "1",
      // The deterministic geocoder (M1, `src/server/geocoding/fixture-places.ts`):
      // search answers from six Lehigh Valley places, reverse names only points
      // within 1 km of them, so every other click still reads "Dropped pin".
      OGV_GEOCODE_FIXTURE: "1",
      OGV_ELEVATION_FIXTURE: "1",
      // A small clip of the real Pennsylvania offline road graph (Lane A1).
      OGV_OFFLINE_REGION_ROOT: "tests/fixtures/offline-regions",
      // Its basemap archive (Lane A2), clipped from our Pennsylvania extract.
      OGV_BASEMAP_ROOT: "tests/fixtures/basemap",
      // The basemap of the critical gate (VNX-012): `empty` draws our own layers
      // over a background colour with no tile request at all, so the gate can
      // never go red because a tile server blinked. The page resolves this per
      // request (`src/app/page.tsx`), which is why it belongs here and not in the
      // build environment.
      NEXT_PUBLIC_OGV_BASEMAP: "empty",
      // The Ride Focus surface's fixture position feed (Task 8.5). The real
      // position pipeline is the navigation engine's (8.2), so without this the
      // ride surface is honest but inert — no fix, recenter disabled — and the
      // controls that require a position could never be exercised in a browser.
      // Read per request by `src/app/ride/page.tsx`, never baked into the build.
      NEXT_PUBLIC_OGV_RIDE_FIXTURE: "1",
    },
  },
});
