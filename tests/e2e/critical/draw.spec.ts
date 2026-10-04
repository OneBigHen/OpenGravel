import { expect, test, type Page } from "@playwright/test";

import { MAX_SKETCH_REQUEST_ANCHORS } from "../../../src/domain/sketch/types";

import {
  expectDrawnScene,
  expectHealthyMap,
  fractionOf,
  plannerMap,
  settledExtent,
  type Coordinate, openRefine } from "./map-helpers";

/**
 * Critical browser workflow: draw a multi-stroke route (04-PLANNER-AND-WORKSPACE-UX
 * §19/§20, 05-MAP-INTERACTION-AND-CARTOGRAPHY §18/§19, 06-ROUTING-AND-DECISION-ENGINE
 * §18; OGV-MAP-004/005, OGV-RTE-005, OGV-DOM-006).
 *
 * Everything here needs the renderer, the pointer stream, the drawing draft, the
 * document store, the geometry store and the network seam at once:
 *
 * - a **stroke** is a real press → move × N → release on the map, and it must reach
 *   the draft as exactly one stroke while publishing `sketchDraft:1` — the browser
 *   half of 05 §18's "pointer move: local visual update only";
 * - **Done** must reach the provider request: `/api/route-plan` runs in fixture
 *   mode, so the gate reads the body the browser actually sent and asserts the
 *   sketch's corridor anchors and preserved topology are in it (06 §18);
 * - a **failed plan keeps the sketch editable and on the map** (04 §19), and the
 *   retry re-derives from the stored trace rather than from screen pixels;
 * - the commit is **one undo unit**: Undo removes the whole sketch, and the replan
 *   it triggers carries no sketch at all.
 *
 * The fixture answers with the canned line around Norristown, so the drawing is
 * placed inside the camera the app opens with (the baseline region) and the
 * assertions read the *geography* — not the pixels — through `data-map-scene`.
 */

/**
 * The fixture takes 2 s per plan (`OGV_ROUTE_PLAN_FIXTURE_DELAY_MS`) and this spec
 * plans four times, so the default 30 s budget is a wait bound, not a retry budget.
 */
test.setTimeout(300_000);

const REGION: Coordinate = { lon: -75.44, lat: 40.14 };

/** A bowed stroke: the first one is a curve, so the corridor is not a straight line. */
function curveStroke(): readonly Coordinate[] {
  const points: Coordinate[] = [];
  for (let index = 0; index <= 8; index += 1) {
    const ratio = index / 8;
    points.push({
      lon: REGION.lon - 0.15 + 0.3 * ratio,
      lat: REGION.lat + 0.06 * Math.sin(Math.PI * ratio),
    });
  }
  return points;
}

/** A stroke that crosses the curve near its middle. */
function crossingStroke(): readonly Coordinate[] {
  const points: Coordinate[] = [];
  for (let index = 0; index <= 6; index += 1) {
    const ratio = index / 6;
    points.push({
      lon: REGION.lon - 0.01 + 0.02 * ratio,
      lat: REGION.lat - 0.08 + 0.2 * ratio,
    });
  }
  return points;
}

interface PostedSketch {
  readonly anchors: readonly Coordinate[];
  readonly endpointPolicy: string;
  readonly nearLoop: boolean;
  readonly topologyHints: readonly { readonly kind: string }[];
  readonly derivedEndpoints: { readonly start: Coordinate; readonly finish: Coordinate } | null;
}

interface PostedRequest {
  readonly identity: { readonly rideRevision: number };
  readonly request: { readonly sketch?: PostedSketch };
}

/** Every `/api/route-plan` body this page posted, in order. */
function recordPlanRequests(page: Page): PostedRequest[] {
  const bodies: PostedRequest[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes("/api/route-plan")) return;
    try {
      bodies.push(request.postDataJSON() as PostedRequest);
    } catch {
      bodies.push({ identity: { rideRevision: -1 }, request: {} });
    }
  });
  return bodies;
}

/** Waits for one more plan request than `before`, and returns it. */
async function nextRequest(
  requests: readonly PostedRequest[],
  before: number,
): Promise<PostedRequest> {
  await expect
    .poll(() => requests.length, { timeout: 60_000 })
    .toBeGreaterThan(before);
  const body = requests[requests.length - 1];
  if (body === undefined) throw new Error("no plan request was posted");
  return body;
}

