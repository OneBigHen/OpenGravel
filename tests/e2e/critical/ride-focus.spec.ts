import { expect, test } from "@playwright/test";

import {
  cameraGeneration,
  clickMapAtCoordinate,
  dragMap,
  expectDrawnScene,
  expectHealthyMap,
  expectNoLayerErrors,
  plannerMap,
  readDrawnScene,
  settledExtent,
  type Coordinate,
} from "./map-helpers";
import { clickInRideSheet, openRideSheet } from "./ride-focus-helpers";

/**
 * The Ride Focus surface (08-RIDE-NAVIGATION-AND-FREE-RIDE §2–§8, §13, §28;
 * 04-PLANNER-AND-WORKSPACE-UX §28; 12 §3, §10; 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * The workflow this file adds is the Active Ride handoff and the surface a rider
 * actually holds: a real `Start ride` in the planner, the focus screen at its own
 * URL, the honest no-fix state, a resume, a recenter that moves the camera, a
 * two-step stop, and a reload that restores the same ride **paused** (8 §13).
 *
 * It runs against the same production build, in the same fixture mode and the
 * same deterministic empty basemap as the other critical specs (see
 * `playwright.config.ts`). The route fixture is the canned Norristown line, so
 * the taps below are placed inside its area: the committed route is then what the
 * camera frames, and the ride surface follows *that* line.
 *
 * `NEXT_PUBLIC_OGV_RIDE_FIXTURE=1` feeds the session fixture position fixes
 * (`src/infrastructure/ride/fixture-position-source.ts`). The real position
 * pipeline is Task 8.2's; without a fix the surface is honest and inert (no GPS,
 * recenter disabled), and this gate asserts that state first — the fixture only
 * exists so the controls that *need* a fix can be exercised.
 */

const START_COORDINATE: Coordinate = { lon: -75.4385, lat: 40.1385 };
const DESTINATION_COORDINATE: Coordinate = { lon: -75.4335, lat: 40.1325 };

/** Places both endpoints, plans the fixture ride, and starts the ride. */
async function startRide(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);

  await clickMapAtCoordinate(page, START_COORDINATE);
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);

  // 04 §28: the handoff is offered for the selected route and nothing else.
  const start = page.getByTestId("start-ride");
  await expect(start).toBeEnabled();
  await start.click();

  await expect(page).toHaveURL(/\/ride$/);
  await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
}

/** The ride surface's map, once the renderer reports it is drawing. */
async function rideMapReady(page: import("@playwright/test").Page): Promise<void> {
  await expect(plannerMap(page)).toBeVisible();
  await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
  await settledExtent(page);
}

/** Taps Resume when the ride is paused; right after Start ride it is already running. */
async function resumeIfPaused(page: import("@playwright/test").Page): Promise<void> {
  const resume = page.getByTestId("ride-resume");
  if ((await resume.count()) > 0) await resume.click();
}

/** Resumes the ride, then waits for the fixture's first fix. */
async function resumeAndFix(page: import("@playwright/test").Page): Promise<void> {
  // Right after Start ride the ride is already running; after a reload it waits.
  const resume = page.getByTestId("ride-resume");
  if ((await resume.count()) > 0) await resume.click();
  await openRideSheet(page);
  await expect(page.getByTestId("ride-pause")).toBeVisible();
  await expectDrawnScene(page, { position: "good" });
}

