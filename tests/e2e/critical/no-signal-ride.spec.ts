import { expect, test, type Page } from "@playwright/test";

import { countColors, placeEndpoint, plannerMap, pressPlan, settledExtent } from "./map-helpers";
import { RIDE_FIXTURE_DESTINATION, RIDE_FIXTURE_START, rideMapReady } from "./ride-focus-helpers";

/**
 * R3-7 "This ride works in airplane mode": plan, save, Keep for no signal,
 * lose the network, reload, open the ride from My rides, Start, and ride it.
 *
 * The map must draw from the kept tiles (Protomaps flavour colours, never the
 * gate's flat background), the turn card must move on as the rider does, no
 * failed request may reach the rider as an error, and 300 m off the line the
 * ride shows the way back with no reroute asked for.
 *
 * Positions come from the browser's own geolocation (granted), stepped along
 * the fixture's first candidate line: the same line the planner selects.
 */

const TITLE = "No signal loop";
const LINE = [
  { lon: -75.44, lat: 40.14 }, { lon: -75.4387, lat: 40.1407 }, { lon: -75.4373, lat: 40.1412 },
  { lon: -75.4361, lat: 40.1408 }, { lon: -75.4351, lat: 40.1396 }, { lon: -75.4355, lat: 40.1382 },
  { lon: -75.4365, lat: 40.1371 }, { lon: -75.4363, lat: 40.1357 }, { lon: -75.4353, lat: 40.134 },
  { lon: -75.4344, lat: 40.1327 }, { lon: -75.4333, lat: 40.1317 }, { lon: -75.4322, lat: 40.1312 },
];
// The offline flavour's land, woods, parks and roads (`OPENGRAVEL_FLAVOR`).
const KEPT_MAP_COLOURS = { earth: "#f1ede2", wood: "#d6e4c6", park: "#d3e2c3", major: "#fbe0a0", minor: "#ffffff" };

test.use({ geolocation: { latitude: LINE[0]!.lat, longitude: LINE[0]!.lon, accuracy: 5 }, permissions: ["geolocation"] });
test.setTimeout(180_000);

async function saveRide(page: Page): Promise<void> {
  const summarySave = page.getByTestId("summary-save");
  if (await summarySave.isVisible()) await summarySave.click();
  const title = page.getByTestId("named-ride-title");
  await expect(title).toBeVisible();
  await title.fill(TITLE);
  await page.getByTestId("save-named-ride").click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
}

test("a ride kept for no signal rides in airplane mode: map, line and turns, and the way back off route", async ({ page, context }, testInfo) => {
  // Plan and save, online.
  await page.goto("/");
  await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
  await settledExtent(page);
  await placeEndpoint(page, "start", RIDE_FIXTURE_START);
  await placeEndpoint(page, "finish", RIDE_FIXTURE_DESTINATION);
  await pressPlan(page);
  await expect(page.getByTestId("start-ride")).toBeEnabled({ timeout: 30_000 });
  await saveRide(page);

  // Keep it: the switch says Kept only once every tile is on the device.
  await page.goto("/rides");
  const row = page.locator(".og-rides__row", { has: page.getByText(TITLE, { exact: true }) });
  await page.getByRole("button", { name: `More actions for ${TITLE}` }).click();
  await page.getByRole("menuitem", { name: "Details" }).click();
  const toggle = row.getByRole("switch", { name: "Keep for no signal" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(row.locator('[data-testid^="keep-no-signal-status-"]')).toHaveText(/^Kept, \d+ (KB|MB)$/, { timeout: 60_000 });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 }).toBe(true);

  const riderErrors: string[] = [];
  const reroutes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/route-plan")) reroutes.push(request.url());
  });

  await context.setOffline(true);
  try {
    const reloaded = await page.reload();
    expect(reloaded?.fromServiceWorker()).toBe(true);
    await page.getByRole("button", { name: `Open ${TITLE}` }).click();
    await expect(page).toHaveURL(/\/$/);
    const start = page.getByTestId("start-ride");
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.click();
    await expect(page).toHaveURL(/\/ride$/);
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
    await rideMapReady(page);
    await expect(plannerMap(page)).toHaveAttribute("data-basemap", "offline");
    await expect(page.getByTestId("ride-no-signal")).toHaveText("No signal, kept ride");

    // Ride the line: the card moves on with the rider.
    const prompts = new Set<string>();
    for (const point of LINE) {
      await context.setGeolocation({ latitude: point.lat, longitude: point.lon, accuracy: 5 });
      await page.waitForTimeout(1_200);
      const card = await page.getByTestId("ride-maneuver").textContent().catch(() => null);
      if (card) prompts.add(card.trim());
    }
    expect(prompts.size).toBeGreaterThan(1);

    // The map is drawn from the kept tiles, not a blank background.
    const drawn = Object.values(await countColors(plannerMap(page), KEPT_MAP_COLOURS, 6, [page.locator(".maplibregl-ctrl")]))
      .reduce((sum, count) => sum + count, 0);
    expect(drawn).toBeGreaterThan(2_000);
    await page.screenshot({ path: testInfo.outputPath("no-signal-ride.png") });

    // 300 m off the line: the way back, and nothing asks for a new route.
    const last = LINE.at(-1)!;
    await context.setGeolocation({ latitude: last.lat - 300 / 111_320, longitude: last.lon, accuracy: 5 });
    await expect(page.getByTestId("ride-maneuver")).toHaveAttribute("data-reason", "off-route", { timeout: 20_000 });
    await expect(page.getByTestId("ride-guidance-state")).toHaveText(/Head back|Turn around/);
    await expect(page.getByTestId("ride-reroute-now")).toHaveCount(0);
    await page.waitForTimeout(5_000);
    expect(reroutes).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("no-signal-off-route.png") });

    // No failed request reached the rider as an error.
    for (const locator of [page.locator('[data-testid="ride-toast"][data-tone="error"]'), page.getByText(/failed|unavailable right now|could not/i)]) {
      if (await locator.count()) riderErrors.push((await locator.first().textContent()) ?? "");
    }
    expect(riderErrors).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
