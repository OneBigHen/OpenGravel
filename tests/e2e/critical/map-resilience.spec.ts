import { expect, test, type Page } from "@playwright/test";

import {
  MAP_ERROR_ATTRIBUTE,
  MAP_LOAD_REASON_ATTRIBUTE,
  plannerMap,
  readMapLoad,
  rendererAttemptCount,
  settledMapLoad,
} from "./map-helpers";

/**
 * The map's load watchdog (4.0s).
 *
 * The failure this spec exists for was load-correlated and silent: under heavy
 * concurrent load (builds and gates running beside the browser) a cold page load
 * could abort the basemap style fetch, lose the WebGL context and leave the app
 * with a map element, no tiles and no error at all — three times in about
 * forty-five cold loads, and never on demand.
 *
 * A test that cannot reproduce the race on demand can still make its *outcome*
 * impossible, which is what this one does: it repeats cold loads under CPU
 * pressure and asserts that every one of them ends in one of exactly two
 * honest states —
 *
 * - `data-map-load="ready"`, with a published camera, no claimed failure, and (for
 *   a real basemap) at least one basemap response; or
 * - `data-map-load="failed"`, with a reason, and the visible "The map didn't load
 *   — Retry map" surface.
 *
 * A blank canvas with no data and no error is not one of them, so it cannot pass.
 * The retry surface is then exercised once per throttled load, because an honest
 * failure that the rider can act on is only half the claim: the action has to
 * land somewhere honest too.
 *
 * ## Why CPU throttling, and why the network is throttled as well
 *
 * The race is about contention, not about the code path being slow: the observed
 * failures happened while the host was compiling. `Emulation.setCPUThrottlingRate`
 * at 6× reproduces that pressure deterministically, and a mild network throttle
 * slows the style/tile chain the failure was first seen on without making the
 * gate a test of the local server's throughput.
 */

/** How many consecutive cold loads the watchdog covers. */
const LOADS = 3;

/** How long one load may take to settle before the gate calls it silent. */
const LOAD_BOUND_MS = 30_000;

/** CPU throttling rate for the run: the load-correlated pressure, reproduced. */
const CPU_RATE = 6;

/** A slow-but-real connection: latency in ms, throughput in bytes per second. */
const NETWORK = { latency: 100, downloadThroughput: 1_000_000, uploadThroughput: 1_000_000 };

/** Basemap hosts whose responses count as "real tiles arrived". */
const BASEMAP_PATTERN = /openfreemap|tile|\.pbf|\.png\?/;

/** Counts the basemap responses one load produced. */
function countBasemapResponses(page: Page): { readonly total: () => number } {
  let total = 0;
  const onResponse = (response: { url(): string; ok(): boolean }): void => {
    if (!BASEMAP_PATTERN.test(response.url())) return;
    if (response.ok()) total += 1;
  };
  page.on("response", onResponse);
  return { total: () => total };
}

/**
 * One cold load, asserted to end honestly (4.0s).
 *
 * Returns nothing: every branch ends in an assertion, so a load that settles
 * nowhere — the historical blank — fails the gate instead of passing quietly.
 */
async function loadOnce(page: Page, index: number): Promise<void> {
  const basemapResponses = countBasemapResponses(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });

  // The map container is the gate's contract with the host; if it is missing the
  // page did not get far enough to have a map at all, which is a different
  // failure and a louder one.
  await expect(plannerMap(page)).toBeVisible();

  const status = await settledMapLoad(page, LOAD_BOUND_MS);
  const basemap = (await plannerMap(page).getAttribute("data-basemap")) ?? "unknown";

  if (status.state === "ready") {
    // The style loaded *and* the renderer produced data for it: a camera exists,
    // and the failure channel is silent about it.
    await expect(plannerMap(page)).toHaveAttribute("data-map-extent", /.*/);
    await expect(plannerMap(page)).not.toHaveAttribute(MAP_ERROR_ATTRIBUTE, /.*/);
    if (basemap === "openfreemap" || basemap === "osm") {
      expect(
        basemapResponses.total(),
        `load ${index}: the map is ready on basemap "${basemap}" but no basemap data arrived`,
      ).toBeGreaterThan(0);
    }
    console.log(
      `[map-resilience] load ${index}: ready (basemap=${basemap}, basemap responses=${basemapResponses.total()})`,
    );
  } else {
    // The map did not load, and it said so: a reason, and the one action that can
    // help. This is the branch the old app did not have.
    expect(status.reason, `load ${index}: a failed load must name its reason`).not.toBeNull();
    await expect(page.getByTestId("map-load-notice")).toContainText("The map didn't load");
    await expect(page.getByTestId("map-load-notice")).toHaveAttribute(
      MAP_LOAD_REASON_ATTRIBUTE,
      /.*/,
    );
    console.log(`[map-resilience] load ${index}: failed honestly (reason=${status.reason})`);
  }

  // Whatever happened, there is exactly one map: a recovery never stacks a second
  // surface or a second canvas.
  await expect(plannerMap(page)).toHaveCount(1);
  expect(await rendererAttemptCount(page), `load ${index}: renderer attempts`).toBeLessThanOrEqual(1);

  if (status.state === "failed") {
    // The rider's recovery is always allowed, spends exactly one attempt, and must
    // end somewhere honest — never back in an unexplained blank.
    await page.getByTestId("map-retry").click();
    const recovered = await settledMapLoad(page, LOAD_BOUND_MS);
    expect(["ready", "failed"]).toContain(recovered.state);
    if (recovered.state === "ready") {
      await expect(plannerMap(page)).toHaveAttribute("data-map-extent", /.*/);
    } else {
      await expect(page.getByTestId("map-retry")).toBeVisible();
    }
    // One press, one attempt: still one map and one renderer child.
    await expect(plannerMap(page)).toHaveCount(1);
    expect(await rendererAttemptCount(page), `load ${index}: renderer attempts after retry`)
      .toBeLessThanOrEqual(1);
    console.log(`[map-resilience] load ${index}: rider retry -> ${recovered.state}`);
  }
}

test.describe("map load resilience under CPU pressure", () => {
  test.setTimeout(240_000);

  test(`${LOADS} throttled cold loads never end blank`, async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NETWORK });

    for (let index = 1; index <= LOADS; index += 1) {
      await loadOnce(page, index);
    }
  });

  test("a load that settles keeps saying what it is", async ({ page }) => {
    // The cheap companion to the throttled run: the load-health contract itself,
    // with no pressure at all. `data-map-load` must exist the moment the map does,
    // and it must never be missing — the attribute's absence was what made the
    // historical blank indistinguishable from an empty map.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // `domcontentloaded` is well before hydration loads the renderer, so the map
    // container is the first thing to wait for — the load state is published from
    // the moment the host exists.
    await expect(plannerMap(page)).toBeVisible();
    const early = await readMapLoad(page);
    expect(early.state, "the map must publish its load state").not.toBeNull();

    const settled = await settledMapLoad(page);
    expect(["ready", "failed"]).toContain(settled.state);
    await expect(plannerMap(page)).toHaveAttribute("data-map-load", /loading|ready|retrying|failed/);
  });
});
