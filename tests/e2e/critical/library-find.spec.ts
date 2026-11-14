import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { audit, overlaps } from "./library-audit";
import { plannerMap, settledExtent } from "./map-helpers";

/**
 * "I find a good ride in three taps, and the ride page tells me if it is worth
 * the trip." Checked the way a rider sees it: at 390 x 844 and 320 x 568, Day
 * and Night, inside the screen, nothing cut off or overlapping, text readable
 * (4.5:1) and controls thumb-sized (44 px).
 *
 * The server only has a ride library while this file runs: the fixture pack is
 * copied to the path playwright.config.ts points the server at, then removed.
 */
const PACK = join(tmpdir(), "og-route-library-e2e", "pack.sqlite");
const FIXTURE = join(process.cwd(), "tests/fixtures/route-library/pack.sqlite");
const SIZES = [
  { name: "390x844", width: 390, height: 844 },
  { name: "320x568", width: 320, height: 568 },
] as const;
const THEMES = ["day", "night"] as const;
const INLINE = [".og-worth__notes", ".og-worth__fine", ".og-ride-credit", ".og-route-detail__credits"];
/** Asheville: the Cherohala Skyway starts about 70 mi away, Diamondback about 40. */
const ASHEVILLE = { latitude: 35.6, longitude: -82.55 };

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(dirname(PACK), { recursive: true });
  copyFileSync(FIXTURE, PACK);
});

test.afterAll(() => {
  rmSync(dirname(PACK), { recursive: true, force: true });
});

/** One tap of the rider's finger; the test counts them. */
class Taps {
  count = 0;
  async tap(target: Locator): Promise<void> {
    this.count += 1;
    await target.click();
  }
  async type(target: Locator, text: string): Promise<void> {
    this.count += 1;
    await target.fill(text);
  }
}

