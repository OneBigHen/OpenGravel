import { expect, test, type Page } from "@playwright/test";

import {
  dragMap,
  openRefine,
  placeEndpoint,
  plannerMap,
  pressPlan,
  readDrawnScene,
  settledExtent,
} from "./map-helpers";
import { directionsTo } from "./search-helpers";

/**
 * The core planning flow on a phone (Hermes capture OG-01 … OG-05, 2026-11-12).
 *
 * - OG-01: a loop whose request stalls shows motion, ends in a readable retryable
 *   error inside ~20 s, and Cancel really aborts the request.
 * - OG-02: Start on a drawing that is not kept yet keeps it and starts the ride.
 * - OG-03: panning and zooming a planned ride asks for no new plan and redraws
 *   the same line.
 * - OG-04: a router that is down gives one full error row with one Retry, no
 *   floating pill over it and no stale "tap the map" instruction.
 * - OG-05: while a new answer is found the summary shows skeletons, not numbers.
 */

const PHONE = { width: 390, height: 844 };
const START = { lat: 40.1385, lon: -75.4385 };
const FINISH = { lat: 40.1325, lon: -75.4335 };
/**
 * Where the owner's loop stuck (2026-11-13 screenshot, Hatboro, PA). Outside the
 * test server's offline road region on purpose: there the device's own offline
 * router would answer a stalled request, which hides the stall being tested.
 */
const HATBORO = { lat: 40.179, lon: -75.1077 };

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

/** Phone screenshots for the lane's before/after record, only when asked for. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.OG_SHOTS_DIR;
  if (dir !== undefined && dir !== "") await page.screenshot({ path: `${dir}/${name}-390x844.png` });
}

function countPlanPosts(page: Page): { readonly count: () => number; readonly bodies: () => readonly unknown[] } {
  const bodies: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes("/api/route-plan")) return;
    try {
      const body = request.postDataJSON() as { identity?: unknown; request?: { shaping?: unknown; stops?: unknown; origin?: unknown; destination?: unknown } };
      bodies.push({ identity: body.identity, shaping: body.request?.shaping, stops: body.request?.stops, origin: body.request?.origin, destination: body.request?.destination });
    } catch {
      bodies.push(null);
    }
  });
  return { count: () => bodies.length, bodies: () => bodies };
}

async function startLoopHere(page: Page, at: { readonly lat: number; readonly lon: number } = HATBORO): Promise<void> {
  await page.context().setGeolocation({ latitude: at.lat, longitude: at.lon });
  await page.context().grantPermissions(["geolocation"]);
  await page.getByTestId("loop-near-me").click();
  await pressPlan(page);
}

test("OG-01: a stalled loop shows it is working, then ends in an error with one Retry", async ({ page }) => {
  // The router never answers: the request hangs exactly like the owner's "STUCK".
  await page.route("**/api/route-plan", () => undefined);
  await startLoopHere(page);

  const elapsed = page.getByTestId("plan-elapsed");
  await expect(elapsed).toBeVisible();
  await expect(page.getByTestId("compose-create")).toHaveAttribute("aria-busy", "true");
  const first = await elapsed.textContent();
  await expect.poll(async () => elapsed.textContent(), { timeout: 5_000 }).not.toBe(first);

  // Within the 20 s deadline (plus slack for a loaded runner) the attempt ends.
  const error = page.getByTestId("planner-error");
  await expect(error).toHaveText("Finding this ride took too long. Tap Retry to try again.", { timeout: 26_000 });
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(1);
  await expect(page.getByTestId("compose-create")).toHaveCount(0);
  await expect(page.getByText("Your ride is on its way")).toHaveCount(0);

  // Retry with the router back plans the loop.
  await page.unroute("**/api/route-plan");
  await page.getByTestId("planner-error-retry").click();
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
  await expect(page.getByTestId("planner-error")).toHaveCount(0);
});

test("OG-01: Cancel aborts the loop request", async ({ page }) => {
  await page.route("**/api/route-plan", () => undefined);
  const aborted: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/route-plan")) aborted.push(request.failure()?.errorText ?? "");
  });
  await startLoopHere(page);
  await expect(page.getByTestId("plan-elapsed")).toBeVisible();
  await page.getByTestId("cancel-planning").click();
  await expect.poll(() => aborted.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("plan-elapsed")).toHaveCount(0);
  await expect(page.getByTestId("compose-create")).toBeEnabled();
});

test("OG-04: a router that is down gives one readable error row with one Retry", async ({ page }) => {
  await page.route("**/api/route-plan", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "provider-unavailable", message: "The routing service is unavailable right now.", recoverable: true },
      }),
    }),
  );
  await directionsTo(page);

  const error = page.getByTestId("planner-error");
  await expect(error).toHaveText("The routing service is unavailable right now.", { timeout: 30_000 });
  await expect(error).toBeInViewport({ ratio: 1 });
  // Nothing floats over the message, and it is not cut off.
  await expect(page.getByTestId("ride-glance-dock")).toHaveCount(0);
  await expect(page.getByTestId("ride-glance-map")).toHaveCount(0);
  const clipped = await error.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(clipped).toBe(false);
  const box = await error.boundingBox();
  if (box === null) throw new Error("the error must be measurable");
  const onTop = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid='planner-error']") !== null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(onTop, "nothing covers the error message").toBe(true);

  // Exactly one retry, and no instruction that pretends an end is missing.
  await expect(page.getByRole("button", { name: /^(Retry|Plan again)$/ })).toHaveCount(1);
  await expect(page.getByTestId("planner-error-retry")).toBeVisible();
  await expect(page.getByText(/Tap the map to set your/)).toHaveCount(0);

  await page.unroute("**/api/route-plan");
  await page.getByTestId("planner-error-retry").click();
  await expect(page.getByTestId("planner-error")).toHaveCount(0, { timeout: 30_000 });
});

