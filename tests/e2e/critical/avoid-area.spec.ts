import { expect, test, type Page } from "@playwright/test";

import {
  clickMapAtCoordinate,
  expectCoordinateNear,
  expectDrawnScene,
  expectHealthyMap,
  fractionOf,
  plannerMap,
  readCoordinate,
  settledExtent,
  type Coordinate, openRefine } from "./map-helpers";

/**
 * Avoid areas in a real browser (04-PLANNER-AND-WORKSPACE-UX §18, §20, §31;
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §4, §21).
 *
 * Everything here needs the renderer, the pointer stream and the network seam to
 * be real at once:
 *
 * - a **drag** authoring a rectangle is one gesture the interaction machine owns,
 *   and the release is what commits it (05 §4);
 * - the commit must **reach the provider request**: `/api/route-plan` runs in
 *   fixture mode, so the gate reads the body the browser actually sent and asserts
 *   the avoid ring is in it — the honest half of "routing honesty";
 * - the edit is **one undo unit**, and the same area can be removed from the list
 *   without the map (04 §31).
 *
 * The fixture answer is the canned line around Norristown (`first-route.spec.ts`),
 * so the ride is authored inside that area: the camera frames the committed route
 * and every coordinate below stays on screen.
 */

/**
 * The fixture answer takes 2 s (`OGV_ROUTE_PLAN_FIXTURE_DELAY_MS`) and this spec
 * deliberately plans several times — author, replan, undo, replan, remove,
 * replan — so the default 30 s budget is a wait bound, not a retry budget. Every
 * assertion below still has to hold.
 */
test.setTimeout(180_000);

const START_COORDINATE: Coordinate = { lon: -75.4385, lat: 40.1385 };
const DESTINATION_COORDINATE: Coordinate = { lon: -75.4335, lat: 40.1325 };

/** The two ends of a rectangle, in the camera's own geography. */
interface RectangleCorners {
  readonly southWest: Coordinate;
  readonly northEast: Coordinate;
}

/**
 * A rectangle centred on `centre`, `halfLon`/`halfLat` out on each axis.
 *
 * Derived rather than hard-coded: the gate authors its points by clicking a
 * fraction of a *moving* camera, so the ride's own coordinates are the only
 * reliable frame of reference for "over the route" or "over the start".
 */
function rectangleAround(
  centre: Coordinate,
  halfLon: number,
  halfLat: number,
): RectangleCorners {
  return {
    southWest: { lon: centre.lon - halfLon, lat: centre.lat - halfLat },
    northEast: { lon: centre.lon + halfLon, lat: centre.lat + halfLat },
  };
}

/** A rectangle spanning 70% of the gap between the two endpoints, so neither is in it. */
function rectangleOverTheRoute(start: Coordinate, finish: Coordinate): RectangleCorners {
  return rectangleAround(
    {
      lon: (start.lon + finish.lon) / 2,
      lat: (start.lat + finish.lat) / 2,
    },
    Math.abs(finish.lon - start.lon) * 0.35,
    Math.abs(finish.lat - start.lat) * 0.35,
  );
}

interface PostedRequest {
  readonly identity: { readonly rideRevision: number };
  readonly request: { readonly avoidPolygons: readonly (readonly Coordinate[])[] };
}

/** Every `/api/route-plan` body this page posted, in order. */
function recordPlanRequests(page: Page): PostedRequest[] {
  const bodies: PostedRequest[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes("/api/route-plan")) return;
    try {
      bodies.push(request.postDataJSON() as PostedRequest);
    } catch {
      // A body Playwright cannot decode is a gate failure of its own; the
      // assertion below then sees the gap rather than a silently missing entry.
      bodies.push({ identity: { rideRevision: -1 }, request: { avoidPolygons: [] } });
    }
  });
  return bodies;
}

