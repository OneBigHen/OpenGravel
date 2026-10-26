import { expect, test, type Page } from "@playwright/test";
import { connectedCoordinates, RIDER_FIX, WAWA, useConnectedRouteFixture } from "./connected-route-fixture";
import { clickMapAtCoordinate, expectDrawnScene, expectHealthyMap, fractionOf, plannerMap, settledExtent } from "./map-helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, geolocation: { latitude: 40.8757, longitude: -75.7324 }, permissions: ["geolocation"] });
test.beforeEach(async ({ page }) => { await useConnectedRouteFixture(page); await page.goto("/"); await expect(plannerMap(page)).toBeVisible(); await settledExtent(page); });
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });

test("chip → result → card → Directions → visible route → swap → Start ride", async ({ page }) => {
  await expect(page.getByTestId("top-search")).toBeVisible();
  await expect(page.getByTestId("finish-search")).toHaveCount(0);
  await page.getByTestId("search-chip-gas").click();
  await expect(page.getByTestId("category-results")).toBeVisible();
  await expect(page.getByTestId("clear-ride")).toBeHidden();
  await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "half");
  await page.getByTestId("category-result").first().click();
  await expect(page.getByTestId("place-sheet")).toContainText("Wawa Gas");
  await expect(page.getByTestId("clear-ride")).toBeHidden();
  await expectAboveSheet(page, [{ lat: 40.864, lon: -75.728 }]);
  await page.getByTestId("place-directions").click();
  await expect(page.getByTestId("phone-alternatives")).toBeVisible();
  await expect(page.getByTestId("start-ride")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "half");
  const sheet = await page.getByTestId("planner-sheet").boundingBox();
  expect(sheet!.y).toBeGreaterThanOrEqual(422);
  await expectDrawnScene(page, { routes: "2", points: "2" });
  const coordinates = connectedCoordinates();
  await expectAboveSheet(page, coordinates);
  await expect(page.getByTestId("route-options-header")).toHaveText("My location → Wawa Gas");
  await page.getByTestId("route-options-swap").click();
  await expect(page.getByTestId("route-options-header")).toHaveText("Wawa Gas → My location");
  await page.getByTestId("route-options-edit").click();
  await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "full");
  await expect(page.getByTestId("start-value")).toHaveAttribute("data-coordinate", "40.8640, -75.7280");
  await expect(page.getByTestId("finish-value")).toHaveAttribute("data-coordinate", "40.8757, -75.7324");
  await page.getByTestId("back-to-options").click();
  await page.getByTestId("sheet-handle").press("ArrowDown");
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await expectAboveSheet(page, connectedCoordinates(WAWA, RIDER_FIX));
  await expectHealthyMap(page);
  await page.getByTestId("start-ride").click();
  await expect(page).toHaveURL(/\/ride/);
});

test("a category pin opens the same place card", async ({ page }) => {
  await page.getByTestId("search-chip-gas").click();
  await expect(page.getByTestId("category-result")).toBeVisible();
  await settledExtent(page);
  await page.waitForTimeout(750);
  await clickMapAtCoordinate(page, { lat: 40.864, lon: -75.728 });
  await expect(page.getByTestId("place-sheet")).toContainText("Wawa Gas");
});

