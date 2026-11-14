import { test } from "@playwright/test";
import { plannerMap, settledExtent } from "./map-helpers";
import { directionsTo, searchPlace } from "./search-helpers";
const alert = { json: { snapshot: { fetchedAt: new Date().toISOString(), source: "nws", alerts: [{ event: "Freeze Warning", severity: "Moderate", onset: null, ends: null, area: "x" }], forecast: [{ name: "Now", startTime: new Date(Date.now() - 600000).toISOString(), endTime: new Date(Date.now() + 10_800_000).toISOString(), temperatureF: 33, shortForecast: "Clear" }] } } };
for (const [name, w, h] of [["320", 320, 568], ["land", 844, 390], ["desk", 1440, 900]] as const) {
  test(`shots ${name}`, async ({ page }) => {
    await page.route("**/api/weather?*", (r) => r.fulfill(alert));
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/"); await plannerMap(page).waitFor(); await settledExtent(page); await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/shots/${name}-home.png` });
    if (name === "320") {
      await page.getByTestId("top-place-search").fill("Jim Thorpe PA"); await page.waitForTimeout(800);
      await page.screenshot({ path: `test-results/shots/${name}-typing.png` });
      await page.goto("/explore"); await page.waitForTimeout(2500);
      await page.screenshot({ path: `test-results/shots/${name}-explore.png` });
      await page.goto("/"); await plannerMap(page).waitFor(); await settledExtent(page);
    }
    if (name === "land") { await page.goto("/"); await plannerMap(page).waitFor(); await settledExtent(page); await searchPlace(page, "Hawk Mountain Sanctuary"); await page.waitForTimeout(1500); await page.screenshot({ path: `test-results/shots/land-place.png` }); await page.goto("/"); await plannerMap(page).waitFor(); await settledExtent(page); }
    if (name !== "desk") { await directionsTo(page); await page.waitForTimeout(3000); await page.screenshot({ path: `test-results/shots/${name}-plan.png` }); }
  });
}
