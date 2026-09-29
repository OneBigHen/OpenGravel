import { expect, test } from "@playwright/test";

import {
  EMBER,
  EMBER_STRONG,
  MUTED_ALTERNATIVE,
  clickMapAtCoordinate,
  countColors,
  dragMap,
  cameraGeneration,
  expectCoordinateNear,
  expectDrawnScene,
  expectHealthyMap,
  expectPointValue,
  expectVendoredModulesServed,
  parseCoordinate,
  plannerMap,
  readCoordinate,
  readDrawnScene,
  readMapErrorKinds,
  settledExtent,
  type Coordinate,
} from "./map-helpers";

/**
 * Critical browser workflow #1 (16-TEST-AND-RELEASE-GATES §6 #1, with the
 * cancellation requirement of §6 #10):
 *
 * > explicit start → destination → a route is visible and selectable
 *
 * It runs against the production build the `webServer` in `playwright.config.ts`
 * starts, in **fixture mode** (`OGV_ROUTE_PLAN_FIXTURE=1`), so the plan answer is
 * a canned, labeled fixture rather than a router — and in **empty basemap mode**
 * (`NEXT_PUBLIC_OGV_BASEMAP=empty`), so the gate never depends on a tile server.
 * The last test in this file proves the fixture claim by asking the running
 * deployment directly and failing if the answer does not say `FIXTURE`.
 *
 * ## What changed with the real renderer (task 4.0)
 *
 * The placeholder SVG host is gone; the map is MapLibre GL. So this spec no longer
 * addresses SVG elements, and it no longer clicks fixed fractions of a fixed
 * `viewBox`:
 *
 * - **Clicks are measured against the rendered extent.** The host publishes
 *   `data-map-extent` (see `map-helpers.ts` for the documented inversion), the
 *   spec clicks a fraction of the visible map, and asserts the coordinate the app
 *   derived from that fraction. A click position is a whole CSS pixel, which is
 *   ≤0.003° over these extents — an order of magnitude inside the 0.01° tolerance.
 * - **Route styling is asserted from pixels.** The selected route is Ember over an
 *   Ember-Strong casing and the alternative is muted slate; now that they are
 *   drawn into a WebGL canvas, a screenshot colour census is the only honest form
 *   of that assertion, so it is the one used here.
 * - **What is drawn is asserted from the scene attribute**, which the host
 *   publishes from the scene it applied.
 */

/**
 * Where the ride is authored, in geography rather than in pixels.
 *
 * The fixture answer is a canned line around Norristown, Montgomery County
 * (`tests/fixtures/route-plan/candidates-basic.json`, ~700 m by 1.1 km), and it
 * does not follow the rider's points — that is what "labeled fixture" means. So
 * the taps are placed *inside* that area: the committed route is then what the
 * camera frames, which is also what makes the pixel assertions below meaningful.
 * A ride authored half a state away would frame the two placed points instead and
 * render the fixture line as a speck.
 */
const START_COORDINATE: Coordinate = { lon: -75.4385, lat: 40.1385 };
const DESTINATION_COORDINATE: Coordinate = { lon: -75.4335, lat: 40.1325 };

/** The route cards currently rendered (`route-card-<role>`). */
function routeCards(page: import("@playwright/test").Page) {
  return page.locator('[data-testid^="route-card-"]');
}

function mapCanvas(page: import("@playwright/test").Page) {
  return plannerMap(page).locator("canvas");
}

function mapColorMasks(page: import("@playwright/test").Page) {
  // The wide tier's rail and inspector float over the map (UX rework phase 7).
  return [
    page.getByRole("button", { name: "Describe your ride" }),
    page.getByTestId("planner-dock"),
    page.locator(".og-planner__inspector"),
  ];
}

const START_LABEL = "No start yet";
const FINISH_LABEL = "No destination yet";

