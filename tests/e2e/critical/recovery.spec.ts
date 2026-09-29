import { expect, test, type Page } from "@playwright/test";

import {
  clickMapAtCoordinate,
  expectDrawnScene,
  expectHealthyMap,
  fractionOf,
  plannerMap,
  readCoordinate,
  readDrawnScene,
  settledExtent,
  type Coordinate, openRefine } from "./map-helpers";

/**
 * Critical browser workflow: a bad network during an edit (04-PLANNER-AND-WORKSPACE-UX
 * §9, §20, §21; 05-MAP-INTERACTION-AND-CARTOGRAPHY §11, §12; 22-END-TO-END-ACCEPTANCE-
 * MISSIONS Mission 8).
 *
 * Mission 8's pass conditions are four sentences, and every one of them needs the
 * whole stack: *the old route stays*, *the failed edit is understandable*, *retry
 * works*, *no phantom success*. Nothing in jsdom can prove them together — the route's
 * dimmed previous treatment and the dashed changed-span emphasis are WebGL layers, the
 * drag is a real pointer stream, and the failure is a real 422 from the wire.
 *
 * ## How the network is made bad, and then good again
 *
 * The gate runs the server in fixture mode (`playwright.config.ts`), so a plan is
 * deterministic. The failure is an **interception** rather than an environment switch,
 * for the reason `draw.spec.ts` documents: it has to hit exactly one attempt so the
 * retry after it can succeed, and a server-wide switch would need a
 * request-addressable flag no deployment should carry. The recovery is the same
 * technique in the other direction — the next answer is the fixture's own body with a
 * materially different line and a larger duration/distance, so "the update changed
 * nothing measurable" cannot pass this gate by accident.
 *
 * The client cannot tell the difference: it sees the same wire bodies the contract
 * defines, and every assertion reads the app's own `data-*` seam rather than pixels.
 */

/**
 * The fixture takes 2 s per plan and these tests plan three times each, so the default
 * 30 s budget is a wait bound, not a retry budget.
 */
test.setTimeout(300_000);

const START_COORDINATE: Coordinate = { lon: -75.4385, lat: 40.1385 };
const DESTINATION_COORDINATE: Coordinate = { lon: -75.4335, lat: 40.1325 };
/**
 * Well clear of the fixture route's own corridor (~700 m west), for the reason
 * `stops.spec.ts` documents: a tap that lands *on* the drawn line is a tap on an
 * object, and whether it is taken as one depends on the renderer's hit test — a
 * placement that sometimes selects the route instead is a flake, not a test.
 */
const STOP_COORDINATE: Coordinate = { lon: -75.442, lat: 40.141 };

/** The label the failed stop drag carries into the banner (04 §20's wording). */
const ATTEMPTED_LABEL = "Move stop";
const FAILURE_COPY = "No legal route to this destination — try another point.";

