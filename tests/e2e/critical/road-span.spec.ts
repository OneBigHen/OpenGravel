import { expect, test, type Page } from "@playwright/test";

import {
  clickMapAtCoordinate,
  expectDrawnScene,
  expectHealthyMap,
  fractionOf,
  plannerMap,
  settledExtent,
  type Coordinate, openRefine } from "./map-helpers";

/**
 * Critical browser workflow: keep / prefer / avoid a road span
 * (16-TEST-AND-RELEASE-GATES §6; 04-PLANNER-AND-WORKSPACE-UX §17, §20;
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §4, §20).
 *
 * Everything here needs the renderer, the pointer stream, the document store and
 * the network seam to be real at once:
 *
 * - a **drag** across the route is one gesture the interaction machine owns, and
 *   the action-bar button is what commits it (05 §4);
 * - the commit must **reach the provider request**: `/api/route-plan` runs in
 *   fixture mode, so the gate reads the body the browser actually sent and asserts
 *   the required span's anchors are in it — the honest half of "routing honesty",
 *   exactly as `avoid-area.spec.ts` does for an avoid ring;
 * - the inspector's verdict is **measured against the returned route**, so a span
 *   taken from that route reads Satisfied rather than being assumed;
 * - the edit is **one undo unit**, and Undo brings the removed span back.
 *
 * The fixture answer is the canned line around Norristown (`first-route.spec.ts`),
 * so the span is dragged between the fixture's own endpoints: they are on screen
 * because the camera framed the committed route.
 */

/**
 * The fixture takes 2 s per plan (`OGV_ROUTE_PLAN_FIXTURE_DELAY_MS`) and this spec
 * plans several times — author, replan, remove, undo — so the default 30 s budget
 * is a wait bound, not a retry budget. Every assertion below still has to hold.
 */
test.setTimeout(180_000);

/** The fixture route's own endpoints, in the camera's geography. */
const ROUTE_START: Coordinate = { lon: -75.44, lat: 40.14 };
const ROUTE_END: Coordinate = { lon: -75.4328, lat: 40.131 };

/** A destination elsewhere in the fixture's area, for the replan step. */
const NEW_DESTINATION: Coordinate = { lon: -75.435, lat: 40.1335 };

/** A required span as the browser serialized it into the provider request. */
interface PostedSpan {
  readonly id: string;
  readonly mode: string;
  readonly direction: string;
  readonly anchors: readonly Coordinate[];
}

interface PostedRequest {
  readonly identity: { readonly rideRevision: number };
  readonly request: { readonly roadSpans?: readonly PostedSpan[] };
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
      bodies.push({ identity: { rideRevision: -1 }, request: {} });
    }
  });
  return bodies;
}

/** The required spans one posted request carried. */
function requiredSpans(body: PostedRequest | undefined): readonly PostedSpan[] {
  return (body?.request.roadSpans ?? []).filter((span) => span.mode === "must");
}

/** Waits for one more plan request than `before`, and returns it. */
async function nextRequest(
  requests: readonly PostedRequest[],
  before: number,
): Promise<PostedRequest> {
  await expect
    .poll(() => requests.length, { timeout: 40_000 })
    .toBeGreaterThan(before);
  const body = requests[requests.length - 1];
  if (body === undefined) throw new Error("no plan request was posted");
  return body;
}

/**
 * Waits for the answer of a replan whose in-flight copy the caller has already
 * armed.
 *
 * The two halves of "a replan ran" are asserted in two places on purpose. The
 * in-flight copy must be armed by the caller **before** the edit's own press: the
 * press's `click` call and the request wait below can outlast the fixture's 2 s
 * window under CPU load (measured on the 2026-09-18 loaded-host run), so a wait
 * started after them can miss a copy that was on screen the whole time (see
 * `map-helpers.ts` for the same reasoning about the camera). The settled copy
 * stays here: it is a terminal state, so it can be waited for whenever it arrives.
 */
async function expectReplanSettled(page: Page): Promise<void> {
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", {
    timeout: 40_000,
  });
}

/** Places both endpoints and plans the fixture ride. */
async function planFixtureRide(page: Page): Promise<void> {
  await clickMapAtCoordinate(page, ROUTE_START);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await clickMapAtCoordinate(page, NEW_DESTINATION);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
  await page.getByTestId("compose-create").click();
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", {
    timeout: 30_000,
  });
}