/** Places both endpoints and returns the coordinates the app actually recorded. */
async function placeBothEndpoints(page: import("@playwright/test").Page): Promise<{
  readonly start: Coordinate;
  readonly destination: Coordinate;
  readonly startClick: Coordinate;
  readonly destinationClick: Coordinate;
}> {
  await clickMapAtCoordinate(page, START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText(START_LABEL);
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText(FINISH_LABEL);
  return {
    start: await readCoordinate(page, "start-value"),
    destination: await readCoordinate(page, "finish-value"),
    startClick: START_COORDINATE,
    destinationClick: DESTINATION_COORDINATE,
  };
}

/** Places both endpoints and plans the ride the fixture answers. */
async function planFixtureRide(page: import("@playwright/test").Page): Promise<void> {
  await placeBothEndpoints(page);
  await page.getByTestId("compose-create").click();
  await expect(routeCards(page)).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  // The renderer is up when it has published the camera it opened with.
  await settledExtent(page);
});

test("idle: the planner asks for a start and refuses to plan without one", async ({
  page,
}) => {
  await expect(page.getByTestId("start-value")).toHaveText(START_LABEL);
  await expect(page.getByTestId("finish-value")).toHaveText(FINISH_LABEL);

  // One instruction at a time (OGV-D-214): the status line reports the plan's
  // state and the composer's disabled reason is the single instruction, so the
  // map overlay stays quiet even though the first tap will place a start.
  await expect(page.getByTestId("status-line")).toHaveText("No plan yet.");
  await expect(page.getByTestId("map-hint")).toHaveCount(0);
  await expect(page.getByTestId("start-chip")).toHaveText("Set start on map");

  await expect(routeCards(page)).toHaveCount(0);
  await expectDrawnScene(page, { routes: "0", points: "0" });
  // The baseline for the pixel census later in this file: an empty map contains
  // none of the cartography colours.
  // Mask the advisor toggle because an element screenshot is composited from
  // the page and includes fixed controls that overlap the WebGL canvas.
  const idleColors = await countColors(mapCanvas(page), {
    casing: EMBER_STRONG,
    ember: EMBER,
    mutedAlternative: MUTED_ALTERNATIVE,
  }, 20, mapColorMasks(page));
  expect(idleColors.casing ?? 0).toBe(0);
  expect(idleColors.ember ?? 0).toBe(0);
  expect(idleColors.mutedAlternative ?? 0).toBe(0);

  // The basemap the gate asked for is the deterministic one: no tile request can
  // make this run red, and the assertion is the proof.
  await expect(plannerMap(page)).toHaveAttribute("data-basemap", "empty");

  const plan = page.getByTestId("compose-create");
  await expect(plan).toHaveText("Create ride");
  await expect(plan).toBeDisabled();
  await expect(page.getByTestId("plan-disabled-reason")).toHaveText(
    "Search for a start, or set it on the map.",
  );

  // Arming the tool for the very point that blocks planning is visibly armed on
  // the chip and adds no second instruction: the reason already says it.
  await page.getByTestId("start-chip").click();
  await expect(page.getByTestId("start-chip")).toHaveAttribute("data-armed", "true");
  await expect(page.getByTestId("map-hint")).toHaveCount(0);
  await expect(page.getByTestId("plan-disabled-reason")).toHaveText(
    "Search for a start, or set it on the map.",
  );
});

