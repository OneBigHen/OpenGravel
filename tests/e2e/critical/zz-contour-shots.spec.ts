import { expect, test } from "@playwright/test";
import { clickMapAtFraction, plannerMap, settledExtent } from "./map-helpers";

// Screenshot capture for the contour fix. Writes into SHOT_DIR (default test-results/contour-shots).
const DIR = process.env.SHOT_DIR ?? "test-results/contour-shots";
const zoomOf = (e: { minLon: number; maxLon: number }): number => Math.log2((390 * 360) / (256 * (e.maxLon - e.minLon)));

test("contour shots", async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: -75.62, latitude: 40.57, accuracy: 10 });
  await page.goto("/");
  await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 60_000 });
  await page.waitForTimeout(2000);
  await page.getByTestId("map-layers-toggle").click();
  const contours = page.getByTestId("map-layer-contours");
  if ((await contours.getAttribute("aria-checked")) !== "true") await contours.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}-1-layers-panel.png` });
  await page.getByTestId("map-layers-toggle").click();
  // zoomed out
  for (let i = 0; i < 12 && zoomOf(await settledExtent(page)) > 8.5; i++) { await page.getByTestId("map-zoom-out").click(); await page.waitForTimeout(500); }
  await page.waitForTimeout(4000);
  console.log("zoomed-out zoom", zoomOf(await settledExtent(page)));
  await page.screenshot({ path: `${DIR}-2-zoomed-out.png` });
  // zoomed in
  for (let i = 0; i < 14 && zoomOf(await settledExtent(page)) < 13.2; i++) { await page.getByTestId("map-zoom-in").click(); await page.waitForTimeout(500); }
  await page.waitForTimeout(8000);
  console.log("zoomed-in zoom", zoomOf(await settledExtent(page)));
  await page.screenshot({ path: `${DIR}-3-zoomed-in.png` });
  // tap around for a contour
  const card = page.getByTestId("info-feature-card");
  outer: for (let y = 0.2; y <= 0.7; y += 0.025) {
    for (let x = 0.1; x <= 0.9; x += 0.05) {
      await clickMapAtFraction(page, { x, y });
      if (await card.isVisible()) break outer;
    }
  }
  await page.waitForTimeout(600);
  console.log("card visible", await card.isVisible(), (await card.isVisible()) ? await card.innerText() : "");
  await page.screenshot({ path: `${DIR}-4-tapped-contour.png` });
});