async function shot(page: Page, name: string, size: string, theme: string, full = false): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}-${size}-${theme}.png`), fullPage: full });
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`${size.name} ${theme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, geolocation: ASHEVILLE, permissions: ["geolocation"] });

      test.beforeEach(async ({ page }) => {
        await page.addInitScript((mode) => { try { window.localStorage.setItem("og-appearance", mode); } catch { /* storage off */ } }, theme);
      });

      async function open(page: Page, path: string): Promise<void> {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      }

      test("home: the ways in are on the first screen, and the page holds together", async ({ page }) => {
        await open(page, "/explore");
        await expect(page.getByTestId("routes-home")).toBeVisible();
        // The three ways in the rider sees without scrolling: near me, the types, the Standout rides.
        for (const id of ["chip-near", "chip-standout", "chip-twisty"]) await expect(page.getByTestId(id)).toBeInViewport();
        await expect(page.getByRole("heading", { name: "Standout rides" })).toBeVisible();
        // State tiles: three across at 390, two at 320, each with its count.
        const tiles = page.getByTestId("state-tiles").locator("button");
        await tiles.first().scrollIntoViewIfNeeded();
        const lefts = await tiles.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
        expect(new Set(lefts.slice(0, 6)).size).toBe(size.width >= 390 ? 3 : 2);
        await expect(page.getByTestId("state-NC")).toHaveAccessibleName("North Carolina, 2 rides");
        expect(await audit(page, { scope: ".og-explore__toolbar, .og-routes__section, [data-testid='primary-nav']", inlineLinks: INLINE })).toEqual([]);
        await shot(page, "home", size.name, theme);
        await shot(page, "home-full", size.name, theme, true);
      });

      test("by state in two taps, by type in two, by name in two, near me in two", async ({ page }) => {
        // By state.
        let taps = new Taps();
        await open(page, "/explore");
        await taps.tap(page.getByTestId("state-NC"));
        await expect(page.getByTestId("routes-results-title")).toHaveText("Rides in North Carolina");
        await expect(page.getByTestId("library-row")).toHaveCount(2);
        expect(await audit(page, { scope: ".og-explore__toolbar, .og-routes__section", inlineLinks: INLINE })).toEqual([]);
        await shot(page, "state-results", size.name, theme);
        await taps.tap(page.getByTestId("library-row").first().getByRole("link"));
        await expect(page).toHaveURL(/\/explore\/nc-/);
        expect(taps.count).toBeLessThanOrEqual(3);

        // By type: Dirt is the Arizona BDR.
        taps = new Taps();
        await open(page, "/explore");
        await taps.tap(page.getByTestId("chip-dirt"));
        await expect(page.getByTestId("routes-results-title")).toHaveText("Dirt rides");
        await taps.tap(page.getByTestId("library-row").filter({ hasText: "Arizona Backcountry Discovery Route" }).getByRole("link"));
        await expect(page).toHaveURL(/\/explore\/az-arizona-bdr$/);
        expect(taps.count).toBeLessThanOrEqual(3);

        // By name, and by a state's name.
        taps = new Taps();
        await open(page, "/explore");
        await taps.type(page.getByLabel("Search routes"), "cherohala");
        await expect(page.getByTestId("routes-results-title")).toHaveText("Rides matching “cherohala”");
        await taps.tap(page.getByTestId("library-row").first().getByRole("link"));
        await expect(page).toHaveURL(/\/explore\/nc-cherohala-skyway$/);
        expect(taps.count).toBeLessThanOrEqual(3);
        await open(page, "/explore");
        await page.getByLabel("Search routes").fill("pennsylvania");
        await expect(page.getByTestId("library-row")).toHaveCount(4);

        // Near me: the Smokies rides come first with how far they start.
        taps = new Taps();
        await open(page, "/explore");
        await taps.tap(page.getByTestId("chip-near"));
        await expect(page.getByTestId("routes-results-title")).toHaveText("Rides near you");
        const first = page.getByTestId("library-row").first();
        await expect(first).toContainText(/Diamondback|Cherohala/);
        await expect(first.getByTestId("library-away")).toContainText(/\d+ mi away/);
        await shot(page, "near", size.name, theme);
        await taps.tap(first.getByRole("link"));
        await expect(page).toHaveURL(/\/explore\/nc-/);
        expect(taps.count).toBeLessThanOrEqual(3);
      });

      test("the map view keeps the whole country in sight and fills the room under it with the best rides", async ({ page }) => {
        await open(page, "/explore?view=map");
        await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready");
        const strip = page.getByTestId("best-strip");
        await expect(strip).toBeVisible();
        await expect(strip).toContainText("Best rides near this view");
        await expect(strip).toContainText("not rider votes");
        await expect(page.getByTestId("best-card").first()).toContainText(/Standout|Great ride/);
        expect(await strip.textContent()).not.toMatch(/★|stars/i);
        await page.waitForTimeout(1200);

        // The country sits between the chips and the strip, edge to edge sideways.
        const extent = await settledExtent(page);
        const box = (await plannerMap(page).boundingBox())!;
        const mercator = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
        const y = (lat: number): number => box.y + ((mercator(extent.maxLat) - mercator(lat)) / (mercator(extent.maxLat) - mercator(extent.minLat))) * box.height;
        const x = (lon: number): number => box.x + ((lon - extent.minLon) / (extent.maxLon - extent.minLon)) * box.width;
        const stripBox = (await strip.boundingBox())!;
        const chipsBox = (await page.locator(".og-routes__chips").boundingBox())!;
        expect(x(-125)).toBeGreaterThanOrEqual(0);
        expect(x(-66.9)).toBeLessThanOrEqual(size.width);
        expect(y(24.5)).toBeLessThanOrEqual(stripBox.y - 2);
        expect(y(49.4)).toBeGreaterThanOrEqual(chipsBox.y + chipsBox.height - 2);
        // The map keeps at least 55% of the screen above the strip and the pill.
        expect(stripBox.y / size.height).toBeGreaterThanOrEqual(0.55);

        expect(await overlaps(page, { chips: ".og-routes__chips", strip: "[data-testid='best-strip']", pill: "[data-testid='routes-pill']", nav: "[data-testid='primary-nav']" })).toEqual([]);
        expect(await audit(page, { scope: ".og-routes__chips, [data-testid='best-strip'], [data-testid='routes-pill'], .og-routes__bubble, [data-testid='primary-nav']", insideScreen: true })).toEqual([]);
        await shot(page, "map", size.name, theme);

        // A card opens its ride.
        const card = page.getByTestId("best-card").first();
        const name = (await card.locator("strong").innerText()).trim();
        await card.getByRole("link").click();
        await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 25_000 });
      });

      test("the ride page says whether the ride is worth the trip", async ({ page }) => {
        await open(page, "/explore/nc-cherohala-skyway");
        await expect(page.getByTestId("worth-eyebrow")).toHaveText("Standout · Scenic");
        const card = page.getByTestId("worth-card");
        await expect(card).toBeVisible();
        await expect(page.getByTestId("worth-verdict")).toContainText("Standout");
        await expect(card).toContainText("Not a rider vote");
        await expect(page.getByTestId("worth-lines")).toContainText("Surface");
        // What the source did not say is said as unknown, never as a value.
        await expect(page.getByTestId("worth-lines").locator('[data-line="track"]')).toContainText(/Track (from \d{4}|age unknown)|source/);
        expect(await card.textContent()).not.toMatch(/★|stars/i);
        expect(await audit(page, { scope: ".og-worth, .og-route-detail__header, .og-route-detail__actions", inlineLinks: INLINE })).toEqual([]);
        await shot(page, "ride", size.name, theme);
        await shot(page, "ride-full", size.name, theme, true);

        // The BDR carries the source's season, quoted, and the credit line stays.
        await open(page, "/explore/az-arizona-bdr");
        await expect(page.getByTestId("worth-known")).toContainText("May, June, September, October");
        await expect(page.getByTestId("worth-more")).toContainText("What the source says");
        await expect(page.getByTestId("ride-credit").getByRole("link")).toHaveAttribute("href", /^https?:\/\//);
        expect(await audit(page, { scope: ".og-worth", inlineLinks: INLINE })).toEqual([]);
        await shot(page, "ride-bdr-full", size.name, theme, true);
      });
    });
  }
}
