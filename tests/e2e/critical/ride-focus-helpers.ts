import { expect, type Page } from "@playwright/test";

import {
  clickMapAtCoordinate,
  plannerMap,
  settledExtent,
  type Coordinate,
} from "./map-helpers";

export const RIDE_FIXTURE_START: Coordinate = { lon: -75.4385, lat: 40.1385 };
export const RIDE_FIXTURE_DESTINATION: Coordinate = { lon: -75.4335, lat: 40.1325 };

/** Places the route-plan fixture ride and follows the planner's real handoff. */
export async function startRide(page: Page): Promise<void> {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);

  await clickMapAtCoordinate(page, RIDE_FIXTURE_START);
  await clickMapAtCoordinate(page, RIDE_FIXTURE_DESTINATION);
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);

  const start = page.getByTestId("start-ride");
  await expect(start).toBeEnabled();
  await start.click();

  await expect(page).toHaveURL(/\/ride$/);
  await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
}

/**
 * Opens the ride sheet (DV-10): Pause, Stop, GPS details and the rest live
 * behind the strip. Idempotent; call it right before using a sheet control,
 * because the sheet closes itself 8 s after the last touch.
 */
export async function openRideSheet(page: Page): Promise<void> {
  const focus = page.getByTestId("ride-focus");
  // The sheet also opens and closes by itself (a pause holds it, Resume lets
  // it go), so settle on "open" rather than trusting one read.
  await expect(async () => {
    if ((await focus.getAttribute("data-sheet")) !== "open") await page.getByTestId("ride-strip").click();
    await expect(focus).toHaveAttribute("data-sheet", "open", { timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
}

/**
 * Clicks a control inside the ride sheet. Opening and clicking retry together:
 * on a slow renderer the sheet's 8 s auto-close can land between the two, and
 * a click then waits on a hidden button. The sheet's slide keeps the button
 * "unstable" to Playwright's actionability wait, so the click is dispatched
 * once the button is visible. When `landed` names what the click puts on
 * screen, a retry first checks for it, so a click that landed is never
 * repeated on a control its result has replaced.
 */
export async function clickInRideSheet(page: Page, testId: string, landed?: string): Promise<void> {
  const button = page.getByTestId(testId);
  const effect = landed ? page.getByTestId(landed) : null;
  await expect(async () => {
    if (effect && (await effect.isVisible())) return;
    await openRideSheet(page);
    await expect(button).toBeVisible({ timeout: 2_000 });
    await button.dispatchEvent("click");
    if (effect) await expect(effect).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Waits for Ride Focus's MapLibre renderer and its opening camera fit. */
export async function rideMapReady(page: Page): Promise<void> {
  await expect(plannerMap(page)).toBeVisible();
  await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
  await settledExtent(page);
}