/**
 * Waits for the attempt that was just posted to settle as a success.
 *
 * Only the settled copy is asserted, deliberately: a retry re-plans the **same
 * revision**, so the in-flight copy is "Finding your ride…" rather than
 * "Updating ride…" — the session's own rule (`isReplanningAnswer`), which this gate
 * has no business restating. The request was already observed before this runs, so
 * a "Ride ready." that follows it is the answer to it.
 */
async function expectPlanSettled(page: Page): Promise<void> {
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", {
    timeout: 60_000,
  });
}

/** `{lon, lat}` → the pixel currently showing it. */
async function pixelFor(
  page: Page,
  coordinate: Coordinate,
): Promise<{ readonly x: number; readonly y: number }> {
  const extent = await settledExtent(page);
  const map = plannerMap(page);
  const box = await map.boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");
  const fraction = fractionOf(extent, coordinate);
  return {
    x: box.x + Math.round(fraction.x * box.width),
    y: box.y + Math.round(fraction.y * box.height),
  };
}

/** One press → move × N → release on the map: one stroke for the drawing draft. */
async function drawStroke(page: Page, points: readonly Coordinate[]): Promise<void> {
  const first = points[0];
  if (first === undefined) throw new Error("a stroke needs at least one point");
  const start = await pixelFor(page, first);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const pixel = await pixelFor(page, point);
    await page.mouse.move(pixel.x, pixel.y, { steps: 3 });
  }
  await page.mouse.up();
}

