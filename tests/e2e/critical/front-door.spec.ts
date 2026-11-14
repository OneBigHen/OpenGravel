import { expect, test, type Page } from "@playwright/test";

import { expectDrawnScene, plannerMap, settledExtent } from "./map-helpers";

/**
 * Milestone 3, "one clean front door" (docs/PLAN.md).
 *
 * A rider who opens the app sees search, Loop and Ride, and nothing else
 * competing. The side features (the Ride / Hike switch, music, traffic
 * cameras and the AI Ask button) are one tap into Settings. Each one is proved
 * here from a cold load (a fresh browser context: nothing stored) on a phone
 * and on a desktop:
 *
 * - the first screen does not show them;
 * - Settings does, and the Ask and traffic-camera switches bring them back;
 * - a planned route is on screen after three taps or fewer.
 *
 * It uses the same fixtures as the rest of the critical gate: the labelled
 * route-plan fixture, the fixture geocoder and the empty basemap. A "tap" is
 * one deliberate touch of the screen: the search box, sending the search, and
 * Directions. Typing between them is not a tap, and the Enter that sends the
 * search is counted as one to stay on the safe side.
 */

const DEVICES = [
  { name: "phone", viewport: { width: 440, height: 956 }, compact: true },
  { name: "desktop", viewport: { width: 1440, height: 900 }, compact: false },
] as const;

type Device = (typeof DEVICES)[number];

/** Where the rider "is" for Directions, the same place the other search specs use. */
const RIDER = { latitude: 40.8757, longitude: -75.7324 };

/** A cold load: a new context has no stored choices, so every option is at its default. */
async function coldLoad(page: Page): Promise<void> {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
}

function searchBox(page: Page, device: Device) {
  return page.getByTestId(device.compact ? "top-place-search" : "finish-search");
}

/** What the first screen keeps: search, Loop and Ride (plus Record, which sits beside them). */
async function expectSearchLoopAndRide(page: Page, device: Device): Promise<void> {
  await expect(searchBox(page, device)).toBeVisible();
  if (device.compact) {
    await expect(page.getByTestId("loop-near-me")).toBeVisible();
  } else {
    await expect(page.getByTestId("ride-shape").getByText("Loop from start", { exact: true })).toBeVisible();
  }
  await expect(page.getByTestId("just-ride")).toBeVisible();
  await expect(page.getByTestId("record-a-ride")).toBeVisible();
}

/** What the first screen must not show, in rider words and in test ids. */
async function expectNoSideFeatures(page: Page): Promise<void> {
  // Ride / Hike: nowhere on the map screen, not even inside the Menu.
  await expect(page.getByTestId("activity-hike")).toHaveCount(0);
  await expect(page.getByTestId("activity-ride")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Hike", exact: true })).toHaveCount(0);
  // Music: nothing named Music or Spotify.
  await expect(page.getByRole("button", { name: /spotify|music/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /spotify|music/i })).toHaveCount(0);
  await expect(page.getByText(/spotify|music/i)).toHaveCount(0);
  // Ask: neither the button nor the sheet it opens.
  await expect(page.getByTestId("map-ask-open")).toHaveCount(0);
  await expect(page.getByTestId("map-ask-sheet")).toHaveCount(0);
  await expect(page.getByTestId("advisor-open")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Ask\b/ })).toHaveCount(0);
  // Traffic cameras: no toggle on the face of the map.
  await expect(page.getByText(/traffic camera/i)).toHaveCount(0);
}

async function openLayers(page: Page): Promise<void> {
  await page.getByTestId("map-layers-toggle").click();
  await expect(page.getByRole("heading", { name: "Layers", exact: true })).toBeVisible();
}

async function closeLayers(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close map layers" }).click();
  await expect(page.getByTestId("map-layer-live-traffic")).toHaveCount(0);
}

/** Settings from the map screen: the Menu on a phone, the top bar on a desktop. Returns the taps it took. */
async function openSettings(page: Page, device: Device): Promise<number> {
  if (device.compact) {
    await page.getByTestId("app-menu").click();
    await page.getByTestId("app-menu-settings").click();
    await expect(page).toHaveURL(/\/settings$/);
    return 2;
  }
  await page.getByTestId("primary-nav").getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  return 1;
}

