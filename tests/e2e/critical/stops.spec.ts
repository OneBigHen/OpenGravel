import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  clickMapAtCoordinate,
  expectCoordinateNear,
  expectDrawnScene,
  expectHealthyMap,
  fractionOf,
  expectPointValue,
  plannerMap,
  readCoordinate,
  readDrawnScene,
  settledExtent,
  type Coordinate, openRefine } from "./map-helpers";

/**
 * The stops workflow in a real browser (04-PLANNER-AND-WORKSPACE-UX §15, §20,
 * §31; 05-MAP-INTERACTION-AND-CARTOGRAPHY §4).
 *
 * It runs against the production build in **fixture mode** and on the
 * **deterministic empty basemap**, exactly like the other critical specs (see
 * `playwright.config.ts`).
 *
 * Two claims need a browser rather than jsdom:
 *
 * - **A drag is one undo unit.** The pointer stream, the pointer capture and the
 *   release all belong to the renderer and the interaction machine, so "down →
 *   move → up produces exactly one command" is only provable here; jsdom tests the
 *   wiring with a stub host.
 * - **The list really is the accessible form of the map operations.** Every step
 *   below is a real button press, and the map clicks are only the *place* a
 *   placement needs — never a way to reach an action.
 *
 * The fixture answer is a canned line around Norristown (see `first-route.spec.ts`)
 * and does not follow the rider's points, so the ride is authored inside that area:
 * the committed route is then what the camera frames, which keeps every coordinate
 * on screen for the drag.
 */

/**
 * The fixture takes 2 s per plan (`OGV_ROUTE_PLAN_FIXTURE_DELAY_MS`) and this spec
 * plans several times — author, stop, stop, reorder, remove, undo — which makes it
 * the slowest spec still running on Playwright's default budget. Measured against
 * that 30 s default: 26.4–26.7 s passing on the merged-tree gates and 22.3 s here
 * under heavy host load, with one full critical run timing out at exactly 30 s.
 * The default is a wait bound, not a retry budget, so the bound is raised and every
 * assertion below still has to hold.
 */
test.setTimeout(45_000);

const START_COORDINATE: Coordinate = { lon: -75.4385, lat: 40.1385 };
const DESTINATION_COORDINATE: Coordinate = { lon: -75.4335, lat: 40.1325 };
/** North-west of the start, and far enough away that a drag cannot snap onto it. */
const STOP_A: Coordinate = { lon: -75.4420, lat: 40.1410 };
const STOP_B: Coordinate = { lon: -75.4425, lat: 40.1405 };

const START_LABEL = "No start yet";
const FINISH_LABEL = "No destination yet";


function stopRows(page: Page): Locator {
  return page.locator('[data-testid^="point-row-stop-"]');
}

