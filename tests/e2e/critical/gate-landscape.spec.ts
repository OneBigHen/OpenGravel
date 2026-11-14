import { expect, test } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";
import { openRideSheet, rideMapReady, startRide } from "./ride-focus-helpers";
import {
  LANDSCAPE,
  expectNoSidewaysScroll,
  expectReachable,
  floatingControlProblems,
  settleChrome,
  waitingOn,
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
 * Waiting on PR #242 (small phones and landscape): on main Layers and the edit bar sit on top of the
 * tabs/search in landscape. Remove `waitingOn` when #242 lands.
 */
test.describe.configure({ timeout: 150_000 });

const WAIT_242 = "waiting on PR #242 (small phones and landscape): on main Layers sits over the tabs and search in landscape";

test("turning the phone sideways mid-plan keeps nav, Layers and the sheet actions reachable", async ({ page }) => {
  waitingOn(WAIT_242);
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
  await expectReachable(page, page.getByTestId("primary-nav").getByRole("link").first(), "the first nav tab");
  await expectReachable(page, page.getByTestId("map-layers-toggle"), "the Layers button");
  await expectReachable(page, page.getByTestId("app-menu"), "the menu button");
  // Sheet actions: Start is the one to ride; Save and Share are the quiet choices beside it.
  await page.getByTestId("planner-sheet").evaluate((sheet) => sheet.scrollIntoView({ block: "nearest" }));
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
  waitingOn(WAIT_242);
  await page.addInitScript(() => window.localStorage.setItem("og.rideFixture.maxFixes", "6"));
  await page.setViewportSize({ width: 390, height: 844 });
  await startRide(page);
  await rideMapReady(page);
  await expect(page.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "maneuver", { timeout: 30_000 });

  await page.setViewportSize(LANDSCAPE);
  await settleChrome(page);
  await expectNoSidewaysScroll(page, "ride in landscape");
  await expectReachable(page, page.getByTestId("ride-menu"), "the ride Menu button");
  await expectReachable(page, page.getByTestId("ride-strip"), "the ride strip");
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