test("OG-03: panning and zooming a planned ride asks for no new plan and keeps the line", async ({ page }) => {
  const posts = countPlanPosts(page);
  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
  await expect.poll(async () => (await readDrawnScene(page)).line, { timeout: 10_000 }).not.toBe("none");
  // Let any trailing request of the attempt land first.
  await page.waitForTimeout(1_500);
  const before = posts.count();
  const scene = await readDrawnScene(page);

  const map = plannerMap(page);
  const box = await map.boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");
  for (let step = 0; step < 6; step += 1) {
    await dragMap(page, { x: 0.5, y: 0.3 }, { dx: step % 2 === 0 ? 70 : -60, dy: step % 2 === 0 ? 30 : -25 });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
    await page.mouse.wheel(0, step % 2 === 0 ? -240 : 200);
    await page.waitForTimeout(400);
  }
  await settledExtent(page);
  await page.waitForTimeout(2_000);

  if (posts.count() !== before) {
    // Say what changed, so a failure names its cause.
    console.log("OG-03 posts", JSON.stringify(posts.bodies().slice(before)));
    console.log("OG-03 edit label", await page.getByTestId("trip-edit").first().getAttribute("aria-label"));
  }
  expect(posts.count(), "no plan request from looking at the map").toBe(before);
  const after = await readDrawnScene(page);
  expect(after.selected).toBe(scene.selected);
  expect(after.line, "the same line, coordinate for coordinate").toBe(scene.line);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
});

/**
 * One stroke across the open map, clear of the floating ride pill under the top
 * card and of a desktop's side panel: `x0`..`x1` are fractions of the map width.
 */
async function drawStroke(page: Page, y: number, x0 = 0.2, x1 = 0.8): Promise<void> {
  await expect(page.getByTestId("map-edit-bar")).toHaveAttribute("data-mode", "drawing");
  const box = await plannerMap(page).boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");
  const mid = (x0 + x1) / 2;
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * mid, box.y + box.height * (y + 0.05), { steps: 6 });
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y, { steps: 6 });
  await page.mouse.up();
}

async function startDrawing(page: Page): Promise<void> {
  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
  // A phone edits a planned ride from the From / To card.
  await page.getByTestId("trip-edit").click();
  const open = page.getByTestId("map-edit-open");
  if (await open.count() > 0) await open.click();
  await page.getByTestId("map-edit-draw").click();
}

test("OG-05: while a drawing is snapped the summary shows skeletons, not numbers", async ({ page }) => {
  await startDrawing(page);
  await drawStroke(page, 0.32);
  await expect(page.getByTestId("map-edit-bar")).toContainText("On roads", { timeout: 30_000 });
  await expect(page.locator(".og-phone-summary__time")).toBeVisible();

  // Hold the next snap so the in-between state can be read.
  await page.route("**/api/route-plan", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    await route.continue();
  });
  await drawStroke(page, 0.42);
  await expect(page.getByTestId("map-edit-bar")).toContainText("Finding roads", { timeout: 10_000 });
  await expect(page.getByTestId("summary-computing")).toBeVisible();
  await expect(page.locator(".og-phone-summary__time")).toHaveCount(0);
  await expect(page.locator(".og-phone-summary__arrive")).toHaveCount(0);
  // The answer lands and the numbers come back.
  await expect(page.locator(".og-phone-summary__time")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("summary-computing")).toHaveCount(0);
});

test("OG-02: Start on a drawing keeps the drawing and starts the ride", async ({ page }) => {
  await startDrawing(page);
  await drawStroke(page, 0.32);
  await expect(page.getByTestId("map-edit-bar")).toContainText("On roads", { timeout: 30_000 });

  const start = page.getByTestId("start-ride");
  await expect(start).toBeEnabled();
  await expect(page.getByTestId("start-ride-reason")).toHaveCount(0);
  await expect(page.getByText("Tap Done to keep your drawing before you ride it.")).toHaveCount(0);
  await shot(page, "after-og02-drawn-start-enabled");
  await start.click();
  await expect(page).toHaveURL(/\/ride$/, { timeout: 60_000 });
});

test("a route drawn from nothing names its own ends and Start rides it (owner, 2026-11-13)", async ({ page }) => {
  // The owner's screenshot: a drawn route on screen, the From / To card saying
  // "No start yet", and Start greyed out. Drawing from an empty planner is the
  // desktop refine panel's pen.
  await page.setViewportSize({ width: 1280, height: 860 });
  await openRefine(page);
  await page.getByTestId("start-drawing").click();
  await expect(page.getByTestId("start-drawing")).toHaveAttribute("aria-pressed", "true");
  await drawStroke(page, 0.45, 0.55, 0.9);
  await expect(page.getByTestId("sketch-snap-status")).toHaveText(
    "On the roads you drew. Keep drawing, or tap Done.",
    { timeout: 60_000 },
  );

  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await expect(page.getByTestId("start-value")).toContainText("From your sketch");
  await expect(page.getByTestId("finish-value")).toContainText("From your sketch");
  await shot(page, "after-owner1-drawn-from-nothing-1280");
  const start = page.getByTestId("start-ride");
  await expect(start).toBeEnabled();
  await expect(page.getByText("Tap Done to keep your drawing before you ride it.")).toHaveCount(0);
  await start.click();
  await expect(page).toHaveURL(/\/ride$/, { timeout: 60_000 });
});