async function backToMap(page: Page): Promise<void> {
  await page.getByTestId("primary-nav").getByRole("link", { name: "Map", exact: true }).click();
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
}

/** Search, send, Directions: the whole way to a planned route. Returns the taps it took. */
async function planFirstRoute(page: Page, device: Device): Promise<number> {
  await page.context().setGeolocation(RIDER);
  await page.context().grantPermissions(["geolocation"]);
  let taps = 0;
  const field = searchBox(page, device);
  await field.click();
  taps += 1;
  await field.fill("Hawk Mountain Sanctuary");
  await field.press("Enter");
  taps += 1;
  await expect(page.getByTestId("place-sheet")).toBeVisible();
  await page.getByTestId("place-directions").click();
  taps += 1;
  await expect(page.getByTestId("place-sheet")).toHaveCount(0);
  return taps;
}

async function expectPlannedRouteOnScreen(page: Page, device: Device): Promise<void> {
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await expectDrawnScene(page, { routes: "2" });
  if (device.compact) {
    await expect(page.getByTestId("start-ride")).toBeVisible();
  } else {
    await expect(page.locator('[data-testid^="route-card-"]').first()).toBeVisible();
  }
}

for (const device of DEVICES) {
  test.describe(`front door on a ${device.name}`, () => {
    test.use({ viewport: device.viewport, ...(device.compact ? { hasTouch: true } : {}) });

    test("a cold load shows search, Loop and Ride, and none of the side features", async ({ page }) => {
      await coldLoad(page);
      await expectSearchLoopAndRide(page, device);
      await expectNoSideFeatures(page);

      // The map already says where the good riding is: one legend chip, no panel
      // and no tutorial (first-minute wow, W1).
      await expect(page.getByTestId("map-legend")).toBeVisible();

      // The Menu on a phone holds Settings and Day / Night only: no Ride / Hike switch.
      if (device.compact) {
        await page.getByTestId("app-menu").click();
        await expect(page.getByTestId("app-menu-settings")).toBeVisible();
        await expect(page.getByTestId("activity-hike")).toHaveCount(0);
        await page.keyboard.press("Escape");
      }

      // Traffic cameras are not in Layers either until Settings offers them.
      await openLayers(page);
      await expect(page.getByTestId("map-layer-great-roads")).toBeVisible();
      // Gravel, twisty roads and the curated rides are on before the rider taps
      // anything; the legend chip is the second way into this sheet.
      await expect(page.getByTestId("map-layer-gravel")).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("map-layer-great-roads")).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("map-layer-rider-picked")).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("map-layer-traffic-cameras")).toHaveCount(0);
      await expect(page.getByText(/traffic camera/i)).toHaveCount(0);
      await closeLayers(page);
    });

    test("the legend chip opens Layers, and turning the cold-open layers off sticks", async ({ page }) => {
      await coldLoad(page);
      await page.getByTestId("map-legend").click();
      await expect(page.getByRole("heading", { name: "Layers", exact: true })).toBeVisible();
      await page.getByTestId("map-layer-gravel").click();
      await page.getByTestId("map-layer-great-roads").click();
      await page.getByTestId("map-layer-rider-picked").click();
      await expect(page.getByTestId("map-layer-gravel")).toHaveAttribute("aria-checked", "false");
      await closeLayers(page);
      // Nothing left to explain: the legend goes with the layers.
      await expect(page.getByTestId("map-legend")).toHaveCount(0);

      // A rider's own choice wins over the cold-open set, across a reload.
      await page.reload();
      await expect(plannerMap(page)).toBeVisible();
      await settledExtent(page);
      await expect(page.getByTestId("map-legend")).toHaveCount(0);
      await openLayers(page);
      await expect(page.getByTestId("map-layer-gravel")).toHaveAttribute("aria-checked", "false");
      await expect(page.getByTestId("map-layer-great-roads")).toHaveAttribute("aria-checked", "false");
      await expect(page.getByTestId("map-layer-rider-picked")).toHaveAttribute("aria-checked", "false");
      await closeLayers(page);
    });

    test("a planned route is on screen in three taps or fewer from a cold load", async ({ page }) => {
      await coldLoad(page);
      const taps = await planFirstRoute(page, device);
      await expectPlannedRouteOnScreen(page, device);
      expect(taps).toBeLessThanOrEqual(3);
    });

    test("the hike switch, music, cameras and Ask are one tap into Settings, and two of them switch back on", async ({ page }) => {
      await coldLoad(page);
      const taps = await openSettings(page, device);
      expect(taps).toBeLessThanOrEqual(2);
      await page.getByRole("button", { name: "Show more settings" }).click();

      // Ride is the default and Hike is one tap away. Hiking itself is untouched:
      // this only proves the switch is here and goes both ways.
      const ride = page.getByTestId("activity-ride");
      const hike = page.getByTestId("activity-hike");
      await expect(ride).toBeVisible();
      await expect(ride).toHaveAttribute("aria-checked", "true");
      await expect(hike).toHaveAttribute("aria-checked", "false");
      await hike.click();
      await expect(hike).toHaveAttribute("aria-checked", "true");
      await ride.click();
      await expect(ride).toHaveAttribute("aria-checked", "true");

      // Music sits in the same closed group.
      await expect(page.getByTestId("settings-music-row")).toBeVisible();
      await expect(page.getByRole("button", { name: "Connect Spotify" })).toBeVisible();

      // Ask and traffic cameras start off, and each has a switch.
      const ask = page.getByTestId("settings-ask-toggle");
      const cameras = page.getByTestId("settings-cameras-toggle");
      await expect(ask).toBeVisible();
      await expect(cameras).toBeVisible();
      await expect(ask).not.toBeChecked();
      await expect(cameras).not.toBeChecked();
      await ask.check();
      await cameras.check();
      await expect(ask).toBeChecked();
      await expect(cameras).toBeChecked();

      // Back on the map: traffic cameras are in Layers again, straight away
      // and after a reload (the choice is kept on this device).
      await backToMap(page);
      await openLayers(page);
      await expect(page.getByTestId("map-layer-traffic-cameras")).toBeVisible();
      await closeLayers(page);
      await page.reload();
      await expect(plannerMap(page)).toBeVisible();
      await settledExtent(page);
      await openLayers(page);
      await expect(page.getByTestId("map-layer-traffic-cameras")).toBeVisible();
      await closeLayers(page);

      // Ask is back where it was: in the search row on a phone, and (once a ride
      // is planned) in the sheet's Options on a phone or under the ride in the
      // desktop's ride panel. The desktop's first screen has no search row for it.
      if (device.compact) await expect(page.getByTestId("map-ask-open")).toBeVisible();
      await planFirstRoute(page, device);
      await expectPlannedRouteOnScreen(page, device);
      if (device.compact) {
        // PF-3: with a ride shown, Ask moved from the map into the sheet's Options.
        await page.getByTestId("sheet-handle").click();
        await page.getByTestId("route-options-settings").click();
      }
      await expect(page.getByTestId(device.compact ? "map-ask-open" : "advisor-ride-ask")).toBeVisible();
    });

    test("turning the switches off again clears the front door", async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("og-front-door-ask", "on");
        localStorage.setItem("og-front-door-cameras", "on");
      });
      await page.goto("/settings");
      await page.getByRole("button", { name: "Show more settings" }).click();
      const ask = page.getByTestId("settings-ask-toggle");
      const cameras = page.getByTestId("settings-cameras-toggle");
      await expect(ask).toBeChecked();
      await expect(cameras).toBeChecked();
      await ask.uncheck();
      await cameras.uncheck();
      await expect(ask).not.toBeChecked();
      await expect(cameras).not.toBeChecked();
      expect(await page.evaluate(() => [localStorage.getItem("og-front-door-ask"), localStorage.getItem("og-front-door-cameras")])).toEqual([null, null]);
    });
  });
}
