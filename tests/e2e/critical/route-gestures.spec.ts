import { expect, test, type CDPSession, type Page } from "@playwright/test";

import { fractionOf, openRefine, placeEndpoint, plannerMap, settledExtent, type Coordinate } from "./map-helpers";

/**
 * Looking at a route never changes it (QA-19, "the route reroutes a ton as you
 * look at it"). Real touch and mouse input at phone size, counting the route
 * requests the browser actually posts:
 *
 * - a pan that starts on the drawn line moves the map and plans nothing;
 * - an armed pen that is only tapped (even with a shaky finger) draws nothing
 *   and plans nothing;
 * - only a deliberate hold on the line, then a drag, reshapes it: one replan,
 *   and Undo is available.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.setTimeout(150_000);

const START: Coordinate = { lon: -75.44, lat: 40.14 };
const FINISH: Coordinate = { lon: -75.4328, lat: 40.131 };
/** A vertex of the fixture's first candidate, away from the second one. */
const ON_LINE: Coordinate = { lon: -75.4361, lat: 40.1408 };

interface Point { readonly x: number; readonly y: number }

async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: readonly Point[]): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
}

async function touchDrag(page: Page, cdp: CDPSession, from: Point, to: Point, holdMs: number): Promise<void> {
  await touch(cdp, "touchStart", [from]);
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  for (let step = 1; step <= 8; step += 1) {
    const t = step / 8;
    await touch(cdp, "touchMove", [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }]);
    await page.waitForTimeout(16);
  }
  await touch(cdp, "touchEnd", []);
}

function planRequests(page: Page): { count: number } {
  const seen = { count: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/route-plan")) seen.count += 1;
  });
  return seen;
}

async function pixelOf(page: Page, coordinate: Coordinate): Promise<Point> {
  const box = await plannerMap(page).boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");
  const fraction = fractionOf(await settledExtent(page), coordinate);
  return { x: box.x + fraction.x * box.width, y: box.y + fraction.y * box.height };
}

async function planned(page: Page): Promise<{ count: number }> {
  const seen = planRequests(page);
  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 60_000 });
  await expect(page.locator('[data-testid^="route-card-"]').first()).toBeAttached();
  await page.waitForTimeout(1500);
  return seen;
}

/** The line pixel must be showing above the sheet, or the gesture would hit the sheet. */
async function linePixel(page: Page): Promise<Point> {
  const at = await pixelOf(page, ON_LINE);
  const sheet = await page.getByTestId("planner-sheet").boundingBox();
  expect(at.y, "the route line is visible above the sheet").toBeLessThan((sheet?.y ?? 844) - 20);
  return at;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("a finger pan that starts on the route line moves the map and plans nothing", async ({ page }) => {
  const seen = await planned(page);
  const at = await linePixel(page);
  const before = seen.count;
  const extent = await settledExtent(page);
  const cdp = await page.context().newCDPSession(page);
  await touchDrag(page, cdp, at, { x: at.x + 70, y: at.y + 40 }, 0);
  await page.waitForTimeout(2500);
  expect(seen.count).toBe(before);
  expect(await settledExtent(page)).not.toEqual(extent);
  await expect(page.getByTestId("undo")).toBeDisabled();
});

test("a mouse drag that starts on the route line pans the map and plans nothing", async ({ page }) => {
  const seen = await planned(page);
  const at = await linePixel(page);
  const before = seen.count;
  const extent = await settledExtent(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 70, at.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  expect(seen.count).toBe(before);
  expect(await settledExtent(page)).not.toEqual(extent);
  await expect(page.getByTestId("undo")).toBeDisabled();
});

test("tapping the map with the pen armed draws nothing and plans nothing", async ({ page }) => {
  const seen = await planned(page);
  await openRefine(page);
  await page.getByTestId("start-drawing").click();
  await expect(page.getByTestId("start-drawing")).toHaveAttribute("aria-pressed", "true");
  const before = seen.count;
  const cdp = await page.context().newCDPSession(page);
  const at = await pixelOf(page, { lon: -75.445, lat: 40.1445 });
  // A plain tap, then a shaky one that wanders a few pixels.
  await touch(cdp, "touchStart", [at]);
  await touch(cdp, "touchEnd", []);
  await page.waitForTimeout(300);
  await touch(cdp, "touchStart", [at]);
  await touch(cdp, "touchMove", [{ x: at.x + 3, y: at.y + 2 }]);
  await touch(cdp, "touchMove", [{ x: at.x + 1, y: at.y + 4 }]);
  await touch(cdp, "touchEnd", []);
  await page.waitForTimeout(2500);
  expect(seen.count).toBe(before);
  expect(await plannerMap(page).getAttribute("data-map-scene")).toContain("sketchDraft:0");
});

test("holding the route line then dragging reshapes it once and can be undone", async ({ page }) => {
  const seen = await planned(page);
  const at = await linePixel(page);
  const before = seen.count;
  const cdp = await page.context().newCDPSession(page);
  await touchDrag(page, cdp, at, { x: at.x - 40, y: at.y - 30 }, 700);
  await expect.poll(() => seen.count, { timeout: 30_000 }).toBeGreaterThan(before);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 60_000 });
  await expect(page.getByTestId("undo")).toBeEnabled();
});
