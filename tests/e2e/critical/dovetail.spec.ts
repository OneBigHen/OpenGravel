import { expect, test, type Page } from "@playwright/test";
import { useConnectedRouteFixture } from "./connected-route-fixture";
import { expectDrawnScene, clickMapAtCoordinate, plannerMap, settledExtent } from "./map-helpers";

// Synthetic layer geometry verifies the card-to-command connection, not live road data.
test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, geolocation: { latitude: 40.8757, longitude: -75.7324 }, permissions: ["geolocation"] });

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
  await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  // Twisty roads are on at a cold open now (first-minute wow, W1): the switch is
  // already on, so only a rider's saved choice could have turned it off.
  const twisty = page.getByTestId("map-layer-great-roads");
  if (await twisty.getAttribute("aria-checked") !== "true") await twisty.click();
  await expect(twisty).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Close map layers" }).click();
  await expect.poll(() => target, { timeout: 20_000 }).not.toBeNull();
  // The line's coordinate comes from the view the stub answered, and the camera
  // refits when the sheet opens and closes: the click is measured against the
  // camera that is on screen at the moment of the tap, never a stale one.
  await expect(async () => {
    const point = target;
    if (point === null) throw new Error("the layer stub has not answered a view yet");
    await clickMapAtCoordinate(page, point);
    await expect(page.getByTestId("info-feature-card")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
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

test("route detail keeps its primary action readable and offers no offline dead end", async ({ page }) => {
  await page.goto("/explore/sample-ridge-loop");
  const ride = page.getByTestId("ride-this");
  await expect(ride).toBeInViewport({ ratio: 1 });
  const primaryBox = await ride.boundingBox();
  expect(primaryBox!.width).toBeGreaterThan(320);
  // Offline downloads return in R3-7 with a real control; until then the page
  // does not link to an empty Settings section.
  await expect(page.getByRole("link", { name: "Offline maps", exact: true })).toHaveCount(0);
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
  // A destination shows the same summary as a loop (R3-4): Start, Save, Share.
  await expect(page.getByTestId("route-options").getByTestId("route-summary")).toBeVisible();
  await expect(page.getByTestId("summary-save")).toBeAttached();
  await expect(page.getByTestId("open-share")).toBeAttached();
  await expect(page.getByTestId("prepare-toggle")).toBeAttached();
  // Saved work lives in the full sheet; half height keeps the route on screen.
  await page.getByTestId("sheet-handle").press("ArrowUp");
  await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "full");
  await page.getByTestId("summary-save").click();
  await expect(page.getByTestId("summary-save")).toHaveText("Saved");
  await page.getByTestId("ride-title-edit").click();
  await page.getByTestId("ride-title-input").fill("Weekend route");
  await page.getByTestId("ride-title-input").press("Enter");
  await page.getByTestId("route-options-settings").click();
  await page.getByRole("button", { name: /^Bike/ }).click();
  await expect(page.getByRole("link", { name: /Manage bikes in Garage/ })).toBeVisible();
  await page.getByTestId("back-to-options").click();
  await page.getByRole("button", { name: /Time, loop and sunset/ }).click();
  await expect(page.getByRole("radio", { name: "In 3 h", exact: true })).toBeVisible();
  await page.getByTestId("back-to-options").click();
  await page.getByTestId("back-to-options").click();
  // The saved ride and its name survive a trip through Options.
  await expect(page.getByTestId("phone-destination")).toHaveText("Weekend route");
  await expect(page.getByTestId("summary-save")).toHaveText("Saved");
  await page.unrouteAll({ behavior: "wait" });
});


test("camera provenance stays visible in the phone layers sheet", async ({ page }) => {
  // Traffic cameras are offered in Layers only after Settings turns them on
  // (front-door.spec.ts drives that switch); this spec is about their sheet.
  await page.addInitScript(() => localStorage.setItem("og-front-door-cameras", "on"));
  await page.goto("/");
  await settledExtent(page);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByTestId("map-layer-traffic-cameras").click();
  const provenance = page.getByTestId("camera-provenance");
  await provenance.scrollIntoViewIfNeeded();
  await expect(provenance).toBeInViewport();
  await expect(provenance).toContainText(/Observed|Observation time unknown/);
});
