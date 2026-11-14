import { expect, test, type Page } from "@playwright/test";

import {
  dragMap,
  openRefine,
  placeEndpoint,
  plannerMap,
  pressPlan,
  settledExtent,
  type Coordinate,
} from "./map-helpers";

/**
 * RMN-5, owner complaint 1: "the routes reroute a ton as you look at it".
 *
 * Once a route is on screen and the rider only LOOKS at it (waits, pans, zooms,
 * the page loses and regains focus, the sheet moves), the planner must not ask
 * the router again. Any `/api/route-plan` request after the route settled that
 * the rider did not cause is a bug.
 */
test.setTimeout(240_000);

const START: Coordinate = { lon: -75.4385, lat: 40.1385 };
const FINISH: Coordinate = { lon: -75.4335, lat: 40.1325 };
const REGION: Coordinate = { lon: -75.44, lat: 40.14 };

function countPlans(page: Page): { readonly count: () => number } {
  let n = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/route-plan")) n += 1;
  });
  return { count: () => n };
}

/** Everything a rider does just by looking: wait, pan, zoom, look away and back, nudge the sheet. */
async function lookAround(page: Page, options: { readonly pan: boolean }): Promise<void> {
  const map = plannerMap(page);
  const box = await map.boundingBox();
  if (box === null) throw new Error("no map box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 3 };
  for (let round = 0; round < 3; round += 1) {
    if (options.pan) {
      await dragMap(page, { x: 0.5, y: 0.3 }, { dx: 60, dy: 30 });
      await dragMap(page, { x: 0.5, y: 0.3 }, { dx: -60, dy: -30 });
    }
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(1_500);
    await page.mouse.wheel(0, 300);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(6_000);
  }
  await page.waitForTimeout(15_000);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("a planned route is not asked for again while the rider only looks at it", async ({ page }) => {
  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await pressPlan(page);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 60_000 });
  await page.waitForTimeout(3_000);
  const plans = countPlans(page);
  await lookAround(page, { pan: true });
  expect(plans.count(), "route-plan requests while the rider was only looking").toBe(0);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
});

function stroke(): readonly Coordinate[] {
  return Array.from({ length: 9 }, (_, i) => ({
    lon: REGION.lon - 0.15 + 0.3 * (i / 8),
    lat: REGION.lat + 0.06 * Math.sin(Math.PI * (i / 8)),
  }));
}

async function drawStroke(page: Page, points: readonly Coordinate[]): Promise<void> {
  const extent = await settledExtent(page);
  const box = await plannerMap(page).boundingBox();
  if (box === null) throw new Error("no map box");
  const merc = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const at = (c: Coordinate): { x: number; y: number } => ({
    x: box.x + ((c.lon - extent.minLon) / (extent.maxLon - extent.minLon)) * box.width,
    y: box.y + ((merc(extent.maxLat) - merc(c.lat)) / (merc(extent.maxLat) - merc(extent.minLat))) * box.height,
  });
  const first = at(points[0]!);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const px = at(p);
    await page.mouse.move(px.x, px.y, { steps: 3 });
  }
  await page.mouse.up();
}

test("a drawn route is not asked for again after it settles, while looking", async ({ page }) => {
  await openRefine(page);
  await page.getByTestId("start-drawing").click();
  await drawStroke(page, stroke());
  await expect(page.getByTestId("sketch-snap-status")).toHaveText(
    "On the roads you drew. Keep drawing, or tap Done.",
    { timeout: 60_000 },
  );
  await page.getByTestId("sketch-done").click();
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 60_000 });
  await page.waitForTimeout(3_000);
  const plans = countPlans(page);
  await lookAround(page, { pan: true });
  expect(plans.count(), "route-plan requests while the rider was only looking at the drawn route").toBe(0);
});

test("a drawing snapped to roads, pen still armed, is not re-snapped while the rider waits", async ({ page }) => {
  await openRefine(page);
  await page.getByTestId("start-drawing").click();
  await drawStroke(page, stroke());
  await expect(page.getByTestId("sketch-snap-status")).toHaveText(
    "On the roads you drew. Keep drawing, or tap Done.",
    { timeout: 60_000 },
  );
  await page.waitForTimeout(3_000);
  const plans = countPlans(page);
  await lookAround(page, { pan: false });
  expect(plans.count(), "route-plan requests while the pen rested").toBe(0);
});