/** A press → move → release on the map, in the camera's own geography. */
async function dragMapCoordinates(page: Page, corners: RectangleCorners): Promise<void> {
  const extent = await settledExtent(page);
  const map = plannerMap(page);
  const box = await map.boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");
  const toPixel = (coordinate: Coordinate) => {
    const fraction = fractionOf(extent, coordinate);
    return {
      x: box.x + Math.round(fraction.x * box.width),
      y: box.y + Math.round(fraction.y * box.height),
    };
  };
  const a = toPixel(corners.southWest);
  const b = toPixel(corners.northEast);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** Places both endpoints and plans the fixture ride, as `stops.spec.ts` does. */
async function planFixtureRide(page: Page): Promise<void> {
  await clickMapAtCoordinate(page, START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
}

/**
 * Waits for the answer of a replan whose in-flight copy the caller has already
 * armed.
 *
 * The two halves of "a replan ran" are asserted in two places on purpose. The
 * in-flight copy must be armed by the caller **before** the edit's own action:
 * under CPU load the action's call can outlast the fixture's 2 s window on its
 * own (see `map-helpers.ts` for the same reasoning about the camera), so a wait
 * started afterwards can miss a copy that was on screen the whole time. The
 * settled copy stays here: it is a terminal state, so it can be waited for
 * whenever it arrives.
 */
async function settleReplan(page: Page): Promise<void> {
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
}

/**
 * Waits for a replan that honestly fails, which is the *expected* outcome when the
 * rider fences the answer's own corridor: the fixture server evaluates the ring, so
 * every candidate is ineligible and the ride says so instead of drawing a route
 * through a place the rider forbade.
 *
 * Like `settleReplan`, it waits only for the terminal copy; the caller arms the
 * in-flight one before the edit.
 */
async function settleFailedReplan(page: Page): Promise<void> {
  await expect(page.getByTestId("status-line")).toHaveText(
    "Planning failed — your previous ride is still shown.",
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("a rectangle over the route is authored, reaches the request, and is undone and deleted from the list", async ({
  page,
}) => {
  const posted = recordPlanRequests(page);
  await planFixtureRide(page);

  // The baseline: the fixture plan carried no avoid rings, so a later one that
  // does is a real change and not an artifact of the harness.
  expect(posted).toHaveLength(1);
  expect(posted[0]?.request.avoidPolygons).toEqual([]);
  await expectDrawnScene(page, { areas: "0" });

  const startBefore = await readCoordinate(page, "start-value");
  const finishBefore = await readCoordinate(page, "finish-value");
  const corners = rectangleOverTheRoute(startBefore, finishBefore);

  // One drag, one new revision, one replan (04 §18, §21).
  await openRefine(page);
  await page.getByTestId("draw-rectangle").click();
  // Armed before the drag; see `settleReplan`.
  const fenceInFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  await dragMapCoordinates(page, corners);
  await fenceInFlight;
  await settleFailedReplan(page);

  // The fence is authored *and kept*: 04 §18 forbids a silent drop, and the
  // fixture server really does evaluate the ring, so fencing the answer's own
  // corridor surfaces the constraint the rider just wrote — the error shape in
  // the status surface, with the previous ride still drawn (04 §9).
  // The rider-facing code survives the client: the server answers
  // `constraint-conflict` for a ring that fences every candidate, and the status
  // surface says so rather than flattening it into "no legal route here"
  // (OGV-D-235). The previous ride stays drawn while it does (04 §9).
  await expect(page.getByTestId("planner-error")).toHaveText(
    "Your constraints leave no eligible route.",
  );

  // The polygon is on the map, in the list, and in the request the browser sent.
  await expectDrawnScene(page, { areas: "1" });
  await expect(page.getByTestId("avoid-area-row-0")).toBeVisible();
  await expect(page.getByTestId("corners-avoid-area-1")).toHaveText("4 corners");
  expect(posted.length).toBeGreaterThanOrEqual(2);
  const withArea = posted[posted.length - 1];
  expect(withArea?.identity.rideRevision).toBeGreaterThan(posted[0]?.identity.rideRevision ?? -1);
  expect(withArea?.request.avoidPolygons).toHaveLength(1);
  const ring = withArea?.request.avoidPolygons[0] ?? [];
  expect(ring).toHaveLength(5);
  // The ring is the rectangle the rider dragged: its own two corners are in it.
  expectCoordinateNear(ring[0] ?? corners.southWest, corners.southWest);
  expectCoordinateNear(ring[2] ?? corners.northEast, corners.northEast);
  // The drag authored a rectangle, not a camera move: both endpoints are untouched.
  expectCoordinateNear(await readCoordinate(page, "start-value"), startBefore);
  expectCoordinateNear(await readCoordinate(page, "finish-value"), finishBefore);

  // Undo crosses exactly one entry and the ride goes back to no area (03 §27,
  // 04 §20) — and the answer comes back, because the constraint is gone.
  // Armed before the press; see `settleReplan`.
  const undoInFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  await page.getByTestId("undo").click();
  await undoInFlight;
  await settleReplan(page);
  await expectDrawnScene(page, { areas: "0" });
  await expect(page.getByTestId("avoid-areas-empty")).toBeVisible();
  expect(posted[posted.length - 1]?.request.avoidPolygons).toEqual([]);
  expect(posted[posted.length - 1]?.identity.rideRevision).toBeGreaterThan(
    withArea?.identity.rideRevision ?? -1,
  );

  // Draw it again, then remove it from the list: the keyboard path is not a
  // fallback, it is the same object (04 §31).
  await openRefine(page);
  await page.getByTestId("draw-rectangle").click();
  await dragMapCoordinates(page, corners);
  await expectDrawnScene(page, { areas: "1" });

  await page.getByTestId("remove-avoid-area-1").click();
  await expectDrawnScene(page, { areas: "0" });
  await expect(page.getByTestId("avoid-areas-empty")).toBeVisible();
  await expect(page.getByTestId("avoid-area-row-0")).toHaveCount(0);
  // The endpoints were never a casualty of the area.
  expectCoordinateNear(await readCoordinate(page, "start-value"), startBefore);
  expectCoordinateNear(await readCoordinate(page, "finish-value"), finishBefore);
  await expectHealthyMap(page);
});

test("an area over the start raises the conflict surface, which never resolves it for the rider", async ({
  page,
}) => {
  await planFixtureRide(page);
  const startBefore = await readCoordinate(page, "start-value");
  await openRefine(page);
  await page.getByTestId("draw-rectangle").click();
  // Armed before the drag; see `settleReplan`.
  const conflictInFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  await dragMapCoordinates(page, rectangleAround(startBefore, 0.001, 0.001));
  await conflictInFlight;
  await settleReplan(page);

  // The notice and the three explicit actions (04 §18), and *nothing* moved.
  const conflict = page.getByTestId("avoid-conflict-panel");
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("Route cannot pass through this area");
  await expect(page.getByTestId("avoid-conflict-0")).toContainText("contains your start");
  await expect(page.getByTestId("conflict-move-0")).toBeVisible();
  await expect(page.getByTestId("conflict-edit-0")).toBeVisible();
  await expect(page.getByTestId("conflict-remove-0")).toBeVisible();
  await expectDrawnScene(page, { areas: "1", points: "2" });

  // Move endpoint: the placement is armed and the instruction says what the next
  // tap does. The endpoint itself has not moved yet.
  await page.getByTestId("conflict-move-0").click();
  await expect(page.getByTestId("map-hint")).toHaveText("Tap the map to set your start.");
  await expectDrawnScene(page, { areas: "1" });
  expectCoordinateNear(await readCoordinate(page, "start-value"), startBefore);

  // Edit area: the corner editor is armed for that area.
  await page.getByTestId("conflict-edit-0").click();
  await expect(page.getByTestId("vertices-avoid-area-1")).toHaveAttribute("data-armed", "true");

  // Remove area: one press, and the conflict goes with the area.
  // Armed before the press; see `settleReplan`.
  const conflictRemoveInFlight = expect(page.getByTestId("status-line")).toHaveText(
    "Updating ride…",
  );
  await page.getByTestId("conflict-remove-0").click();
  await conflictRemoveInFlight;
  await settleReplan(page);
  await expect(conflict).toHaveCount(0);
  await expectDrawnScene(page, { areas: "0" });
  expectCoordinateNear(await readCoordinate(page, "start-value"), startBefore);
  await expectHealthyMap(page);
});

/**
 * The touch dead-band probe (2026-09-17): the attribution pill used to sit along
 * the map's lower edge and swallow taps in a ~40 px band.
 *
 * The critical gate draws the `empty` basemap, which has no attribution at all
 * (05 §23), so the band can only be asserted as the property that matters: a tap
 * near the map's lower edge reaches the **map**, not an overlay, and it authors a
 * point. The host's own control is created compact (`{ compact: true }`) for a
 * basemap that does have attribution, and the unit guard beside this gate fails if
 * that regresses.
 */
test.describe("the lower band of the map swallows nothing on a touch viewport", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });

  test("a tap near the map's lower edge still reaches the map", async ({ page }) => {
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);

    const dock = page.getByTestId("planner-dock");
    const dockBox = await dock.boundingBox();
    const mapBox = await plannerMap(page).boundingBox();
    if (dockBox === null || mapBox === null) throw new Error("the composition has no measured box");

    // The band the attribution used to occupy: just above the sheet, at the map's
    // right edge.
    const point = {
      x: Math.round(mapBox.x + mapBox.width - 24),
      y: Math.round(dockBox.y - 14),
    };
    const hit = await page.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return {
          inMap: element?.closest('[data-testid="planner-map"]') !== null,
          tag: element?.tagName ?? null,
        };
      },
      point,
    );
    expect(hit.inMap, `the band is owned by ${String(hit.tag)}`).toBe(true);

    // …and the tap really is authored by the map: the first unarmed tap places the
    // start (OGV-D-213), so a swallowed tap would leave the composer untouched.
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
    await expectDrawnScene(page, { points: "1" });
    await expectHealthyMap(page);
  });
});