/** A press → move → release on the map, in the camera's own geography. */
async function dragMapCoordinates(
  page: Page,
  from: Coordinate,
  to: Coordinate,
): Promise<void> {
  const extent = await settledExtent(page);
  const map = plannerMap(page);
  const box = await map.boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");
  const toPixel = (coordinate: Coordinate): { readonly x: number; readonly y: number } => {
    const fraction = fractionOf(extent, coordinate);
    return {
      x: box.x + Math.round(fraction.x * box.width),
      y: box.y + Math.round(fraction.y * box.height),
    };
  };
  const a = toPixel(from);
  const b = toPixel(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/**
 * Selects a span by dragging across the route with the tool armed, and waits for
 * the draft to be committable.
 */
async function selectSpanAcrossRoute(page: Page): Promise<void> {
  await openRefine(page);
  await page.getByTestId("select-road-span").click();
  await expect(page.getByTestId("select-road-span")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dragMapCoordinates(page, ROUTE_START, ROUTE_END);
  // Two or more route vertices: the three action-bar actions are enabled only
  // once the draft is a real span (04 §17).
  await expect(page.getByTestId("commit-keep")).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("keep a road span: it is authored, measured, replanned and undoable", async ({
  page,
}) => {
  const requests = recordPlanRequests(page);

  await planFixtureRide(page);
  await expectHealthyMap(page);
  const afterPlan = requests.length;

  // --- Select a segment of the route and Keep it ---------------------------
  await selectSpanAcrossRoute(page);
  // Armed before the press; see `expectReplanSettled`.
  const commitInFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  await page.getByTestId("commit-keep").click();
  await commitInFlight;

  await expect(page.getByTestId("road-spans-list")).toBeVisible();
  await expect(page.getByTestId("span-mode-0")).toHaveText("Keep");
  // The span was taken from the route that is on screen, and the verdict is
  // measured against it: Satisfied, not assumed.
  await expect(page.getByTestId("span-status-0")).toHaveText("Satisfied");
  await expect(page.getByTestId("road-span-row-0")).toHaveAttribute(
    "data-warning",
    "false",
  );
  // The committed span is drawn as an authored object (05 §20).
  await expectDrawnScene(page, { spans: "1" });
  await expectHealthyMap(page);

  await nextRequest(requests, afterPlan);
  await expectReplanSettled(page);
  const commitRequest = requests[requests.length - 1]!;
  const committedSpan = requiredSpans(commitRequest)[0];
  expect(committedSpan, "the committed span reaches the provider request").toBeDefined();
  expect(committedSpan?.anchors).toHaveLength(2);
  expect(committedSpan?.direction).toBe("forward");

  // --- Change the destination: the replan carries the required anchors ------
  const beforeChange = requests.length;
  await page.getByTestId("select-finish").click();
  await page.getByTestId("point-lat").fill(NEW_DESTINATION.lat.toFixed(4));
  await page.getByTestId("point-lon").fill(NEW_DESTINATION.lon.toFixed(4));
  // Armed before the press; see `expectReplanSettled`.
  const destinationInFlight = expect(page.getByTestId("status-line")).toHaveText(
    "Updating ride…",
  );
  await page.getByTestId("apply-coordinate").click();
  await destinationInFlight;

  await nextRequest(requests, beforeChange);
  await expectReplanSettled(page);
  const settledChange = requests[requests.length - 1]!;
  // The destination change produced a strictly newer revision than the span
  // commit did: this really is a replan of the edited ride.
  expect(settledChange.identity.rideRevision).toBeGreaterThan(
    commitRequest.identity.rideRevision,
  );  // The same two anchors the rider selected, in the same order: a required span
  // is a hard constraint on the request, not a hint.
  expect(requiredSpans(settledChange)[0]?.anchors).toEqual(committedSpan?.anchors);

  // --- Remove the span: the replan no longer carries it ---------------------
  const beforeRemove = requests.length;
  // Armed before the press; see `expectReplanSettled`.
  const spanRemoveInFlight = expect(page.getByTestId("status-line")).toHaveText(
    "Updating ride…",
  );
  await page.getByTestId("remove-road-span-1").click();
  await spanRemoveInFlight;
  await nextRequest(requests, beforeRemove);
  await expectReplanSettled(page);
  await expect(page.getByTestId("road-spans-list")).toHaveCount(0);
  await expectDrawnScene(page, { spans: "0" });

  const afterRemove = requests[requests.length - 1]!;
  expect(requiredSpans(afterRemove)).toEqual([]);

  // --- Undo restores the span, and it reaches the request again -------------
  const beforeUndo = requests.length;
  // Armed before the press; see `expectReplanSettled`.
  const undoInFlight = expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
  await page.getByTestId("undo").click();
  await undoInFlight;
  await nextRequest(requests, beforeUndo);
  await expectReplanSettled(page);
  await expect(page.getByTestId("road-spans-list")).toBeVisible();
  await expect(page.getByTestId("span-status-0")).toHaveText("Satisfied");
  await expectDrawnScene(page, { spans: "1" });

  const afterUndo = requests[requests.length - 1]!;
  expect(requiredSpans(afterUndo)[0]?.anchors).toEqual(committedSpan?.anchors);
  await expectHealthyMap(page);
});