test("placing a start and a destination records exactly the clicked coordinates", async ({
  page,
}) => {
  const { start, destination, startClick, destinationClick } =
    await placeBothEndpoints(page);

  expectCoordinateNear(start, startClick);
  expectCoordinateNear(destination, destinationClick);
  // The two clicks are two different places, so a test that "passed" by
  // resolving both to one coordinate would fail here.
  expect(start.lat).not.toBeCloseTo(destination.lat, 2);

  // The composer names the placed point and shows its coordinate as the
  // secondary value, at the renderer's precision (the value cell wraps rather
  // than truncating — owner review 2026-09-17; a raw coordinate is not a place
  // name — owner review 2026-09-21).
  await expectPointValue(page, "start-value", start);
  await expectPointValue(page, "finish-value", destination);
  await expectDrawnScene(page, { points: "2" });

  const plan = page.getByTestId("compose-create");
  await expect(plan).toBeEnabled();
  await expect(plan).toHaveText("Create ride");
  await expect(page.getByTestId("plan-disabled-reason")).toHaveCount(0);
  await expect(page.getByTestId("status-line")).toHaveText("Ready to plan.");

  // With both points authored nothing blocks planning, so an armed tool is what
  // the map instructs — as a note over the surface, never as a control, and in
  // phone-first wording (OGV-D-214).
  await page.getByTestId("finish-chip").click();
  const hint = page.getByTestId("map-hint");
  await expect(hint).toHaveText("Tap the map to set your destination.");
  await expect(hint).toHaveAttribute("role", "note");
  expect(await hint.evaluate((element) => element.tagName)).not.toBe("BUTTON");
  await expect(page.getByTestId("finish-chip")).toHaveAttribute("data-armed", "true");
});

