import { expect, test, type Route } from "@playwright/test";

import type { RoutePlanRequestBody, RoutePlanSuccessBody } from "../../../src/application/planner/ports/route-plan-contract";
import {
  cameraGeneration,
  placeEndpoint,
  plannerMap,
  pressPlan,
  readDrawnScene,
  settledExtent,
  type Coordinate,
} from "./map-helpers";

/**
 * The first route comes early, the better one takes its place quietly.
 *
 * The router here is deliberately slow: the first-route request takes 1.5 s and
 * the full plan 7 s more (a busy production box). The rider must see a real
 * route within 5 s of the request leaving, then the better route arrives without
 * the map moving, a short note says so, and Undo puts the first route back.
 */
test.setTimeout(120_000);

const START: Coordinate = { lon: -75.4385, lat: 40.1385 };
const FINISH: Coordinate = { lon: -75.4335, lat: 40.1325 };
const FIRST_ROUTE_DELAY_MS = 1_500;
const FULL_PLAN_DELAY_MS = 7_000;
const BUDGET_MS = 5_000;

test("a slow router still shows a route in 5 s, then upgrades it without moving the map, and Undo restores the first", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-28T16:00:00Z"));
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);

  let firstAskedAt = 0;
  let fullAskedAt = 0;
  await page.route("**/api/route-plan", async (route: Route) => {
    const { request } = route.request().postDataJSON() as RoutePlanRequestBody;
    const firstOnly = request.options.includeAlternatives === false;
    if (firstOnly) firstAskedAt = Date.now();
    else fullAskedAt = Date.now();
    const response = await route.fetch();
    const body = (await response.json()) as RoutePlanSuccessBody;
    const [better, quick] = body.bundle.candidates;
    if (better === undefined || quick === undefined) throw new Error("the fixture answer needs two candidates");
    const noRoles = { ...body.bundle.roles, "best-ride": null, fastest: null, "fast-and-fun": null, "more-twisties": null, "more-dirt": null, "lower-workload": null };
    await new Promise((resolve) => setTimeout(resolve, firstOnly ? FIRST_ROUTE_DELAY_MS : FULL_PLAN_DELAY_MS));
    await route.fulfill({
      response,
      json: {
        ...body,
        bundle: firstOnly
          // The quick answer: one checked route, named the best ride.
          ? { ...body.bundle, candidates: [quick], roles: { ...noRoles, "best-ride": quick.id, fastest: quick.id }, selectedRouteId: quick.id }
          // The full plan finds a better one and names it the best ride.
          : { ...body.bundle, candidates: [quick, better], roles: { ...noRoles, "best-ride": better.id, fastest: quick.id }, selectedRouteId: better.id },
      },
    });
  });

  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await pressPlan(page);

  // 1. A real route is on the map within the budget, counted from the request.
  await expect.poll(() => firstAskedAt, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(1, { timeout: BUDGET_MS });
  const shownAfter = Date.now() - firstAskedAt;
  expect(shownAfter).toBeLessThanOrEqual(BUDGET_MS);
  await expect(page.getByTestId("status-line")).toHaveText("Finding other roads…");
  const firstScene = await readDrawnScene(page);
  expect(firstScene["routes"]).toBe("1");
  expect(page.getByTestId("rider-toast")).toHaveCount(0);
  // Let the opening fit finish before watching for movement.
  await settledExtent(page);
  const cameraBefore = await cameraGeneration(page);
  expect(fullAskedAt).toBeLessThan(firstAskedAt + FULL_PLAN_DELAY_MS);

  // 2. The better route arrives, takes the first one's place, and says so.
  const toast = page.getByTestId("rider-toast");
  await expect(toast).toContainText("Found a better", { timeout: 20_000 });
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  const upgraded = await readDrawnScene(page);
  expect(upgraded["selected"]).not.toBe(firstScene["selected"]);
  // The map did not move.
  await page.waitForTimeout(800);
  expect(await cameraGeneration(page)).toBe(cameraBefore);

  // 3. Undo brings the first route back, and the note goes away.
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toHaveCount(0);
  await expect.poll(async () => (await readDrawnScene(page))["selected"]).toBe(firstScene["selected"]);
  expect(await cameraGeneration(page)).toBe(cameraBefore);
});
