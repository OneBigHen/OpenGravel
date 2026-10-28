import { expect, test, type Page } from "@playwright/test";
import { useConnectedRouteFixture } from "./connected-route-fixture";
import { expectDrawnScene, fractionOf, plannerMap, settledExtent } from "./map-helpers";

// Synthetic layer geometry verifies the card-to-command connection, not live road data.
test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true });

async function openRoad(page: Page): Promise<void> {
  let target: { lon: number; lat: number } | null = null;
  await page.route("**/api/map-layers?*", async (route) => {
    const raw = new URL(route.request().url()).searchParams.get("bbox")!;
    const [west, south, east, north] = raw.split(",").map(Number) as [number, number, number, number];
    const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const y = merc(north) - (merc(north) - merc(south)) * 0.4;
    target = { lon: (west + east) / 2, lat: (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI };
    await route.fulfill({ json: { features: [{
      id: "dovetail:road", layerId: "great-roads", name: "Pine Creek Road", detail: "Synthetic browser fixture", weight: 900,
      geometry: { type: "LineString", coordinates: [[target.lon - (east - west) * 0.2, target.lat], [target.lon, target.lat], [target.lon + (east - west) * 0.2, target.lat]] },
    }], unavailable: [] } });
  });
  await page.goto("/");
  await settledExtent(page);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByTestId("map-layer-great-roads").click();
  await expect(page.getByTestId("map-layer-great-roads")).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Close map layers" }).click();
  await expect.poll(() => target).not.toBeNull();
  const extent = await settledExtent(page);
  const fraction = fractionOf(extent, target!);
  const box = await plannerMap(page).boundingBox();
  if (box === null) throw new Error("Map has no rendered bounds");
  await expect(async () => {
    await page.mouse.click(box.x + fraction.x * box.width, box.y + fraction.y * box.height);
    await expect(page.getByTestId("info-feature-card")).toBeVisible();
  }).toPass({ timeout: 10_000 });
}

test("a road card offers both actions and its avoid span can be undone", async ({ page }) => {
  await openRoad(page);
  await expect(page.getByRole("button", { name: "Ride this road", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Avoid this road", exact: true }).click();
  await expect(page.getByTestId("info-feature-card")).toBeHidden();
  await expectDrawnScene(page, { spans: "1" });
  await page.getByTestId("sheet-handle").click();
  await page.getByTestId("undo").click();
  await expectDrawnScene(page, { spans: "0" });
});

test("a map hold creates an avoid area with a reachable Undo action", async ({ page }) => {
  await page.goto("/");
  await settledExtent(page);
  await page.mouse.move(180, 350);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.getByRole("button", { name: "Avoid here (200 m area)" }).click();
  await expectDrawnScene(page, { areas: "1" });
  await page.getByTestId("sheet-handle").click();
  await page.getByTestId("undo").click();
  await expectDrawnScene(page, { areas: "0" });
});

test("route detail keeps its primary action readable beside the offline shortcut", async ({ page }) => {
  await page.goto("/explore/sample-ridge-loop");
  const ride = page.getByTestId("ride-this");
  const offline = page.getByRole("link", { name: "Offline maps", exact: true });
  await expect(ride).toBeInViewport({ ratio: 1 });
  await expect(offline).toBeInViewport({ ratio: 1 });
  const primaryBox = await ride.boundingBox();
  const offlineBox = await offline.boundingBox();
  expect(primaryBox!.y + primaryBox!.height).toBeLessThanOrEqual(offlineBox!.y);
  expect(primaryBox!.width).toBeGreaterThan(320);
  await offline.click();
  await expect(page).toHaveURL(/\/settings#settings-offline-title$/);
  await expect(page.getByRole("heading", { name: "Offline areas" })).toBeInViewport();
});


test("directions keep saved work, briefing, current bike and departure controls reachable", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 40.8757, longitude: -75.7324 });
  await useConnectedRouteFixture(page);
  await page.goto("/");
  await settledExtent(page);
  await page.getByTestId("search-chip-gas").click();
  await page.getByTestId("category-result").first().click();
  await page.getByTestId("place-directions").click();
  await expect(page.getByTestId("route-options")).toBeVisible();
  await expect(page.getByTestId("named-ride-title")).toBeAttached();
  await expect(page.getByTestId("open-share")).toBeAttached();
  await expect(page.getByTestId("prepare-toggle")).toBeAttached();
  await page.getByTestId("route-options-settings").click();
  await page.getByRole("button", { name: /^Bike/ }).click();
  await expect(page.getByRole("link", { name: /Manage bikes in Garage/ })).toBeVisible();
  await page.getByTestId("back-to-options").click();
  await page.getByRole("button", { name: /Time, loop and sunset/ }).click();
  await expect(page.getByTestId("departure-in-3h")).toBeVisible();
});
