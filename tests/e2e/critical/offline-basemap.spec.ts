import { expect, test } from "@playwright/test";

import { countColors, expectHealthyMap, plannerMap } from "./map-helpers";


/**
 * Lane A2's proof: once an area is downloaded, a planner that finds no network
 * draws that area's own map, read from the device, not from any server.
 *
 * The browser is told it is offline (`navigator.onLine`), which is what the
 * map host consults; the page itself still loads from the test server,
 * because there is no service worker yet to serve the app shell offline
 * (that is Lane A5). Every request for the map archive after the download is
 * counted, and there must be none.
 */
test("with no network, the planner draws a downloaded area's own map from the device", async ({ page, context }) => {
  test.setTimeout(90_000);
  // The offline flavour's woods, parks and main roads (`OPENGRAVEL_FLAVOR`);
  // the critical gate's own basemap is a flat background with none of them.
  const MAP_COLOURS = {
    wood: "#d6e4c6",
    park: "#d3e2c3",
    woodDeep: "#c9dcb6",
    major: "#fbe0a0",
    highway: "#f2b073",
  };
  const mapPixels = async () =>
    Object.values(await countColors(plannerMap(page), MAP_COLOURS, 6, [page.locator(".maplibregl-ctrl")])).reduce((a, b) => a + b, 0);

  await page.goto("/");
  await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
  const online = await mapPixels();

  await page.goto("/settings");
  const row = page.getByTestId("offline-region-lehigh-fixture");
  await row.getByRole("button", { name: /^Download/ }).click();
  await expect(page.getByTestId("offline-maps-message")).toContainText("is ready");

  const archiveRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/basemap")) archiveRequests.push(request.url());
  });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false });
  });
  await page.goto("/");

  const map = plannerMap(page);
  await expect(map).toHaveAttribute("data-basemap", "offline");
  await expect(map).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
  await expectHealthyMap(page);

  await expect.poll(mapPixels, { timeout: 15_000 }).toBeGreaterThan(online + 300);
  expect(archiveRequests).toEqual([]);
});
