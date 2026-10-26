import { directionsTo } from "./search-helpers";
import { expect, test, type Page } from "@playwright/test";

import { plannerMap, pressPlan, settledExtent } from "./map-helpers";

/**
 * The route briefing (MVP parity M4, OGV-D-266): once a route is chosen the
 * planner says when the ride leaves and what that means — weather over the
 * ride's window (the fixture weather service, `OGV_WEATHER_FIXTURE`), fuel
 * range against the distance, and live traffic stated as unknown when no
 * traffic key is configured. A later departure is one tap and replans.
 */

function routeCards(page: Page) {
  return page.locator('[data-testid^="route-card-"]');
}

test.beforeEach(async ({ page }) => {
  // The checked-in weather snapshot is dated. Give this synthetic UI forecast
  // a window around the run, including the later departure this spec exercises.
  await page.route("**/api/weather?*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const now = Date.now();
    body.snapshot.forecast = body.snapshot.forecast.map((period: Record<string, unknown>) => ({
      ...period, startTime: new Date(now - 3600000).toISOString(), endTime: new Date(now + 86400000).toISOString(),
    }));
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await directionsTo(page);
  await pressPlan(page);
  await expect(routeCards(page).first()).toBeVisible();
});

test("a chosen route is briefed: weather for the ride, and honest unknowns", async ({ page }) => {
  const prepare = page.getByTestId("prepare");
  await expect(prepare).toBeVisible();
  if ((await prepare.getAttribute("open")) === null) await page.getByTestId("prepare-toggle").click();
  await expect(page.getByTestId("prepare-toggle")).toContainText("Leaving");
  await expect(page.getByTestId("departure-summary")).toHaveText("Now");
  // The weather is one line under Start, stated once and never twice.
  await expect(page.getByTestId("prepare-glance")).toContainText(/°F/);
  await expect(page.getByTestId("prepare-glance")).not.toContainText("min remaining");
  await expect(page.getByTestId("prepare-weather-credit")).toContainText("National Weather Service");
  // No traffic key in the gate: traffic is unknown, never clear.
  await expect(page.getByText("Clear", { exact: true })).toHaveCount(0);
});

test("a later departure is one tap and still briefs the ride", async ({ page }) => {
  const prepare = page.getByTestId("prepare");
  if ((await prepare.getAttribute("open")) === null) await page.getByTestId("prepare-toggle").click();
  await page.getByTestId("departure-in-3h").check();
  await expect(page.getByTestId("departure-in-3h")).toBeChecked();
  await expect(page.getByTestId("departure-summary")).toHaveText(/^\w{3} \d{1,2}:\d{2} [AP]M$/);
  await expect(routeCards(page).first()).toBeVisible();
  await expect(page.getByTestId("prepare-glance")).toContainText(/°F/);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
});
