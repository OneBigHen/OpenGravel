import { expect, test } from "@playwright/test";
import { expectDrawnScene, plannerMap, readDrawnScene, settledExtent } from "./map-helpers";
import { clickInRideSheet, openRideSheet } from "./ride-focus-helpers";

const SAVED_HOME = { longitude: -75.4328, latitude: 40.131, accuracy: 6 };
const RIDE_START = { longitude: -75.44, latitude: 40.14, accuracy: 6, heading: 35, speed: 12 };

test("Just ride enables suggestions and Head Home binds a fresh return to the session", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(SAVED_HOME);
  await page.goto("/settings");
  await page.getByTestId("settings-save-home").click();
  await expect(page.getByRole("status")).toContainText("saved as Home on this device");

  await context.setGeolocation(RIDE_START);
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await expect(page.getByTestId("record-a-ride")).toBeVisible();
  await page.getByTestId("just-ride").click();

  await expect(page).toHaveURL(/\/ride$/);
  await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
  // Just ride starts the ride: no Resume between the tap and riding.
  await openRideSheet(page);
  await expect(page.getByTestId("ride-pause")).toBeVisible();
  await expect(page.getByTestId("free-ride-controls")).toBeVisible();
  await expect(page.getByTestId("free-ride-suggestions-toggle")).toHaveAttribute("aria-pressed", "true");
  // Refresh after the planner/map handoff; a one-shot fix can age past the
  // five-second "good" boundary while the Free Ride surface is starting.
  await context.setGeolocation({ ...RIDE_START, longitude: RIDE_START.longitude + 0.0001 });
  await expect(page.getByTestId("ride-gps")).toContainText("Good GPS fix");

  await clickInRideSheet(page, "free-ride-suggestions-toggle");
  await expect(page.getByTestId("free-ride-suggestions-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("head-home").click();
  await expect(page.getByTestId("free-ride-status")).toContainText("Returning to your saved Home.", { timeout: 30_000 });
  await expect(page.getByTestId("ride-activity")).toHaveText("Guided ride");
  await openRideSheet(page);
  await expect(page.getByTestId("continue-free-ride")).toBeVisible();

  await expectDrawnScene(page, { routes: "1" });
  await expect.poll(async () => (await readDrawnScene(page)).selected).not.toBe("none");
  const returnExtent = await settledExtent(page);
  // The fixture return line spans this full box. Requiring a close fit catches a
  // camera that still frames the default regional extent even though the line is
  // technically inside that much larger view.
  expect(returnExtent.minLon).toBeLessThanOrEqual(-75.44);
  expect(returnExtent.minLat).toBeLessThanOrEqual(40.1308);
  expect(returnExtent.maxLon).toBeGreaterThanOrEqual(-75.4322);
  expect(returnExtent.maxLat).toBeGreaterThanOrEqual(40.1412);
  // The ride map is full-bleed under its chrome (DV-10), so the fitted view
  // reaches a little past the line on every side.
  expect(returnExtent.maxLon - returnExtent.minLon).toBeLessThan(0.07);
  expect(returnExtent.maxLat - returnExtent.minLat).toBeLessThan(0.07);
});
