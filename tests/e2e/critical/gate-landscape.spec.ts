import { expect, test } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";
import { openRideSheet, rideMapReady, startRide } from "./ride-focus-helpers";
import {
  LANDSCAPE,
  expectNoSidewaysScroll,
  expectReachable,
  floatingControlProblems,
  settleChrome,
  withWeatherAlert,
} from "./rider-gate-helpers";
import { directionsTo } from "./search-helpers";

/**
 * GATE-LANDSCAPE (#326; behind QA-08).
 *
 * The phone is turned on its side WHILE the rider is mid-task (planning, then riding): everything they
 * need stays on screen and reachable. A control counts only if its whole box is inside 844x390 and a tap
 * at its centre lands on it.
 *
 * On its side the phone has no round Menu button: Settings sits at the end of the tab row instead, so the
 * gate wants every tab and Settings reachable.
 */
test.describe.configure({ timeout: 150_000 });

test("turning the phone sideways mid-plan keeps nav, Layers and the sheet actions reachable", async ({ page }) => {
  await withWeatherAlert(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await directionsTo(page);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });

  // Rotate with the plan on screen.
  await page.setViewportSize(LANDSCAPE);
  await settleChrome(page);
  await expectNoSidewaysScroll(page, "plan in landscape");
  const tabs = page.getByTestId("primary-nav").getByRole("link");
  const tabCount = await tabs.count();
  expect(tabCount, "the tab row has its tabs").toBeGreaterThanOrEqual(3);
  for (let i = 0; i < tabCount; i += 1) {
    await expectReachable(page, tabs.nth(i), `nav tab ${i + 1} of ${tabCount}`);
  }
  // Settings is the way to the menu on its side (the round Menu button is hidden there).
  await expectReachable(page, page.locator(".og-planner__settings-link"), "Settings");
  await expectReachable(page, page.getByTestId("map-layers-toggle"), "the Layers button");
  // Sheet actions: Start is the one to ride; Save and Share are the quiet choices beside it.
  // No scrolling first: the rider turns the phone and Start has to be right there.
  await expectReachable(page, page.getByTestId("start-ride"), "Start");
  await expectReachable(page, page.getByTestId("summary-save"), "Save");
  expect(await floatingControlProblems(page), "plan in landscape").toEqual([]);

  // And back upright: nothing was left behind in the landscape layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await settleChrome(page);
  await expectReachable(page, page.getByTestId("start-ride"), "Start (upright again)");
  expect(await floatingControlProblems(page), "plan upright again").toEqual([]);
});

test("turning the phone sideways mid-ride keeps the ride controls reachable", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("og.rideFixture.maxFixes", "6"));
  await page.setViewportSize({ width: 390, height: 844 });
  await startRide(page);
  await rideMapReady(page);
  await expect(page.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "maneuver", { timeout: 30_000 });

  await page.setViewportSize(LANDSCAPE);
  await settleChrome(page);
  await expectNoSidewaysScroll(page, "ride in landscape");
  await expectReachable(page, page.getByTestId("ride-menu"), "the ride Menu button");
  await expectReachable(page, page.getByRole("button", { name: "Show the whole route" }), "Show the whole route");
  await expectReachable(page, page.getByTestId("ride-maneuver"), "the next-turn banner");
  for (const readout of [/^Speed/, /^Distance left/, /^Arrival/]) {
    await expectReachable(page, page.getByRole("button", { name: readout }), `the ${String(readout)} readout`);
  }
  expect(await floatingControlProblems(page), "ride in landscape").toEqual([]);

  // The Menu opens and its actions can be reached by scrolling inside it (it closes itself after 8 s idle).
  await openRideSheet(page);
  for (const id of ["ride-pause", "ride-stop"]) {
    const control = page.getByTestId(id);
    if ((await control.count()) === 0) continue;
    await control.scrollIntoViewIfNeeded();
    await expectReachable(page, control, id);
  }
});
