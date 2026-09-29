import { expect, test } from "@playwright/test";
import { clickInRideSheet } from "./ride-focus-helpers";
import { expectDrawnScene } from "./map-helpers";

test.use({ viewport: { width: 440, height: 956 } });

test("a Free Ride offer draws its route, skips left, and starts guidance on a right swipe", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  // Browser emulation has no speed reading. Supply an explicit, stationary
  // GPS feed rather than pretending that an unknown speed means stopped.
  await page.addInitScript(() => {
    const position = (): GeolocationPosition => ({
      coords: { longitude: -75.44, latitude: 40.14, accuracy: 6, altitude: null, altitudeAccuracy: null, heading: 35, speed: 0,
        toJSON() { return {}; } },
      timestamp: Date.now(), toJSON() { return {}; },
    });
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition(success: PositionCallback) { success(position()); },
      watchPosition(success: PositionCallback) {
        success(position());
        return window.setInterval(() => success(position()), 1000);
      },
      clearWatch(id: number) { window.clearInterval(id); },
    } });
  });
  await page.route("**/api/catalog**", route => route.fulfill({ json: { routes: [] } }));
  await page.goto("/");
  await page.getByTestId("just-ride").click();
  await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
  const offer = page.getByTestId("ride-offer");
  await expect(offer).toBeVisible({ timeout: 15000 });
  await expectDrawnScene(page, { routes: "1" });
  await page.screenshot({ path: testInfo.outputPath("offer-preview.png") });
  const firstTitle = await page.getByTestId("ride-offer-title").textContent();

  const swipe = async (direction: -1 | 1) => {
    const box = await page.getByTestId("ride-offer-title").boundingBox();
    if (!box) throw new Error("The offer title has no measured box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + direction * 120, y, { steps: 6 });
    await page.mouse.up();
  };
  await swipe(-1);
  await expect(offer).toHaveCount(0);
  await clickInRideSheet(page, "ride-offer-request");
  await expect(offer).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("ride-offer-title")).not.toHaveText(firstTitle ?? "");
  await swipe(1);
  await expect(offer).toHaveCount(0);
  await expect(page.getByTestId("ride-activity")).toHaveText("Guided ride");
  await expectDrawnScene(page, { routes: "1" });
});
