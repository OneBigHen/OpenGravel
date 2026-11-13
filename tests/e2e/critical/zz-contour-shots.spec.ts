import { expect, test } from "@playwright/test";
import { plannerMap } from "./map-helpers";

// Screenshot capture for the contour fix. Writes into SHOT_DIR (default test-results/contour-shots).
const DIR = process.env.SHOT_DIR ?? "test-results/contour-shots";
let zoomPage: import("@playwright/test").Page;
const zoomOf = (_e: unknown): number => 0;
const realZoom = async (): Promise<number> => Number(await zoomPage.getByTestId("planner-map").getAttribute("data-map-zoom"));

test("contour shots", async ({ page, context }) => {
  test.setTimeout(240_000);
  zoomPage = page;
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
  await page.getByRole("button", { name: "Close map layers" }).click();
  // zoomed out
  for (let i = 0; i < 12 && await realZoom() > 8.2; i++) { await page.mouse.move(195, 420); await page.mouse.wheel(0, 300); await page.waitForTimeout(700); }
  await page.waitForTimeout(4000);
  console.log("zoomed-out zoom", await realZoom());
  await page.screenshot({ path: `${DIR}-2-zoomed-out.png` });
  // zoomed in
  for (let i = 0; i < 14 && await realZoom() < 13.3; i++) { await page.mouse.move(195, 420); await page.mouse.wheel(0, -300); await page.waitForTimeout(700); }
  await page.waitForTimeout(8000);
  console.log("zoomed-in zoom", await realZoom());
  await page.screenshot({ path: `${DIR}-3-zoomed-in.png` });
  // tap around for a contour
  const card = page.getByTestId("info-feature-card");
  outer: for (let y = 380; y <= 640; y += 12) {
    for (let x = 25; x <= 310; x += 14) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(120);
      if (await card.isVisible()) break outer;
    }
  }
  await page.waitForTimeout(600);
  console.log("card visible", await card.isVisible(), (await card.isVisible()) ? await card.innerText() : "");
  await page.screenshot({ path: `${DIR}-4-tapped-contour.png` });
});
