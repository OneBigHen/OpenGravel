import { expect, test, type Page } from "@playwright/test";

import { clickMapAtCoordinate, expectDrawnScene, plannerMap } from "./map-helpers";

/**
 * First-minute wow on the map (design picks, `.fable/MAPWOW-BRIEF.md`), W5: the
 * curated catalog rides are drawn when the map is zoomed out, a tap opens a
 * small card, and nothing opens the ride until the rider taps "Ride this".
 *
 * The line is synthetic on purpose: this proves the card and the Explore
 * "Ride this" handoff are wired to each other, not what a road happens to look
 * like. The route id it names is the e2e catalog fixture route, so tapping
 * "Ride this" runs the real handoff against `/api/catalog/<id>`.
 */

const ROUTE_ID = "sample-ridge-loop";
const ROUTE_NAME = "Sample Ridge Loop";

test.use({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  hasTouch: true,
});

/**
 * Answers `/api/map-layers` with one rider-picked outline across the middle of
 * the view, and reports the coordinate to tap once the layer has been asked for.
 */
async function stubCuratedRide(page: Page): Promise<() => { readonly lon: number; readonly lat: number } | null> {
  let target: { lon: number; lat: number } | null = null;
  await page.route("**/api/map-layers?*", async (route) => {
    const raw = new URL(route.request().url()).searchParams.get("bbox")!;
    const [west, south, east, north] = raw.split(",").map(Number) as [number, number, number, number];
    const merc = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const y = merc(north) - (merc(north) - merc(south)) * 0.4;
    target = { lon: (west + east) / 2, lat: (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI };
    await route.fulfill({ json: {
      features: [{
        id: `catalog:${ROUTE_ID}`,
        layerId: "rider-picked",
        name: ROUTE_NAME,
        detail: "17 mi · 12% gravel · 2 mi",
        weight: null,
        catalogRide: { routeId: ROUTE_ID, miles: 17, surface: { unpavedMiles: 2, unpavedKind: "gravel" } },
        geometry: {
          type: "LineString",
          coordinates: [
            [target.lon - (east - west) * 0.2, target.lat],
            [target.lon, target.lat],
            [target.lon + (east - west) * 0.2, target.lat],
          ],
        },
      }],
      unavailable: [],
    } });
  });
  return () => target;
}

test("a curated ride opens only when the rider taps Ride this", async ({ page }) => {
  const targetOf = await stubCuratedRide(page);
  await page.goto("/");
  await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });

  // The line is on the map with no taps: that is W5's whole claim. Layer data
  // waits for the renderer's first frame, so the stub is asked once it is ready.
  await expect.poll(() => targetOf(), { timeout: 20_000 }).not.toBeNull();
  await expect(async () => {
    const point = targetOf();
    if (point === null) throw new Error("the layer stub has not answered a view yet");
    await clickMapAtCoordinate(page, point);
    await expect(page.getByTestId("info-feature-card")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });

  // The card says the route's own name, miles, surface and source.
  const card = page.getByTestId("info-feature-card");
  await expect(card.getByRole("heading", { name: ROUTE_NAME })).toBeVisible();
  await expect(card.getByText("17 mi")).toBeVisible();
  await expect(card.getByTestId("curated-ride-surface")).toHaveText("12% gravel · 2.0 mi");
  await expect(card.getByText(/From PA Adventure Bike Rides/)).toBeVisible();

  // Nothing has changed on the map: no ride, no route line, no title.
  await expect(page.getByTestId("active-ride-title")).toHaveCount(0);
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(0);
  await expectDrawnScene(page, { routes: "0" });

  // The one commitment opens the ride through Explore's own handoff.
  await card.getByTestId("info-feature-ride-this").click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await expect(page.getByTestId("active-ride-title")).toHaveText(ROUTE_NAME, { timeout: 20_000 });
  const ride = page.locator('[data-testid^="route-card-"]');
  await expect(ride).toHaveCount(1);
  await expect(ride).toContainText("17 mi");
  // The same summary every route shows (R3-4), titled by the ride's own name.
  const summary = page.getByTestId("route-summary");
  await expect(summary.getByTestId("phone-destination")).toHaveText(ROUTE_NAME);
  await expect(summary).toContainText("17 mi");
  await expect(summary.getByTestId("phone-surface-line")).toBeVisible();
  await expect(page.getByTestId("start-ride")).toBeEnabled({ timeout: 5_000 });
});
