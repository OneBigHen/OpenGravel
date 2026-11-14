import { expect, test } from "@playwright/test";
import { plannerMap, settledExtent } from "./map-helpers";
import { LANDSCAPE, settleChrome, withWeatherAlert } from "./rider-gate-helpers";
import { directionsTo } from "./search-helpers";

test.describe.configure({ timeout: 120_000 });
const shot = process.env["PROBE_DIR"] ?? "probe";

for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`probe typed ${size.width}`, async ({ page }) => {
    await withWeatherAlert(page);
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${shot}/home-${size.width}.png` });
    const field = page.getByTestId("top-place-search");
    await field.fill("Hawk Mountain Sanctuary");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shot}/typed-${size.width}.png` });
    const info = await page.evaluate(() => {
      const q = (s: string) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width), getComputedStyle(e).display]; };
      return { input: q('[data-testid="top-place-search"]'), cond: q(".og-conditions"), pill: q(".og-conditions__pill"), note: q(".og-conditions__note"), menu: q('[data-testid="app-menu"]'), bar: q(".og-top-search__bar") };
    });
    console.log("PROBE", size.width, JSON.stringify(info));
  });
}

test("probe landscape", async ({ page }) => {
  await withWeatherAlert(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await directionsTo(page);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
  await page.screenshot({ path: `${shot}/plan-upright.png` });
  await page.setViewportSize(LANDSCAPE);
  await settleChrome(page);
  await page.screenshot({ path: `${shot}/plan-landscape.png` });
  const info = await page.evaluate(() => ["app-menu", "map-layers-toggle", "start-ride", "summary-save", "primary-nav", "planner-sheet", "top-search"].map((id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return [id, null]; const r = e.getBoundingClientRect(); return [id, Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), getComputedStyle(e).display, getComputedStyle(e).visibility]; }));
  console.log("PROBE", JSON.stringify(info));
});
