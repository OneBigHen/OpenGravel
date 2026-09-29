import { expect, test, type Page } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";

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
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await page.getByTestId("start-search").fill("Jim Thorpe");
  await page.getByTestId("start-search").press("Enter");
  await expect(page.getByTestId("start-value")).toContainText("Jim Thorpe, PA");
  await page.getByTestId("finish-search").fill("hawk mountain s");
  await page.getByTestId("finish-search").press("Enter");
  await expect(page.getByTestId("finish-value")).toContainText("Hawk Mountain Sanctuary, PA");
  await page.getByTestId("compose-create").click();
  await expect(routeCards(page).first()).toBeVisible();
});

test("a chosen route is briefed: weather for the ride, and honest unknowns", async ({ page }) => {
  const prepare = page.getByTestId("prepare");
  await expect(prepare).toBeVisible();
  if ((await prepare.getAttribute("open")) === null) await page.getByTestId("prepare-toggle").click();
  await expect(page.getByTestId("departure-summary")).toHaveText("Leaving now");
  await expect(page.getByTestId("preparation-section")).toBeVisible();
  await expect(page.getByTestId("preparation-state-weather")).toHaveText("Ready");
  // No traffic key in the gate: traffic is unknown, never clear.
  await expect(page.getByText("Clear", { exact: true })).toHaveCount(0);
});

test("a later departure is one tap and still briefs the ride", async ({ page }) => {
  const prepare = page.getByTestId("prepare");
  if ((await prepare.getAttribute("open")) === null) await page.getByTestId("prepare-toggle").click();
  await page.getByTestId("departure-in-3h").check();
  await expect(page.getByTestId("departure-in-3h")).toBeChecked();
  await expect(page.getByTestId("departure-summary")).toHaveText(/^Leaving \w{3} \d{1,2}:\d{2} [AP]M$/);
  await expect(routeCards(page).first()).toBeVisible();
  await expect(page.getByTestId("preparation-state-weather")).toHaveText("Ready");
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
});