/**
 * Makes the **next** plan request fail, the way a router with no path down that
 * trace would (23 §3's error object).
 *
 * An interception rather than an environment switch on purpose: the failure has to
 * hit exactly one attempt so the retry after it can succeed against the fixture,
 * and a server-wide switch would either fail every spec's plans or need a
 * request-addressable flag that no deployment should carry. The client cannot tell
 * the difference — it sees the same 422 `no-route` body the wire contract defines.
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
        error: {
          code: "no-route",
          message: "No legal route to this destination — try another point.",
          recoverable: true,
        },
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("draw two strokes, plan through them, recover from a failure and undo as one unit", async ({
  page,
}) => {
  const requests = recordPlanRequests(page);

  // --- Draw: two strokes, one crossing the other ---------------------------
  await openRefine(page);
  await page.getByTestId("start-drawing").click();
  await expect(page.getByTestId("start-drawing")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("sketch-actions")).toBeVisible();

  await drawStroke(page, curveStroke());
  await expectDrawnScene(page, { sketchDraft: "1" });
  // Resting the pen snaps the drawing so far onto roads (OGV-D-285): one plan of
  // the draft, the status says so, and the pen stays armed.
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(requests[0]?.request.sketch?.anchors.length).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("sketch-snap-status")).toHaveText(
    "On the roads you drew. Keep drawing, or tap Done.",
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("start-drawing")).toHaveAttribute("aria-pressed", "true");

  await drawStroke(page, crossingStroke());
  await expectDrawnScene(page, { sketchDraft: "2" });
  // The near-loop preview is the builder's own verdict, computed from the draft.
  await expect(page.getByTestId("sketch-near-loop")).toHaveText(
    "This trace is not a loop yet.",
  );

  // Nothing is authored yet: the drawing is presentation state until Done. A
  // pause between strokes may already have snapped the draft onto roads
  // (snap-as-you-go, OGV-D-285): such a preview plans the ride's *current*
  // revision and leaves no history behind: every preview carries one revision,
  // and the commit below comes at a later one.
  const previews = requests.length;
  const previewRevisions = new Set(requests.map((body) => body.identity.rideRevision));
  expect(previewRevisions.size).toBeLessThanOrEqual(1);

  // --- Done: one commit, one plan, and the trace reaches the request --------
  await page.getByTestId("sketch-done").click();
  // A snap preview still in flight may land after Done; the commit is the first
  // request at a newer revision than every preview.
  const newestPreview = Math.max(-1, ...previewRevisions);
  await expect
    .poll(() => requests.slice(previews).some((body) => body.identity.rideRevision > newestPreview), { timeout: 60_000 })
    .toBe(true);
  const committed = requests.slice(previews).find((body) => body.identity.rideRevision > newestPreview)!;
  for (const revision of previewRevisions) {
    expect(committed.identity.rideRevision).toBeGreaterThan(revision);
  }
  const sketch = committed.request.sketch;
  expect(sketch, "the committed sketch reaches the provider request").toBeDefined();
  expect(sketch?.anchors.length).toBeGreaterThan(2);
  expect(sketch?.anchors.length).toBeLessThanOrEqual(MAX_SKETCH_REQUEST_ANCHORS);
  expect(sketch?.endpointPolicy).toBe("derive");
  expect(sketch?.derivedEndpoints).not.toBeNull();
  // 05 §19: the crossing is preserved as a hint, never collapsed by the corridor.
  expect(sketch?.topologyHints.map((hint) => hint.kind)).toContain("crossing");
  // A fresh ride has no endpoints of its own, so the drawing's own are the ride's.
  expect(sketch?.derivedEndpoints?.start).toEqual(sketch?.anchors[0]);

  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", {
    timeout: 60_000,
  });
  // 04 §19: the overlay stays, faintly, and the draft is gone.
  await expectDrawnScene(page, { sketch: "1", sketchDraft: "0" });
  await expectHealthyMap(page);
  await expect(page.getByTestId("sketch-status")).toHaveText("Your sketch is drawn.");

  // --- A route failure: the sketch stays visible and editable --------------
  await failNextPlan(page);
  const beforeFailure = requests.length;
  await page.getByTestId("compose-create").click();
  await nextRequest(requests, beforeFailure);
  await expect(page.getByTestId("status-line")).toHaveText(
    "Planning failed — your previous ride is still shown.",
    { timeout: 60_000 },
  );
  await expectDrawnScene(page, { sketch: "1" });
  await expect(page.getByTestId("sketch-panel")).toBeVisible();
  // Editable: the pen arms again, and cancelling leaves the committed sketch alone.
  await openRefine(page);
  await page.getByTestId("start-drawing").click();
  await expect(page.getByTestId("start-drawing")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("sketch-cancel").click();
  await expect(page.getByTestId("start-drawing")).toHaveAttribute("aria-pressed", "false");
  await expectDrawnScene(page, { sketch: "1" });

  // --- Retry succeeds, and it re-derives from the stored trace -------------
  await page.unroute("**/api/route-plan");
  const beforeRetry = requests.length;
  await page.getByTestId("compose-create").click();
  const retried = await nextRequest(requests, beforeRetry);
  await expectPlanSettled(page);
  expect(retried.request.sketch?.anchors).toEqual(sketch?.anchors);
  expect(retried.request.sketch?.topologyHints).toEqual(sketch?.topologyHints);
  expect(retried.identity.rideRevision).toBe(committed.identity.rideRevision);

  // --- One undo unit: Undo removes the whole sketch ------------------------
  //
  // One unit means *the whole drawing* goes: the trace, the corridor and the
  // endpoints the sketch derived. Undoing it on a fresh ride therefore leaves a
  // ride with nothing to plan at all — which is exactly what the disabled plan
  // button says, and the strongest available proof that no half of the sketch
  // survived as its own undo step.
  await page.getByTestId("undo").click();
  await expectDrawnScene(page, { sketch: "0" });
  await expect(page.getByTestId("sketch-status")).toHaveText("Nothing drawn yet.");
  await expect(page.getByTestId("undo")).toBeDisabled();
  await expect(page.getByTestId("redo")).toContainText("Drew route");
  await expect(page.getByTestId("compose-create")).toBeDisabled();
  await expect(page.getByTestId("plan-disabled-reason")).toHaveText(
    "Search for a start, or set it on the map.",
  );
  await expectHealthyMap(page);

  // --- Redo restores the same sketch as one unit, and it reaches the wire ---
  const beforeRedo = requests.length;
  await page.getByTestId("redo").click();
  const afterRedo = await nextRequest(requests, beforeRedo);
  expect(afterRedo.request.sketch?.anchors).toEqual(sketch?.anchors);
  await expectPlanSettled(page);
  await expectDrawnScene(page, { sketch: "1" });
  await expect(page.getByTestId("sketch-status")).toHaveText("Your sketch is drawn.");
});