test.describe("ride focus", () => {
  test.beforeEach(async ({ page }) => {
    await startRide(page);
    await rideMapReady(page);
  });

  test("starts guiding on Start ride; after a reload it is paused with no fix and resumes on command", async ({
    page,
  }) => {
    // A reload plus letting a restored fix age past "good" is a long story.
    test.setTimeout(60_000);
    // The rider's own Start ride starts the ride (UX rework phase 6): no
    // "restored, paused" detour between tapping Start and being guided.
    await expect(page.getByTestId("ride-activity")).toHaveText("Guided ride");
    // DV-10: a moving ride is map-first; its controls wait behind the strip.
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "closed");
    await expect(page.getByTestId("ride-pause")).toHaveCount(1);
    await expect(page.getByText("Ride restored")).toHaveCount(0);

    // 8 §13: a session reconstructed in a new page context — a reload — comes
    // back paused, and the rider's explicit Resume is what starts it moving.
    await page.reload();
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
    await rideMapReady(page);
    await expect(page.getByTestId("ride-status")).toContainText("Ride restored");
    await expect(page.getByTestId("ride-activity")).toHaveText("Paused");
    await expect(page.getByTestId("ride-resume")).toBeVisible();
    await expect(page.getByTestId("ride-pause")).toHaveCount(0);

    // 8 §4: a paused, restored ride has no live fix. Whatever position the
    // journal kept (the fixture may have reported one before the reload) only
    // ages; it is never presented as current (the stale test below pins that
    // speed and heading then drop out).
    await expect(page.getByTestId("ride-gps")).not.toContainText("Good GPS fix", { timeout: 15_000 });

    // The map is the ride's own: one selected route and nothing selectable
    // (08 §2: Ember route, Signal Blue position).
    await expectDrawnScene(page, { routes: "1", points: "0" });
    expect((await readDrawnScene(page))["selected"]).not.toBe("none");
    expect((await readDrawnScene(page))["position"]).not.toBe("good");

    // Ahead content stays quiet while the ride is paused (OGV-RID-005).
    await expect(page.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "suspended");

    await resumeAndFix(page);
    await expect(page.getByTestId("ride-activity")).toHaveText("Guided ride");
    await expect(page.getByTestId("ride-maneuver-glyph")).toBeVisible();
    await expect(page.getByTestId("ride-maneuver-glyph")).toHaveAttribute(
      "data-glyph",
      /left|right|continue/,
    );
    await expect(page.getByTestId("ride-eta")).not.toHaveText("Unknown");

    // Now the fix is current, and the surface may present it as such.
    await expect(page.getByTestId("ride-gps")).toContainText("Good GPS fix");
    await expect(page.getByTestId("ride-gps")).toHaveAttribute("data-tone", "good");
    await expect(page.getByTestId("ride-speed")).not.toHaveText("—");
    await expectHealthyMap(page);
    await expectNoLayerErrors(page);
  });

  test("recenters on the rider, follows, and hands the camera back to a rider pan", async ({
    page,
  }) => {
    await resumeAndFix(page);

    // DV-10: follow is on by itself, heading-up and tilted.
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-follow", "true");
    await expect(page.getByTestId("ride-recenter")).toHaveCount(0);
    await expect.poll(async () => Number(await plannerMap(page).getAttribute("data-map-pitch"))).toBeGreaterThan(20);

    // 05 §8: the rider taking the camera ends the follow, without a mode toggle.
    await dragMap(page, { x: 0.5, y: 0.5 }, { dx: -80, dy: 40 });
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-follow", "false");

    const before = await cameraGeneration(page);
    await page.getByTestId("ride-recenter").click();
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-follow", "true");
    // A recenter is a camera move, and the renderer is the one that proves it.
    await expect
      .poll(async () => cameraGeneration(page), { timeout: 10_000 })
      .toBeGreaterThan(before);
  });

  test("stops the ride in two steps, and clears the pointer when it ends", async ({ page }) => {
    await resumeAndFix(page);
    // The strip's ✕ is the one way to end a ride from the map (DV-10).
    await page.getByTestId("ride-end").click();

    // The confirmation is in place (not a modal), and the way out is explicit.
    await expect(page.getByTestId("ride-stop-confirm")).toBeVisible();
    await page.getByTestId("ride-keep-riding").click();
    await expect(page.getByTestId("ride-stop-confirm")).toHaveCount(0);
    await openRideSheet(page);
    await expect(page.getByTestId("ride-pause")).toBeVisible();

    await clickInRideSheet(page, "ride-stop", "ride-stop-confirm");
    await page.getByTestId("ride-finish").click();

    await expect(page.getByTestId("ride-terminal")).toContainText("Ride finished");
    await expect(page.getByTestId("ride-stop-confirm")).toHaveCount(0);
    // A terminal ride has no controls left to offer: 8 §2's "stop/exit ride" is
    // done, and the way out is the planner link that remains on the surface.
    await expect(page.getByTestId("ride-pause")).toHaveCount(0);
    await expect(page.getByTestId("ride-recenter")).toHaveCount(0);
    await expect(page.getByTestId("ride-exit")).toBeVisible();

    // The ride is over: a reload finds no ride rather than reopening a finished
    // one (the pointer is the only thing that said which session to restore).
    await page.reload();
    await expect(page.getByTestId("ride-recovery")).toContainText("no ride in progress");
  });

  test("a reload restores the same ride, paused, with the route still drawn", async ({ page }) => {
    // The staleness assertion below waits up to 30 s for the 20 s fresh window
    // to lapse, so the test needs a budget larger than that one wait plus setup;
    // the default 30 s made the outcome depend on how fast setup ran.
    test.setTimeout(60_000);
    await resumeAndFix(page);

    await page.reload();
    await rideMapReady(page);

    // 8 §13: same session, paused, explicit resume required — and the route line
    // is still drawn, because the handoff recorded the geometry handle.
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("ride-status")).toContainText("Ride restored");
    await expect(page.getByTestId("ride-resume")).toBeVisible();
    await expect(page.getByTestId("ride-pause")).toHaveCount(0);
    await expectDrawnScene(page, { routes: "1" });

    // The fix retained across the reload is not presented as current for long:
    // nothing re-acquires it while the ride is paused (8 §13), so it ages out of
    // the fresh window and the surface stops showing its speed and heading — the
    // §4 rule, proven in the browser rather than only in a projection test.
    await expect(page.getByTestId("ride-gps")).toContainText("GPS fix");
    await expect(page.getByTestId("ride-gps")).toContainText("Stale GPS", { timeout: 30_000 });
    await expect(page.getByTestId("ride-speed")).toHaveText("—");
    await expect(page.getByTestId("ride-heading")).toHaveText("—");
    // And the map mark degrades with it: a stale fix keeps its last-known point
    // and stops presenting itself as current (08 §4, 12 §16).
    await expectDrawnScene(page, { position: "stale" });
  });

  test("labels a weak GPS fix without treating its accuracy as good", async ({ page, context }) => {
    // From a paused, fix-less ride (a reload), so the first fix is the weak one.
    await page.reload();
    await rideMapReady(page);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ longitude: START_COORDINATE.lon, latitude: START_COORDINATE.lat, accuracy: 120 });
    await resumeIfPaused(page);

    await expect(page.getByTestId("ride-gps")).toContainText("Weak GPS fix");
    await expect(page.getByTestId("ride-gps")).toHaveAttribute("data-tone", "degraded");
  });

  test("states denied location and keeps the ride controls available", async ({ page, context }) => {
    await context.grantPermissions([], { origin: new URL(page.url()).origin });
    await resumeIfPaused(page);

    await expect(page.getByTestId("ride-warning-location-denied")).toContainText("Location is blocked");
    await expect(page.getByTestId("ride-retry-location")).toBeEnabled();
    await expect(page.getByTestId("ride-stop")).toBeEnabled();
  });
});

test("the planner offers the handoff only once a route is chosen", async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);

  // Nothing planned yet: no ride action at all, rather than a disabled control
  // with no route to ride (04 §8's one-instruction rule).
  await expect(page.getByTestId("start-ride")).toHaveCount(0);

  await clickMapAtCoordinate(page, START_COORDINATE);
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await expect(page.getByTestId("start-ride")).toHaveCount(0);

  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await expect(page.getByTestId("start-ride")).toBeEnabled();
});