/** Places both endpoints and plans the fixture ride. */
async function planFixtureRide(page: Page): Promise<void> {
  await clickMapAtCoordinate(page, START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
}

/** Adds one stop through the panel's own place mode and a tap. */
async function addStop(page: Page, coordinate: Coordinate): Promise<void> {
  await openRefine(page);
  await page.getByTestId("add-stop").click();
  // The in-flight assertion is armed *before* the tap. The fixture takes 2 s, and
  // the tap's own `click` call can take as long under CPU load — measured 1.9 s on
  // the 2026-09-18 loaded-host run, with the replan's 2.03 s resolve landing inside
  // that call — so a wait started after the tap can miss an in-flight copy that was
  // on screen the whole time. Arming it first asserts exactly the same thing (the
  // in-flight copy must appear) and cannot lose the window.
  const inFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  // Handled while the count check below runs first, so a missed tap still fails
  // with the clearer message and never as an unhandled rejection.
  inFlight.catch(() => undefined);
  await clickMapAtCoordinate(page, coordinate);
  // The list is the app's own statement that the tap authored the stop; asserting
  // it first keeps a missed tap from being reported as a missing replan.
  await expect(page.locator('[data-testid^="point-row-stop-"]')).toHaveCount(1);
  await inFlight;
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
}

/**
 * Drags the first stop through a real pointer stream (05 §4, §15).
 *
 * The grab is aimed with the app's own full-precision repository of the object
 * (`point-lat`/`point-lon`) rather than the list's four-decimal label, exactly as
 * `stops.spec.ts` does: at this zoom a four-decimal miss is enough to slide off the
 * marker, and the gate would then be testing a tap on the surface.
 *
 * The drag deliberately does **not** wait for the replan: the caller decides whether
 * that answer arrives (a fixture success) or fails (an interception).
 */
async function dragStop(page: Page): Promise<void> {
  await page.getByTestId("select-stop-1").click();
  const before = {
    lat: Number(await page.getByTestId("point-lat").inputValue()),
    lon: Number(await page.getByTestId("point-lon").inputValue()),
  };

  const extent = await settledExtent(page);
  const box = await plannerMap(page).boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");
  const grab = fractionOf(extent, before);
  const origin = {
    x: Math.round(grab.x * box.width),
    y: Math.round(grab.y * box.height),
  };

  // ~170 m west and ~220 m south: far enough that the preview cannot snap onto the
  // endpoints, and short enough to stay inside the rendered extent.
  const deltaLon = -0.0015;
  const deltaLat = -0.0012;
  const drag = {
    x: Math.round((deltaLon / (extent.maxLon - extent.minLon)) * box.width),
    y: Math.round((deltaLat / (extent.maxLat - extent.minLat)) * box.height),
  };

  await page.mouse.move(box.x + origin.x, box.y + origin.y);
  await page.mouse.down();
  await page.mouse.move(box.x + origin.x + drag.x, box.y + origin.y + drag.y, { steps: 6 });
  await page.mouse.up();

  return;
}

/**
 * Makes the **next** plan answer fail with the wire contract's own 422 `no-route`
 * body — the "network dropped" of Mission 8, as the client sees it.
 */
async function failNextPlan(page: Page): Promise<void> {
  let spent = false;
  await page.route("**/api/route-plan", async (route) => {
    if (spent) {
      await route.continue();
      return;
    }
    spent = true;
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      headers: { "cache-control": "private, no-store" },
      body: JSON.stringify({
        error: { code: "no-route", message: FAILURE_COPY, recoverable: false },
      }),
    });
  });
}

/**
 * Lets the **next** plan answer succeed with a materially different route.
 *
 * The body is the fixture's own (so the shape is the server's, not the gate's) with
 * the line moved ~350 m west, three more minutes and 1.8 more miles — i.e. exactly the
 * "+3 min · +1.8 mi vs previous" the chip must state. Everything after the first answer
 * is passed through untouched.
 */
async function shiftNextPlan(page: Page): Promise<void> {
  let spent = false;
  await page.route("**/api/route-plan", async (route) => {
    if (spent) {
      await route.continue();
      return;
    }
    spent = true;
    const response = await route.fetch();
    const body = (await response.json()) as {
      bundle?: {
        candidates: {
          geometry: Coordinate[];
          distanceMeters: number;
          durationSeconds: number;
          fingerprint: string;
        }[];
      };
    };
    if (body.bundle === undefined) {
      await route.fulfill({ response });
      return;
    }
    for (const candidate of body.bundle.candidates) {
      candidate.geometry = candidate.geometry.map((point) => ({
        lon: point.lon - 0.004,
        lat: point.lat - 0.002,
      }));
      candidate.durationSeconds += 180;
      candidate.distanceMeters += 2897;
      // A different line is a different fingerprint: the client must not treat the
      // recovery's answer as the candidate it already had.
      candidate.fingerprint = `${candidate.fingerprint}:recovery`;
    }
    await route.fulfill({
      status: response.status(),
      contentType: "application/json",
      headers: { "cache-control": "private, no-store" },
      body: JSON.stringify(body),
    });
  });
}

