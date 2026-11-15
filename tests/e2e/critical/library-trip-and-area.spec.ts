import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * L7 and L8: "A BDR or a long trip reads as days and sections, with fuel and
 * camps" and "A trail system is a place the rider can ride to, with its permit
 * and season".
 *
 * The server only has the ride library while this file runs (the same pattern
 * as explore-country.spec.ts), so the fixture pack is copied in and taken away.
 */
const PACK = join(tmpdir(), "og-route-library-e2e", "pack.sqlite");
const FIXTURE = join(process.cwd(), "tests/fixtures/route-library/pack.sqlite");

test.describe.configure({ timeout: 120_000 });

test.beforeAll(() => {
  mkdirSync(dirname(PACK), { recursive: true });
  copyFileSync(FIXTURE, PACK);
});

test.afterAll(() => {
  rmSync(dirname(PACK), { recursive: true, force: true });
});

/** A page that scrolls sideways is a page a gloved thumb cannot read. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
}

for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }] as const) {
  test(`a BDR reads as days and sections, with fuel and camps (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/explore/az-arizona-bdr");

    await expect(page.getByRole("heading", { level: 1, name: /Arizona Backcountry Discovery Route/ })).toBeVisible();
    await expect(page.getByTestId("worth-eyebrow")).toContainText("Big trip");

    const days = page.getByTestId("trip-days");
    await expect(days).toBeVisible();
    await expect(days.getByRole("heading", { name: "Days and sections" })).toBeVisible();
    // The source's own day count, then its six sections.
    await expect(days).toContainText("The source says 4 to 6 days.");
    await expect(days).toContainText("6 sections, one a day.");
    const sections = days.locator(".og-library-ride__section");
    await expect(sections).toHaveCount(6);
    await expect(sections.first()).toContainText("Day 1");
    await expect(sections.first()).toContainText("Mexico border to Benson");
    await expect(sections.first()).toContainText("128 mi");
    await expect(sections.last()).toContainText("Day 6");
    await expect(sections.last()).toContainText("Cameron to Utah border");
    await expect(sections.last()).toContainText("151 mi");

    // Fuel and camps are on the page even when the source lists none.
    const stops = page.getByTestId("trip-stops");
    await expect(stops).toContainText("The source lists no fuel stops.");
    await expect(stops).toContainText("The source lists no camps.");

    // The permit and season the trip is ridden under, in the source's words.
    const facts = page.getByTestId("library-facts");
    await expect(facts).toContainText("AZ State Land Trust Recreation Permit");
    await expect(facts).toContainText("May, June, September, October (the source says)");

    // Link-only: the source is the way on, and the page does not invent a map.
    await expect(page.getByTestId("ride-source-link")).toHaveAttribute("href", "https://ridebdr.com/AZBDR");
    await expect(page.getByTestId("ride-this")).toHaveCount(0);
    await expect(page.getByText("No map position for this ride")).toBeVisible();

    await expectNoSidewaysScroll(page);
  });

  test(`a trail system is a place to ride to, with its permit and season (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/explore/mi-orv-route-slc");

    await expect(page.getByRole("heading", { level: 1, name: "ORV Route SLC" })).toBeVisible();
    await expect(page.getByTestId("worth-eyebrow")).toContainText("Trail area");

    const facts = page.getByTestId("library-facts");
    await expect(facts.getByRole("heading", { name: "Ride here" })).toBeVisible();
    await expect(facts).toContainText("Open to motorcycles, the source says");
    await expect(facts).toContainText("Michigan DNR ORV license");
    await expect(facts).toContainText("Season not stated");
    await expect(facts).toContainText("Unpaved, the source says");

    // The place is on a map, and the one action takes the rider there.
    await expect(page.locator(".og-road-map")).toBeVisible();
    await expect(page.getByTestId("planner-map")).toHaveAttribute("data-map-load", "ready", { timeout: 20_000 });
    const directions = page.getByTestId("ride-to-trailhead");
    await expect(directions).toBeVisible();
    await expect(directions).toHaveText(/Directions to the area/);
    await expect(directions).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=46\./);
    await expect(page.getByTestId("ride-credit").getByRole("link")).toHaveAttribute("href", /michigan\.gov/);
    // There is no line to follow and no tank to plan around.
    await expect(page.getByTestId("ride-this")).toHaveCount(0);

    await expectNoSidewaysScroll(page);
  });
}
