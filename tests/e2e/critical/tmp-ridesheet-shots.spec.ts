import { expect, test } from "@playwright/test";

import { openRideSheet, rideMapReady, startRide } from "./ride-focus-helpers";
import { plannerMap, settledExtent } from "./map-helpers";

// Temporary screenshot driver for the OG-16..26 lane; not committed.
const TAG = process.env.SHOT_TAG ?? "before";
const DIR = ".fable/shots/ride-sheet";
test.describe.configure({ timeout: 150_000 });

for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`shots ${size.width}`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("og.rideFixture.maxFixes", "6"));
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/${TAG}-${size.width}-home.png` });
    await startRide(page);
    await rideMapReady(page);
    await expect(page.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "maneuver", { timeout: 30_000 });
    await page.screenshot({ path: `${DIR}/${TAG}-${size.width}-ride.png` });
    await openRideSheet(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${DIR}/${TAG}-${size.width}-menu-top.png` });
    await page.getByTestId("ride-panel").evaluate((sheet) => {
      sheet.scrollTop = 120;
      for (const s of sheet.querySelectorAll<HTMLElement>("*")) s.scrollTop = 120;
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${DIR}/${TAG}-${size.width}-menu-mid.png` });
    await page.getByTestId("ride-panel").evaluate((sheet) => {
      sheet.scrollTop = 1e6;
      for (const s of sheet.querySelectorAll<HTMLElement>("*")) s.scrollTop = 1e6;
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${DIR}/${TAG}-${size.width}-menu-bottom.png` });
    // OG-18: turn recording off from the Menu and look at what the Menu says.
    await openRideSheet(page);
    await page.getByTestId("ride-panel").evaluate((sheet) => {
      sheet.scrollTop = 0;
      for (const s of sheet.querySelectorAll<HTMLElement>("*")) s.scrollTop = 0;
    });
    await page.getByTestId("ride-recording-toggle").click();
    await page.waitForTimeout(400);
    if (await page.getByTestId("ride-recording-toggle").getAttribute("data-confirm") === "true") {
      await page.getByTestId("ride-recording-toggle").click();
    }
    await page.waitForTimeout(1500);
    await openRideSheet(page);
    await page.screenshot({ path: `${DIR}/${TAG}-${size.width}-recording-off.png` });
  });
}