/** Waits for the honest failed-update state (04 §21). */
async function settleFailedUpdate(page: Page): Promise<void> {
  await expect(page.getByTestId("status-line")).toHaveText(
    "Planning failed — your previous ride is still shown.",
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("a dropped network during an edit keeps the old route and names the failed change", async ({
  page,
}) => {
  await planFixtureRide(page);
  await addStop(page, STOP_COORDINATE);
  await expectDrawnScene(page, { routes: "2", points: "3", previous: "0" });

  // Mission 8: the network drops as the rider moves the stop.
  await failNextPlan(page);
  await dragStop(page);
  await settleFailedUpdate(page);

  // 1. The old route stays — drawn as the *previous* answer, not as the rider's
  //    (05 §11), and nothing claims to be selected.
  await expectDrawnScene(page, { routes: "2", selected: "none", previous: "2" });
  // No phantom success: no delta chip and no changed-span emphasis can appear for an
  // update that never landed (05 §12).
  await expectDrawnScene(page, { changedSpan: "0" });
  await expect(page.getByTestId("route-delta-chip")).toHaveCount(0);

  // 2. The failed edit is understandable: the attempted change is named, the failure
  //    is stated, and the ride is still there.
  const banner = page.getByTestId("update-failure-banner");
  await expect(banner).toBeVisible();
  await expect(page.getByTestId("update-failure-label")).toHaveText(ATTEMPTED_LABEL);
  await expect(page.getByTestId("update-failure-message")).toHaveText(FAILURE_COPY);
  await expect(banner).toContainText("Your previous ride is still on the map.");

  // 3. The three §21 actions are offered, keyboard-reachable, and honest about what
  //    this failure can do: the stop moved, so all three are available.
  await expect(page.getByTestId("update-retry")).toBeEnabled();
  await expect(page.getByTestId("update-edit")).toBeEnabled();
  await expect(page.getByTestId("update-discard")).toBeEnabled();

  // The edit really happened locally (the rider's intent is kept) and the route on
  // screen is the pre-edit one.
  await expect(page.getByTestId("label-stop-1")).not.toHaveText(
    `${STOP_COORDINATE.lat.toFixed(4)}, ${STOP_COORDINATE.lon.toFixed(4)}`,
  );
  await expectHealthyMap(page);
});

test("Retry after the network returns replaces the route and highlights what changed", async ({
  page,
}) => {
  await planFixtureRide(page);
  await addStop(page, STOP_COORDINATE);
  await failNextPlan(page);
  await dragStop(page);
  await settleFailedUpdate(page);

  // Mission 8's third condition: retry works. The failure is spent, so the recovery
  // answer is the one the retry hits.
  await page.unroute("**/api/route-plan");
  await shiftNextPlan(page);
  await page.getByTestId("update-retry").click();

  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await expect(page.getByTestId("update-failure-banner")).toHaveCount(0);

  // The new answer replaces the old one (05 §11)…
  await expectDrawnScene(page, { routes: "2", previous: "0" });
  // …its changed section is emphasised (05 §12), drawn above the selected route…
  await expectDrawnScene(page, { changedSpan: "1" });
  // …and the delta is stated in the route summary's own units.
  await expect(page.getByTestId("route-delta-chip")).toHaveText("+3 min · +1.8 mi vs previous");
  await expectHealthyMap(page);
});

test("Discard change returns the ride to what it was before the failed edit", async ({ page }) => {
  await planFixtureRide(page);
  await addStop(page, STOP_COORDINATE);
  const before = await readCoordinate(page, "label-stop-1");

  await failNextPlan(page);
  await dragStop(page);
  await settleFailedUpdate(page);
  await expect(page.getByTestId("update-failure-banner")).toBeVisible();

  // Mission 8's fourth condition: no phantom success — and one action back to the ride
  // the rider had (04 §20: the prior RideDocument, not just the point).
  await page.getByTestId("update-discard").click();

  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await expect(page.getByTestId("update-failure-banner")).toHaveCount(0);
  const restored = await readCoordinate(page, "label-stop-1");
  expect(restored.lat).toBeCloseTo(before.lat, 3);
  expect(restored.lon).toBeCloseTo(before.lon, 3);
  // The undo moved the cursor, not the redo tail: the rider can still redo the move.
  const scene = await readDrawnScene(page);
  expect(scene.routes).toBe("2");
  await expect(page.getByTestId("redo")).toBeVisible();
  await expectHealthyMap(page);
});