test("dragging the map pans it and never places a point", async ({ page }) => {
  // 05 §4: a release has exactly one outcome. A drag is a camera gesture, so the
  // composer must still have nothing authored — and the camera must have moved,
  // which is what proves the drag reached the renderer at all.
  const before = await cameraGeneration(page);
  await dragMap(page, { x: 0.5, y: 0.35 }, { dx: 90, dy: 60 });
  await expect.poll(async () => cameraGeneration(page), { timeout: 5000 }).toBeGreaterThan(
    before,
  );

  await expect(page.getByTestId("start-value")).toHaveText(START_LABEL);
  await expect(page.getByTestId("finish-value")).toHaveText(FINISH_LABEL);
  expect((await readDrawnScene(page)).points).toBe("0");

  // A rider pan/zoom suspends automatic fit (05 §8), so a plan must not move the
  // camera out from under them; the hand-back is an explicit control.
  await page.getByTestId("start-chip").click();
  await clickMapAtCoordinate(page, START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText(START_LABEL);
});

test("planning shows a route the rider can see and select", async ({ page }) => {
  await placeBothEndpoints(page);
  // Armed before the press that starts the first plan: the press's own `click` call
  // can outlast the fixture's window under CPU load (see `map-helpers.ts`).
  const firstPlanInFlight = expect(page.getByTestId("status-line")).toHaveText(
    "Finding your ride…",
  );
  await page.getByTestId("compose-create").click();
  await firstPlanInFlight;

  // The in-flight state is visible while the fixture latency window is open.
  await expect(page.getByTestId("cancel-planning")).toBeVisible();

  await expect(routeCards(page)).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");

  // Exactly one card is marked, and it is the automatic recommendation. The
  // role *name* comes from the documented placeholder mirror (OGV-D-183): the
  // client pipeline assigns no roles until the client-side rollout lands. The
  // bundle is ordered as a ranking (06 §14 MMR, task 3.2), so the selected card
  // is the first one — the fixture's faster, higher-scoring line — and the
  // added time is shown on the slower alternative.
  const selectedCard = page.locator('[data-testid^="route-card-"][aria-pressed="true"]');
  await expect(selectedCard).toHaveCount(1);
  await expect(selectedCard).toContainText("Best Ride");
  await expect(page.getByTestId("route-card-alternative")).toContainText("Alternative");
  await expect(page.getByTestId("route-card-alternative")).toContainText(
    "+2 min vs Fastest",
  );
  // An unverified surface is stated once under the list, not badged per card.
  await expect(page.getByTestId("route-badge")).toHaveCount(0);
  await expect(page.getByTestId("route-unknowns-note")).toContainText("surface");

  // The renderer was given two routes and selected one of them (05 §11), and the
  // camera framed it: this is the auto-fit of 05 §8, which the rider has not
  // overridden.
  await expectDrawnScene(page, { routes: "2", points: "2" });
  expect((await readDrawnScene(page)).selected).not.toBe("none");
  // Nothing about the cartography silently failed to load (05 §22).
  await expectHealthyMap(page);

  // Pixel evidence for the cartography (05 §11): the selected route is Ember over
  // its Ember-Strong casing, and the alternative is muted slate. A DOM assertion
  // cannot make this claim any more — the drawing is a WebGL canvas — and the
  // *idle* census in the same test is what proves the colours are the route's and
  // not the chrome's (it is all zeros before anything is drawn).
  const drawnColors = await countColors(mapCanvas(page), {
    casing: EMBER_STRONG,
    ember: EMBER,
    mutedAlternative: MUTED_ALTERNATIVE,
  }, 20, mapColorMasks(page));
  expect(drawnColors.casing ?? 0).toBeGreaterThan(500);
  expect(drawnColors.ember ?? 0).toBeGreaterThan(500);
  expect(drawnColors.mutedAlternative ?? 0).toBeGreaterThan(500);

  // A fixture answer is not a failure, and nothing claims a provider error.
  await expect(page.getByTestId("planner-error")).toHaveCount(0);
});

test("selecting the other card moves the selection and the drawn route", async ({ page }) => {
  await planFixtureRide(page);

  const cards = routeCards(page);
  await expect(cards).toHaveCount(2);
  // Bundle order is the recommendation order (06 §14 MMR, task 3.2), and the
  // fixture's faster line scores highest, so it is recommended first.
  const recommended = cards.nth(0);
  const other = cards.nth(1);

  await expect(recommended).toHaveAttribute("aria-pressed", "true");
  // Before a rider picks, the two cards hold two different roles, so the hooks
  // are unique and name the decision.
  await expect(page.getByTestId("route-card-best-ride")).toHaveCount(1);
  await expect(page.getByTestId("route-card-alternative")).toHaveCount(1);
  // The renderer has been handed the route before its selection is read.
  await expectDrawnScene(page, { routes: "2" });
  const selectedBefore = (await readDrawnScene(page)).selected;
  expect(selectedBefore).not.toBe("none");

  await page.getByTestId("route-card-alternative").click();

  await expect(other).toHaveAttribute("aria-pressed", "true");
  await expect(other).toHaveAttribute("data-selected", "true");
  await expect(recommended).toHaveAttribute("aria-pressed", "false");

  // The card that is now selected is the slower, curvier fixture line: 245 s
  // against the recommended 155 s.
  await expect(other.getByTestId("route-duration")).toHaveText("4 min");
  await expect(recommended.getByTestId("route-duration")).toHaveText("3 min");

  // Roles belong to the routes, not to the selection (OGV-D-183): the
  // recommendation keeps its "Best Ride" label while the rider looks at the
  // other card, and the rider's pick is never relabelled as the recommendation.
  await expect(cards.nth(0)).toContainText("Best Ride");
  await expect(cards.nth(1)).not.toContainText("Best Ride");
  await expect(page.getByTestId("route-card-best-ride")).toHaveAttribute("aria-pressed", "false");

  // The selection really moved the drawn route: the renderer was handed a
  // different candidate as selected, and it still draws both lines.
  await expectDrawnScene(page, { routes: "2" });
  expect((await readDrawnScene(page)).selected).not.toBe(selectedBefore);
  await expectHealthyMap(page);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
});

test("cancelling inside the latency window keeps the last route on screen", async ({ page }) => {
  await planFixtureRide(page);

  // Author a deliberate edit: a new destination is a new revision, so the next
  // plan is an update of a ride that already has an answer. The tap is placed in
  // the corner of the visible map, away from the drawn route, so it is a
  // placement rather than a selection.
  await page.getByTestId("finish-chip").click();
  // Armed before the tap: the tap's own `click` call can outlast the fixture's 2 s
  // window under CPU load (see `map-helpers.ts`), and the in-flight copy is exactly
  // what this test cancels inside.
  const inFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await inFlight;
  const plan = page.getByTestId("compose-create");
  await expect(plan).toHaveText("Update ride");

  // The edit itself asks again (04 §21): a ride whose revision moved past the
  // answer on screen is replanned by the workspace, so the rider does not have to
  // press the commitment button to see an honest route. The fixture's latency
  // window is what makes the in-flight state observable.
  const cancel = page.getByTestId("cancel-planning");
  await expect(cancel).toBeVisible();
  await cancel.click();

  // A cancel is neither a success nor a failure: the previous ride stays, and
  // the status says which of the two it is showing (06 §28).
  await expect(page.getByTestId("status-line")).toHaveText(
    "Planning cancelled — showing your last ride.",
  );
  await expect(page.getByTestId("planner-error")).toHaveCount(0);
  await expect(page.getByTestId("cancel-planning")).toHaveCount(0);
  await expect(routeCards(page)).toHaveCount(2);
  await expectDrawnScene(page, { routes: "2" });
  await expect(plan).toBeEnabled();
  await expect(plan).toHaveText("Update ride");
});

test("the rider can hand the camera back with Show whole ride", async ({ page }) => {
  await planFixtureRide(page);

  // 05 §8: after a rider pan, automatic fit is suspended; the explicit action is
  // what frames the ride again. The camera generation is the observable effect.
  await dragMap(page, { x: 0.5, y: 0.35 }, { dx: 120, dy: 90 });
  const showWholeRide = page.getByTestId("show-whole-ride");
  await expect(showWholeRide).toBeVisible();

  const before = await cameraGeneration(page);
  await showWholeRide.click();
  await expect.poll(async () => cameraGeneration(page), { timeout: 5000 }).toBeGreaterThan(
    before,
  );
  // The hand-back did not blank the drawing.
  await expectDrawnScene(page, { routes: "2" });
});

test("the deployment serves the vendored renderer modules and draws with them", async ({
  page,
}) => {
  // 4.0 review finding 1. The layer-error attribute cannot see a worker 404: the
  // map renders its background, `data-basemap` and `data-map-scene` stay present,
  // and every GeoJSON source stays unparsed — a green gate over a blank map. So
  // the gate asks for both modules itself, fails on any renderer failure the host
  // published, and then proves a real drawing still happens with those modules in
  // place.
  await expectVendoredModulesServed(page);
  expect(await readMapErrorKinds(page)).toEqual([]);

  await planFixtureRide(page);

  await expectDrawnScene(page, { routes: "2", points: "2" });
  await expectHealthyMap(page);
  expect(await readMapErrorKinds(page)).toEqual([]);
});

test("the running deployment labels its fixture answers and never as live", async ({
  page,
}) => {
  // The plan-service fixture gate (run in FIXTURE mode by `playwright.config.ts`).
  const response = await page.request.post("/api/route-plan", {
    data: {
      identity: { rideId: "ride_e2e_fixture", rideRevision: 1, planningGeneration: 1 },
      request: {
        requestId: "req_e2e_fixture",
        origin: parseCoordinate("39.9500, -75.2000"),
        destination: parseCoordinate("40.2000, -74.8000"),
        stops: [],
        shaping: [],
        profile: "motorcycle_adventure",
        avoidPolygons: [],
        options: {
          includeAlternatives: true,
          avoidHighways: false,
          tollPolicy: "avoid",
          vehicle: "motorcycle",
        },
      },
    },
  });

  expect(response.status()).toBe(200);

  // Asserted, not trusted: the shape is read defensively and the assertions
  // below are what makes it a fixture answer.
  const body = (await response.json()) as unknown as {
    readonly bundle: {
      readonly candidates: readonly {
        readonly provider: { readonly providerId: string };
      }[];
    };
    readonly diagnostics: {
      readonly providers?: readonly {
        readonly providerId: string;
        readonly outcome: string;
        readonly note: string;
      }[];
    };
  };

  expect(body.bundle.candidates).toHaveLength(2);
  expect(body.diagnostics.providers).toEqual([
    { providerId: "fixture", outcome: "ok", note: "FIXTURE — not a live router" },
  ]);
  for (const candidate of body.bundle.candidates) {
    expect(candidate.provider.providerId).toBe("fixture");
  }
});