/** Places both endpoints and plans the fixture ride. */
async function planFixtureRide(page: Page): Promise<void> {
  await clickMapAtCoordinate(page, START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText(START_LABEL);
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText(FINISH_LABEL);
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
}

/**
 * Adds a stop with the panel's own place mode and one map tap, and waits for the
 * replan the edit triggers (04 §21).
 */
async function addStop(page: Page, coordinate: Coordinate): Promise<void> {
  await openRefine(page);
  await page.getByTestId("add-stop").click();
  // Armed before the tap: the tap's own `click` call can outlast the fixture's 2 s
  // in-flight window under CPU load (see `recovery.spec.ts`, measured 1.9 s), so a
  // wait started afterwards can miss a copy that was on screen the whole time.
  const inFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  await clickMapAtCoordinate(page, coordinate);
  await inFlight;
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
}

/**
 * Waits for the answer of a replan whose in-flight copy the caller has already
 * armed (see `addStop` below and `road-span.spec.ts`).
 *
 * The in-flight copy has to be observed from *before* the edit: under CPU load the
 * edit's own action can outlast the fixture's 2 s window by itself, so a wait
 * started after it can miss a copy that was on screen the whole time (same
 * reasoning as the camera in `map-helpers.ts`). The settled copy is a terminal
 * state, so it can be waited for whenever it arrives.
 */
async function settleReplan(page: Page): Promise<void> {
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("a stop is added, reordered, removed and restored by undo", async ({ page }) => {
  await planFixtureRide(page);

  // The committed route draws two points: the endpoints.
  await expectDrawnScene(page, { points: "2" });

  // "Add stop" arms the placement and one tap authors the stop — the list is the
  // path, the map click is only the place (04 §15, §31).
  await addStop(page, STOP_A);
  await expect(stopRows(page)).toHaveCount(1);
  await expectDrawnScene(page, { points: "3" });

  await addStop(page, STOP_B);
  await expect(stopRows(page)).toHaveCount(2);

  // The list order is the itinerary order: A then B.
  const firstBefore = await readCoordinate(page, "label-stop-1");
  const secondBefore = await readCoordinate(page, "label-stop-2");
  expectCoordinateNear(firstBefore, STOP_A);
  expectCoordinateNear(secondBefore, STOP_B);

  // Reorder is a list action, disabled at the ends and nowhere else.
  await expect(page.getByTestId("move-up-stop-1")).toBeDisabled();
  await expect(page.getByTestId("move-down-stop-2")).toBeDisabled();
  // Armed before the press; see `settleReplan`.
  const reorderInFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  await page.getByTestId("move-up-stop-2").click();
  await reorderInFlight;
  await settleReplan(page);

  const firstAfter = await readCoordinate(page, "label-stop-1");
  const secondAfter = await readCoordinate(page, "label-stop-2");
  expectCoordinateNear(firstAfter, STOP_B);
  expectCoordinateNear(secondAfter, STOP_A);

  // Removing leaves the route on screen and the labels honest.
  // Armed before the press; see `settleReplan`.
  const removeInFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  await page.getByTestId("remove-stop-1").click();
  await removeInFlight;
  await settleReplan(page);
  await expect(stopRows(page)).toHaveCount(1);
  await expectDrawnScene(page, { points: "3" });

  // One undo restores the removed stop — the whole ride, not merely a point
  // (04 §20), and the restored stop keeps its place in the list.
  await page.getByTestId("undo").click();
  await expect(stopRows(page)).toHaveCount(2);
  const restored = await readCoordinate(page, "label-stop-1");
  expectCoordinateNear(restored, STOP_B);
  await expectDrawnScene(page, { points: "4" });
  await expectHealthyMap(page);
});

test("dragging a point is one command and never blanks the last ride", async ({ page }) => {
  await planFixtureRide(page);
  const finishBefore = await readCoordinate(page, "finish-value");

  // The exact authored position: the composer rounds its label to four decimals,
  // which is ~11 m — enough of a miss to slide off a 8px marker at this zoom. The
  // numeric inspector is the app's own full-precision view of the same object, so
  // the grab is aimed with the position the app actually holds.
  await openRefine(page);
  await page.getByTestId("select-start").click();
  const startBefore = {
    lat: Number(await page.getByTestId("point-lat").inputValue()),
    lon: Number(await page.getByTestId("point-lon").inputValue()),
  };

  // Grab the start marker where the camera is actually drawing it.
  const extent = await settledExtent(page);
  const box = await plannerMap(page).boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");
  const grab = fractionOf(extent, startBefore);
  const startPixel = {
    x: Math.round(grab.x * box.width),
    y: Math.round(grab.y * box.height),
  };

  // A move of ~170 m west and ~165 m south: away from the destination and from
  // the authored stops, so the preview's snap rule stays out of the way.
  const deltaLon = -0.002;
  const deltaLat = -0.0015;
  const drag = {
    x: Math.round((deltaLon / (extent.maxLon - extent.minLon)) * box.width),
    y: Math.round((deltaLat / (extent.maxLat - extent.minLat)) * box.height),
  };

  await page.mouse.move(box.x + startPixel.x, box.y + startPixel.y);
  await page.mouse.down();
  await page.mouse.move(box.x + startPixel.x + drag.x, box.y + startPixel.y + drag.y, {
    steps: 6,
  });

  // Mid-gesture: the ghost marker exists, and nothing has been authored — a drag
  // previews locally until the release commits it (05 §4).
  await expectDrawnScene(page, { preview: "1" });
  await expectPointValue(page, "start-value", startBefore);

  // Armed before the release; see `settleReplan`. The release is one command: the
  // planner is asked again for the new revision while the previous ride is still on
  // screen (04 §9, §21).
  const releaseInFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  await page.mouse.up();
  await releaseInFlight;
  await expectDrawnScene(page, { routes: "2" });
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");

  // The ghost is gone, the start really moved, and it is still one start: the same
  // point, at the coordinate the rider released it over.
  const scene = await readDrawnScene(page);
  expect(scene.preview).toBe("0");
  const startAfter = {
    lat: Number(await page.getByTestId("point-lat").inputValue()),
    lon: Number(await page.getByTestId("point-lon").inputValue()),
  };
  // It really moved (a tolerance this tight cannot pass on the old position)...
  expect(Math.abs(startAfter.lon - startBefore.lon)).toBeGreaterThan(0.0005);
  expect(Math.abs(startAfter.lat - startBefore.lat)).toBeGreaterThan(0.0005);
  // ...and it landed on the geography the pointer was released over.
  expectCoordinateNear(startAfter, {
    lon: startBefore.lon + deltaLon,
    lat: startBefore.lat + deltaLat,
  });
  // The other endpoint is untouched: a drag moves one object.
  await expectPointValue(page, "finish-value", finishBefore);
  await expectPointValue(page, "label-start", startAfter);
  await expectHealthyMap(page);

  // The whole edit is one undo unit: a single press puts the start back.
  await page.getByTestId("undo").click();
  await expectPointValue(page, "start-value", startBefore);
});
