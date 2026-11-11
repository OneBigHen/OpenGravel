import { expect, test, type Page } from "@playwright/test";

import { expectDrawnScene, plannerMap, pressPlan, settledExtent } from "../critical/map-helpers";
import { rideMapReady, startRide } from "../critical/ride-focus-helpers";
import { directionsTo } from "../critical/search-helpers";

/**
 * Screenshot baselines (world-class round, package 1): "the app cannot
 * quietly get uglier".
 *
 * Eleven screens, a phone and a desktop, day and night, on the fixture map
 * and fixture routes. Every picture is compared pixel for pixel against the
 * checked-in baseline under `baselines.spec.ts-snapshots/`. A design change
 * updates the baseline in the same PR, with a DESIGN.md decision-log line.
 *
 * Baselines are recorded on the GitHub runner (workflow "Visual baselines",
 * run it with update=true), never on a laptop: fonts and GPU rasterisers differ.
 */

const DEVICES = [
  { name: "phone", viewport: { width: 440, height: 956 }, compact: true },
  { name: "desktop", viewport: { width: 1440, height: 900 }, compact: false },
] as const;
type Device = (typeof DEVICES)[number];

const THEMES = ["light", "dark"] as const;
const RIDER = { latitude: 40.8757, longitude: -75.7324 };
/** A fixed mid-afternoon in June: daylight, sunset and weather copy never drift. */
const FIXED_TIME = new Date("2026-06-15T14:00:00-04:00");

async function coldLoad(page: Page): Promise<void> {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
  await settledExtent(page);
}

/** Toasts and focus rings are transient: they must be gone before a picture. */
async function quiet(page: Page): Promise<void> {
  await expect(page.getByTestId("rider-toast")).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  if (await plannerMap(page).count()) await settledExtent(page);
  await page.waitForTimeout(400);
}

async function plannedRoute(page: Page): Promise<void> {
  await coldLoad(page);
  await directionsTo(page);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
  await expectDrawnScene(page, { routes: "2" });
}

const STATES: Record<string, (page: Page, device: Device) => Promise<void>> = {
  "plan-idle": async (page) => coldLoad(page),
  "search-focused": async (page, device) => {
    await coldLoad(page);
    await page.getByTestId(device.compact ? "top-place-search" : "finish-search").click();
  },
  "layers-open": async (page) => {
    await coldLoad(page);
    await page.getByTestId("map-layers-toggle").click();
    await expect(page.getByRole("heading", { name: "Layers", exact: true })).toBeVisible();
  },
  "route-choices": plannedRoute,
  "route-sheet-expanded": async (page, device) => {
    await plannedRoute(page);
    if (device.compact) {
      await page.getByTestId("route-options-settings").click();
      await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "full");
    }
  },
  "loop-planned": async (page, device) => {
    // The start is the rider's own position (geolocation is granted).
    await coldLoad(page);
    if (device.compact && !(await page.getByTestId("ride-shape-loop").isVisible())) {
      await page.getByTestId("loop-near-me").click();
    } else {
      await page.getByTestId("ride-shape-loop").check();
    }
    await pressPlan(page);
    await expect(page.locator('[data-testid^="route-card-"]').first()).toBeAttached({ timeout: 30_000 });
    await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
  },
  // The ride fixture feed puts the rider on the fixture ride, so this is the
  // real riding view (maneuver, strip, buttons), not "head to the start".
  "active-ride": async (page) => {
    await startRide(page);
    await rideMapReady(page);
    await expect(page.getByText(/No GPS fix|Finding you/)).toHaveCount(0, { timeout: 20_000 }).catch(() => {});
  },
  explore: async (page) => {
    await page.goto("/explore");
    await expect(page.getByRole("heading", { name: "Explore" }).first()).toBeVisible();
    await expect(page.locator('.og-skeleton,[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
  },
  "rides-library": async (page) => {
    await page.goto("/rides");
    await expect(page.getByRole("heading", { name: "My rides" }).first()).toBeVisible();
    await expect(page.locator('.og-skeleton,[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
  },
  settings: async (page) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" }).first()).toBeVisible();
  },
  "planner-error": async (page) => {
    await page.route("**/api/route-plan", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }),
    );
    await coldLoad(page);
    await directionsTo(page);
    await expect(page.getByTestId("planner-error")).toBeVisible({ timeout: 30_000 });
  },
};

for (const device of DEVICES) {
  for (const theme of THEMES) {
    test.describe(`${device.name} ${theme}`, () => {
      test.use({
        viewport: device.viewport,
        hasTouch: device.compact,
        isMobile: false,
        colorScheme: theme,
        reducedMotion: "reduce",
        locale: "en-US",
        timezoneId: "America/New_York",
        geolocation: RIDER,
        permissions: ["geolocation"],
      });

      for (const [state, reach] of Object.entries(STATES)) {
        test(state, async ({ page }) => {
          if (state !== "active-ride") await page.clock.setFixedTime(FIXED_TIME);
          await reach(page, device);
          await quiet(page);
          await expect(page).toHaveScreenshot(`${state}-${device.name}-${theme}.png`, {
            animations: "disabled",
            caret: "hide",
            maxDiffPixels: 0,
            timeout: 20_000,
          });
        });
      }
    });
  }
}
