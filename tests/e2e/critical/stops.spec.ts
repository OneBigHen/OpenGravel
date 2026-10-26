import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  clickMapAtCoordinate,
  placeEndpoint,
  expectCoordinateNear,
  expectDrawnScene,
  expectHealthyMap,
  fractionOf,
  expectPointValue,
  plannerMap,
  readCoordinate,
  readDrawnScene,
  settledExtent,
  type Coordinate, openRefine,
  pressPlan,
} from "./map-helpers";

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

/**
 * Opens a row's action sheet. Every per-row action (zoom, replace, reorder,
 * convert, remove) lives there, so the list itself stays one reading with one
 * control (04 §15, §31).
 */
async function openRowMenu(page: Page, key: string): Promise<void> {
  await page.getByTestId(`more-${key}`).click();
  await expect(page.getByTestId("point-menu")).toBeVisible();
}

/** Places both endpoints and plans the fixture ride. */
async function planFixtureRide(page: Page): Promise<void> {
  await placeEndpoint(page, "start", START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText(START_LABEL);
  await placeEndpoint(page, "finish", DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText(FINISH_LABEL);
  await pressPlan(page);
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
  await openRowMenu(page, "stop-1");
  await expect(page.getByTestId("move-up-stop-1")).toBeDisabled();
  await page.keyboard.press("Escape");
  await openRowMenu(page, "stop-2");
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
  await openRowMenu(page, "stop-1");
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

// First/last vertices and an interior vertex of the selected fixture route.
// Set the exact numeric coordinate, so the pin is on the line rather than just
// near it (map placement and row labels round their coordinates).
const DRAG_POINTS = [
  { key: "start", value: "start-value", coordinate: { lon: -75.44, lat: 40.14 } },
  { key: "finish", value: "finish-value", coordinate: { lon: -75.4328, lat: 40.131 } },
  { key: "stop-1", value: "label-stop-1", coordinate: { lon: -75.4355, lat: 40.1382 } },
] as const;

for (const point of DRAG_POINTS) {
  for (const pointerType of ["mouse", "touch"] as const) {
    test(`dragging a point is one command and never blanks the last ride (${point.key}, ${pointerType})`, async ({ page, browserName }) => {
      test.skip(pointerType === "touch" && browserName !== "chromium", "Held touch input uses Chromium CDP.");
      await planFixtureRide(page);
      if (point.key === "stop-1") await addStop(page, STOP_A);
      const otherEndpoint = point.key === "start" ? "finish" : "start";
      const otherBefore = await readCoordinate(page, `${otherEndpoint}-value`);

      // The exact authored position: the composer rounds its label to four decimals,
      // which is ~11 m — enough of a miss to slide off a 8px marker at this zoom. The
      // numeric inspector is the app's own full-precision view of the same object, so
      // the grab is aimed with the position the app actually holds.
      await openRefine(page);
      await page.getByTestId(`select-${point.key}`).click();
      await page.getByTestId("point-lat").fill(String(point.coordinate.lat));
      await page.getByTestId("point-lon").fill(String(point.coordinate.lon));
      const positionInFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
      await page.getByTestId("apply-coordinate").click();
      await positionInFlight;
      await settleReplan(page);
      const pointBefore = {
        lat: Number(await page.getByTestId("point-lat").inputValue()),
        lon: Number(await page.getByTestId("point-lon").inputValue()),
      };

      // Grab the pin where the camera is actually drawing it.
      const extent = await settledExtent(page);
      const box = await plannerMap(page).boundingBox();
      if (box === null) throw new Error("the planner map has no measured box");
      const grab = fractionOf(extent, pointBefore);
      const markerPixel = {
        x: Math.round(grab.x * box.width),
        y: Math.round(grab.y * box.height),
      };

      // A move of ~170 m west and ~165 m south: away from the start and from the
      // authored stops, so the preview's snap rule stays out of the way. Screen y
      // grows downward, so a southern latitude is a positive drag along it.
      const deltaLon = -0.002;
      const deltaLat = -0.0015;
      const drag = {
        x: Math.round((deltaLon / (extent.maxLon - extent.minLon)) * box.width),
        y: Math.round((-deltaLat / (extent.maxLat - extent.minLat)) * box.height),
      };

      const from = { x: box.x + markerPixel.x, y: box.y + markerPixel.y };
      const to = { x: from.x + drag.x, y: from.y + drag.y };
      const cdp = pointerType === "touch" ? await page.context().newCDPSession(page) : null;
      if (cdp !== null) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 0 }] });
        // Touch claims a pin only after the contract's 300 ms stationary hold.
        await page.waitForTimeout(350);
        for (let step = 1; step <= 6; step += 1) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
            x: from.x + drag.x * step / 6, y: from.y + drag.y * step / 6, id: 0,
          }] });
        }
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 6 });
      }

      // Mid-gesture: the ghost marker exists, and nothing has been authored — a drag
      // previews locally until the release commits it (05 §4).
      await expectDrawnScene(page, { preview: "1" });
      await expectPointValue(page, point.value, pointBefore);

      // Armed before the release; see `settleReplan`. The release is one command: the
      // planner is asked again for the new revision while the previous ride is still on
      // screen (04 §9, §21).
      const releaseInFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
      if (cdp !== null) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      else await page.mouse.up();
      await releaseInFlight;
      await expectDrawnScene(page, { routes: "2" });
      await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");

      // The ghost is gone, the point really moved, and it is still one point: the
      // same point, at the coordinate the rider released it over.
      const scene = await readDrawnScene(page);
      expect(scene.preview).toBe("0");
      const pointAfter = {
        lat: Number(await page.getByTestId("point-lat").inputValue()),
        lon: Number(await page.getByTestId("point-lon").inputValue()),
      };
      // It really moved (a tolerance this tight cannot pass on the old position)...
      expect(Math.abs(pointAfter.lon - pointBefore.lon)).toBeGreaterThan(0.0005);
      expect(Math.abs(pointAfter.lat - pointBefore.lat)).toBeGreaterThan(0.0005);
      // ...and it landed on the geography the pointer was released over.
      expectCoordinateNear(pointAfter, {
        lon: pointBefore.lon + deltaLon,
        lat: pointBefore.lat + deltaLat,
      });
      // The other endpoint is untouched: a drag moves one object.
      await expectPointValue(page, `${otherEndpoint}-value`, otherBefore);
      await expectPointValue(page, `label-${point.key}`, pointAfter);
      await expectHealthyMap(page);

      // The whole edit is one undo unit: a single press puts the point back.
      await page.getByTestId("undo").click();
      await expectPointValue(page, point.value, pointBefore);
    });
  }
}
