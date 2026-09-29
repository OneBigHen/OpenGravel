import { expect, test, type Page } from "@playwright/test";

import { clickMapAtCoordinate, plannerMap, settledExtent, type Coordinate } from "./map-helpers";

/**
 * Lane A1's proof: with the route planner unreachable, a ride inside a
 * downloaded offline area is planned on the device from that area's road
 * graph, and says so. The server serves `tests/fixtures/offline-regions`
 * (`OGV_OFFLINE_REGION_ROOT` in `playwright.config.ts`): a small clip of the
 * real Pennsylvania build around these two points.
 */
const START: Coordinate = { lon: -75.4385, lat: 40.1385 };
const FINISH: Coordinate = { lon: -75.4335, lat: 40.1325 };

async function downloadFixtureArea(page: Page): Promise<void> {
  await page.goto("/settings");
  const row = page.getByTestId("offline-region-lehigh-fixture");
  await row.getByRole("button", { name: /^Download/ }).click();
  await expect(page.getByTestId("offline-maps-message")).toContainText("is ready");
  await expect(row).toContainText("On this device");
  await expect(row.getByRole("button", { name: "Remove" })).toBeVisible();
}

async function planWithNoSignal(page: Page): Promise<void> {
  // The planner is unreachable, exactly as fetch sees it with no signal.
  await page.route("**/api/route-plan", (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await clickMapAtCoordinate(page, START);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await clickMapAtCoordinate(page, FINISH);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
  await page.getByTestId("compose-create").click();
}

test("with no signal, a ride inside a downloaded area is planned on the device and says so", async ({ page }) => {
  test.setTimeout(90_000);
  await downloadFixtureArea(page);
  await planWithNoSignal(page);

  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 45_000 });
  const cards = page.locator('[data-testid^="route-card-"]');
  await expect(cards.first()).toContainText("Planned offline");
  await expect(cards.first()).toContainText("mi");
});

test("with no signal and no downloaded area, planning fails honestly", async ({ page }) => {
  await planWithNoSignal(page);
  await expect(page.getByTestId("status-line")).not.toHaveText(/Finding your ride/, { timeout: 30_000 });
  await expect(page.getByTestId("status-line")).not.toHaveText("Ride ready.");
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(0);
});

test("with the browser itself offline, a ride inside a downloaded area is still planned (OF-01)", async ({ page }) => {
  test.setTimeout(90_000);
  await downloadFixtureArea(page);
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  // Signal is lost with the app open: nothing new can be fetched, the
  // routing worker's script included.
  await page.context().setOffline(true);
  await clickMapAtCoordinate(page, START);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await clickMapAtCoordinate(page, FINISH);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
  await page.getByTestId("compose-create").click();

  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 45_000 });
  await expect(page.locator('[data-testid^="route-card-"]').first()).toContainText("Planned offline");
  await page.context().setOffline(false);
});
