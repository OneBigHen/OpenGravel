import { expect, test } from "@playwright/test";
import { plannerMap, settledExtent } from "./map-helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, geolocation: { latitude: 40.8757, longitude: -75.7324 }, permissions: ["geolocation"] });
test.beforeEach(async ({ page }) => { await page.goto("/"); await expect(plannerMap(page)).toBeVisible(); await settledExtent(page); });

test("chip → result → card → Directions → route options", async ({ page }) => {
  await expect(page.getByTestId("top-search")).toBeVisible();
  await expect(page.getByTestId("finish-search")).toHaveCount(0);
  await page.getByTestId("search-chip-gas").click();
  await expect(page.getByTestId("category-results")).toBeVisible();
  await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "half");
  await page.getByTestId("category-result").first().click();
  await expect(page.getByTestId("place-sheet")).toContainText("Wawa Gas");
  await page.getByTestId("place-directions").click();
  await expect(page.getByTestId("phone-alternatives")).toBeVisible();
  await expect(page.getByTestId("start-ride")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "half");
  const sheet = await page.getByTestId("planner-sheet").boundingBox();
  expect(sheet!.y).toBeGreaterThanOrEqual(422);
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
