import { expect, test, type Page } from "@playwright/test";

import {
  fractionOf,
  placeEndpoint,
  plannerMap,
  readDrawnScene,
  settledExtent,
  type Coordinate,
} from "./map-helpers";
import { sharedLinePoint, waitingOn } from "./rider-gate-helpers";

/**
 * GATE-IDLE-BUDGET (#328; behind QA-19, "the route reroutes a ton as you look at it").
 *
 * Extends the idle-request check (idle-route-stays-put.spec.ts) to the gesture that actually broke:
 * a pan that STARTS ON THE ROUTE LINE. For a full minute the rider pans and zooms, pressing down on the
 * line each time; the planner must send zero route-plan requests and the ride must come out exactly as
 * it went in (same scene, same distance, same stop count).
 *
 * Why this is a fixture-router test and not under tests/real-router: the thing counted is the browser's
 * own requests, which a real router cannot change, and CI only runs this folder.
 *
 * Waiting on PR #338 (route gestures): on main, pressing on the selected line grabs it immediately, so a
 * mouse pan reshapes the route and posts a new plan.
 */
test.setTimeout(240_000);

const START: Coordinate = { lon: -75.44, lat: 40.14 };
const FINISH: Coordinate = { lon: -75.4328, lat: 40.131 };

function planRequests(page: Page): { readonly count: () => number } {
  let n = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/route-plan")) n += 1;
  });
  return { count: () => n };
}

async function pixelOf(page: Page, point: Coordinate): Promise<{ x: number; y: number }> {
  const box = await plannerMap(page).boundingBox();
  if (box === null) throw new Error("no map box");
  const at = fractionOf(await settledExtent(page), point);
  return { x: box.x + at.x * box.width, y: box.y + at.y * box.height };
}

test("a minute of panning and zooming that starts on the route line asks the router for nothing and changes nothing", async ({ page }) => {
  waitingOn("waiting on PR #338 (route gestures): on main a mouse pan from the route line reshapes the route");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 60_000 });
  await page.waitForTimeout(3_000);

  const before = {
    scene: (await readDrawnScene(page))["routes"],
    points: (await readDrawnScene(page))["points"],
    arrive: await page.locator(".og-phone-summary__arrive").first().textContent(),
  };
  const plans = planRequests(page);
  const line = sharedLinePoint();

  const until = Date.now() + 60_000;
  let rounds = 0;
  while (Date.now() < until) {
    const from = await pixelOf(page, line);
    const sheet = await page.getByTestId("planner-sheet").boundingBox();
    // The press must land on the map, above the sheet, or it is a sheet drag and proves nothing.
    expect(from.y, "the route line is above the sheet").toBeLessThan((sheet?.y ?? 844) - 10);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 70, from.y - 30, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1_200);
    // Zoom on the line, out and back, then pan again from where the line now is.
    const now = await pixelOf(page, line);
    await page.mouse.move(now.x, now.y);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(1_500);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(1_500);
    const back = await pixelOf(page, line);
    await page.mouse.move(back.x, back.y);
    await page.mouse.down();
    await page.mouse.move(back.x - 70, back.y + 30, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(2_500);
    rounds += 1;
  }

  expect(rounds, "the minute was really spent panning").toBeGreaterThanOrEqual(4);
  expect(plans.count(), "route-plan requests while the rider only panned and zoomed").toBe(0);
  const after = await readDrawnScene(page);
  expect(after["routes"], "same number of routes").toBe(before.scene);
  expect(after["points"], "same points on the map").toBe(before.points);
  expect(await page.locator(".og-phone-summary__arrive").first().textContent(), "same ride facts").toBe(before.arrive);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
});