test("long-press → What's here → card", async ({ page }) => {
  const map = plannerMap(page);
  await expect(page.getByTestId("start-value")).toHaveAttribute("data-coordinate", /.+/);
  await settledExtent(page);
  // A hold during the initial camera glide only stops it (map contract §2).
  await page.waitForTimeout(750);
  const cdp = await page.context().newCDPSession(page);
  const bounds = await map.boundingBox();
  const at = { x: bounds!.x + 110, y: bounds!.y + 280, id: 0 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
  await page.waitForTimeout(550);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await expect(page.getByTestId("map-point-menu")).toBeVisible();
  await page.getByRole("button", { name: "What's here?" }).click();
  await expect(page.getByTestId("place-sheet")).toBeVisible();
  await expect(page.getByTestId("place-directions")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start here", exact: true })).toBeVisible();
  await expect(page.getByTestId("map-point-menu")).toHaveCount(0);
});

for (const width of [1024, 1440]) {
  test(`search opens the same card at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const input = page.getByTestId(width <= 1180 ? "top-place-search" : "finish-search");
    await input.fill("Hawk Mountain Sanctuary");
    await input.press("Enter");
    await expect(page.getByTestId("place-sheet")).toBeVisible();
    await expect(page.getByTestId("place-directions")).toBeVisible();
  });
}

test("denied location leaves the start editor focused", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator.geolocation, "watchPosition", { configurable: true,
      value: (_success: PositionCallback, failure: PositionErrorCallback) => {
        queueMicrotask(() => failure({ code: 1, message: "Denied for this test", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
        return 123;
      } });
  });
  await page.getByTestId("top-place-search").fill("Hawk Mountain Sanctuary");
  await page.getByTestId("top-place-search").press("Enter");
  await page.getByTestId("place-directions").click();
  await expect(page.getByTestId("start-search")).toBeFocused();
  await expect(page.getByTestId("start-search-status")).toContainText("Location permission is off");
  await expect(page.getByTestId("phone-alternatives")).toHaveCount(0);
});

/** Check the actual published camera against the drawn fixture and authored endpoints. */
export async function expectAboveSheet(page: Page, coordinates: readonly { lat: number; lon: number }[]) {
  await expect.poll(async () => {
    const extent = await settledExtent(page);
    const map = await plannerMap(page).boundingBox();
    const sheet = await page.getByTestId("planner-sheet").boundingBox();
    const top = await page.getByTestId("top-search").boundingBox();
    if (map === null || sheet === null) return false;
    return coordinates.every((coordinate) => {
      const fraction = fractionOf(extent, coordinate);
      const x = map.x + fraction.x * map.width, y = map.y + fraction.y * map.height;
      return x >= map.x + 8 && x <= map.x + map.width - 8 && y >= (top === null ? map.y : top.y + top.height) + 8 && y <= sheet.y - 8;
    });
  }, { timeout: 15_000, message: "route and pins fit between the search chrome and the sheet" }).toBe(true);
}

for (const width of [320, 1024]) {
  test(`shared detents frame a place and Directions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    if (width === 1024) {
      const handle = page.getByTestId("sheet-handle"), sheet = page.getByTestId("planner-sheet");
      await expect(handle).toBeVisible();
      await handle.press("ArrowUp");
      await expect(sheet).toHaveAttribute("data-detent", "half");
      await handle.press("ArrowUp");
      await expect(sheet).toHaveAttribute("data-detent", "full");
      await handle.press("ArrowDown");
      await handle.press("ArrowDown");
      await expect(sheet).toHaveAttribute("data-detent", "peek");
    }
    await page.getByTestId("search-chip-gas").click();
    await page.getByTestId("category-result").first().click();
    await expectAboveSheet(page, [{ lat: 40.864, lon: -75.728 }]);
    await page.getByTestId("sheet-handle").press("ArrowUp");
    await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "full");
    await expectAboveSheet(page, [{ lat: 40.864, lon: -75.728 }]);
    await page.getByTestId("sheet-handle").press("ArrowDown");
    await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "half");
    await page.getByTestId("place-directions").click();
    await expect(page.getByTestId("route-options")).toBeVisible();
    await expect(page.getByTestId("start-ride")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("phone-alternatives").getByRole("button").first()).toBeInViewport({ ratio: 1 });
    await expectDrawnScene(page, { routes: "2" });
    await expectAboveSheet(page, connectedCoordinates());
    await page.getByTestId("route-options-settings").click();
    await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "full");
    await expectAboveSheet(page, connectedCoordinates());
    await expect(page.getByTestId("surface-preference")).toBeVisible();
    const replan = page.waitForRequest((request) => request.url().includes("/api/route-plan") && request.method() === "POST"
      && request.postDataJSON().request.options.surfacePreference === "pavement");
    await page.getByTestId("surface-preference-pavement").check();
    await replan;
    await expect(page.getByTestId("status-line")).toHaveText("Updating ride…");
    await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  });
}
