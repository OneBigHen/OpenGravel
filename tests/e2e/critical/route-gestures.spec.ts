import { expect, test, type CDPSession, type Page } from "@playwright/test";

import { openRefine, placeEndpoint, plannerMap, ROUTE_PLUM, settledExtent, type Coordinate } from "./map-helpers";

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

async function planned(page: Page): Promise<{ count: number }> {
  const seen = planRequests(page);
  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 60_000 });
  await expect(page.locator('[data-testid^="route-card-"]').first()).toBeAttached();
  await page.waitForTimeout(1500);
  return seen;
}

/**
 * A pixel in the middle of the drawn route line, found by looking at the map
 * (not by assuming where the fixture puts it), so the gesture really starts on
 * the line. The line must also be above the sheet, or the gesture would hit the sheet.
 */
async function linePixel(page: Page): Promise<Point> {
  const map = plannerMap(page);
  const box = await map.boundingBox();
  const sheet = await page.getByTestId("planner-sheet").boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");
  const limit = (sheet?.y ?? 844) - 30;
  const shot = (await map.screenshot()).toString("base64");
  const found = await map.evaluate(async (_el, input) => {
    const image = new Image();
    image.src = `data:image/png;base64,${input.png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(image, 0, 0);
    const scale = image.width / input.width;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const target = [1, 3, 5].map((i) => Number.parseInt(input.color.slice(i, i + 2), 16));
    const near = (x: number, y: number): boolean => {
      const at = (Math.round(y) * canvas.width + Math.round(x)) * 4;
      return [0, 1, 2].every((c) => Math.abs((data[at + c] ?? 0) - (target[c] ?? 0)) <= 20);
    };
    const hits: Array<{ x: number; y: number }> = [];
    for (let y = 8; y < Math.min(canvas.height - 8, input.limit * scale); y += 2) {
      for (let x = 8; x < canvas.width - 8; x += 2) {
        // A fat part of the line: every pixel a few px around is line colour.
        if (near(x, y) && near(x + 3, y) && near(x - 3, y) && near(x, y + 3) && near(x, y - 3)) hits.push({ x: x / scale, y: y / scale });
      }
    }
    if (hits.length === 0) return null;
    return hits[Math.floor(hits.length / 2)] ?? null;
  }, { png: shot, color: ROUTE_PLUM, width: box.width, limit: limit - box.y });
  expect(found, "the route line is drawn on the map above the sheet").not.toBeNull();
  return { x: box.x + (found?.x ?? 0), y: box.y + (found?.y ?? 0) };
}

/** What the rider sees of the ride: its summary and what Undo would undo. */
async function rideState(page: Page): Promise<{ summary: string; undo: string }> {
  return {
    // The clock-driven "Arrive 5:30 AM" changes by itself each minute; distance and time do not.
    summary: ((await page.getByTestId("route-summary").first().textContent().catch(() => null)) ?? "").replace(/Arrive \d+:\d+ [AP]M/g, ""),
    undo: (await page.getByTestId("undo").getAttribute("title")) ?? "",
  };
}

async function openPen(page: Page): Promise<void> {
  const toggle = page.getByTestId("refine-toggle");
  // Pull the sheet up until the refine section shows (peek, then half, then full).
  for (const name of [/Expand to half/, /Expand fully/]) {
    if (await toggle.isVisible()) break;
    const grip = page.getByRole("button", { name });
    if (await grip.count() > 0) await grip.click();
    await page.waitForTimeout(600);
  }
  await openRefine(page);
  await page.getByTestId("start-drawing").click();
  await expect(page.getByTestId("start-drawing")).toHaveAttribute("aria-pressed", "true");
  // Put the sheet back down so the map is under the fingers, not the sheet.
  for (let i = 0; i < 2; i += 1) {
    const down = page.getByRole("button", { name: /Collapse to peek/ });
    if (await down.count() === 0) break;
    await down.click();
    await page.waitForTimeout(600);
  }
}

/** An empty spot of map that is clearly above the sheet and away from the top bars. */
async function openMapPixel(page: Page): Promise<Point> {
  const sheet = await page.getByTestId("planner-sheet").boundingBox();
  const top = sheet?.y ?? 844;
  expect(top, "the sheet leaves room for the map").toBeGreaterThan(400);
  return { x: 120, y: Math.round(top * 0.6) };
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
  const ride = await rideState(page);
  const extent = await settledExtent(page);
  const cdp = await page.context().newCDPSession(page);
  await touchDrag(page, cdp, at, { x: at.x + 70, y: at.y + 40 }, 0);
  await page.waitForTimeout(2500);
  expect(seen.count).toBe(before);
  expect(await settledExtent(page)).not.toEqual(extent);
  expect(await rideState(page)).toEqual(ride);
});

test("a mouse drag that starts on the route line pans the map and plans nothing", async ({ page }) => {
  const seen = await planned(page);
  const at = await linePixel(page);
  const before = seen.count;
  const ride = await rideState(page);
  const extent = await settledExtent(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 70, at.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  expect(seen.count).toBe(before);
  expect(await settledExtent(page)).not.toEqual(extent);
  expect(await rideState(page)).toEqual(ride);
});

test("tapping the map with the pen armed draws nothing and plans nothing", async ({ page }) => {
  const seen = await planned(page);
  await openPen(page);
  const before = seen.count;
  const cdp = await page.context().newCDPSession(page);
  const at = await openMapPixel(page);
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

test("with the pen armed, two fingers pan the map and draw nothing; one finger still draws", async ({ page }) => {
  const seen = await planned(page);
  await openPen(page);
  const before = seen.count;
  const extent = await settledExtent(page);
  const cdp = await page.context().newCDPSession(page);
  const a = await openMapPixel(page);
  const b = { x: a.x + 40, y: a.y };
  await touch(cdp, "touchStart", [a, b]);
  for (let step = 1; step <= 8; step += 1) {
    const d = step * 10;
    await touch(cdp, "touchMove", [{ x: a.x + d, y: a.y + d / 2 }, { x: b.x + d, y: b.y + d / 2 }]);
    await page.waitForTimeout(16);
  }
  await touch(cdp, "touchEnd", []);
  await page.waitForTimeout(2500);
  expect(await settledExtent(page), "two fingers moved the map").not.toEqual(extent);
  expect(await plannerMap(page).getAttribute("data-map-scene")).toContain("sketchDraft:0");
  expect(seen.count).toBe(before);
  // The pen is still armed, and one finger still draws a stroke.
  await expect(page.getByTestId("start-drawing")).toHaveAttribute("aria-pressed", "true");
  const from = await openMapPixel(page);
  await touchDrag(page, cdp, from, { x: from.x + 90, y: from.y + 30 }, 0);
  await expect.poll(async () => plannerMap(page).getAttribute("data-map-scene")).toContain("sketchDraft:1");
});

test("holding the route line then dragging adds one stop (Undo names it)", async ({ page }) => {
  const seen = await planned(page);
  const at = await linePixel(page);
  const before = seen.count;
  const ride = await rideState(page);
  const cdp = await page.context().newCDPSession(page);
  await touchDrag(page, cdp, at, { x: at.x - 40, y: at.y - 30 }, 700);
  await expect.poll(() => seen.count, { timeout: 30_000 }).toBeGreaterThan(before);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  // The pull-through plans at most twice (preview, then the committed ride), never a stream.
  expect(seen.count - before, "one hold-and-drag replans once or twice").toBeLessThanOrEqual(2);
  expect((await rideState(page)).undo).not.toEqual(ride.undo);
  // Undo (kept in the sheet's history row) now names the new stop.
  expect((await rideState(page)).undo).toContain("Add stop");
});

test("holding the route line without moving offers the road and plans nothing", async ({ page }) => {
  const seen = await planned(page);
  const at = await linePixel(page);
  const before = seen.count;
  const ride = await rideState(page);
  const cdp = await page.context().newCDPSession(page);
  await touch(cdp, "touchStart", [at]);
  await page.waitForTimeout(700);
  await touch(cdp, "touchEnd", []);
  await page.waitForTimeout(2500);
  expect(seen.count).toBe(before);
  expect(await rideState(page)).toEqual(ride);
});
