import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { clickMapAtCoordinate, plannerMap } from "./map-helpers";

/**
 * "I open Explore, see rides across the whole country, and open one."
 *
 * The server only has a ride library while this file runs: the fixture pack is
 * copied to the path playwright.config.ts points the server at, and taken away
 * again, so no other spec sees it.
 */
const PACK = join(tmpdir(), "og-route-library-e2e", "pack.sqlite");
const FIXTURE = join(process.cwd(), "tests/fixtures/route-library/pack.sqlite");
/** The start of the Cherohala Skyway fixture ride (Standout). */
const CHEROHALA = { lon: -83.8071, lat: 35.3228 };

test.use({ viewport: { width: 390, height: 844 } });
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(dirname(PACK), { recursive: true });
  copyFileSync(FIXTURE, PACK);
});

test.afterAll(() => {
  rmSync(dirname(PACK), { recursive: true, force: true });
});

function routesMap(page: Page) {
  return page.getByTestId("routes-map");
}

async function zoomOf(page: Page): Promise<number> {
  return Number(await routesMap(page).getAttribute("data-zoom"));
}

test("opens on a bubble per state, zooms in to a line, shows the card, opens the ride and comes back to the same place", async ({ page }) => {
  await page.goto("/explore?view=map");
  await expect(routesMap(page)).toBeVisible();
  await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready");
  // The whole country: one bubble per state, each with its count.
  const northCarolina = page.locator('.og-routes__bubble[data-state="NC"]');
  await expect(northCarolina).toBeVisible();
  await expect(northCarolina).toHaveText("2");
  await expect(page.locator('.og-routes__bubble[data-kind="state"]').first()).toBeVisible();
  await expect(page.getByTestId("routes-pill")).toHaveText(/rides? here · List/);

  // Into the Smokies: a state bubble, then a group, then the line itself.
  await northCarolina.click();
  const groups = page.locator('.og-routes__bubble[data-kind="group"]');
  await expect(groups.first()).toBeVisible();
  // Several bubbles can be panned out of the phone's window; tap one that is on screen.
  const findOnScreen = () => groups.evaluateAll((nodes) => nodes.findIndex((node) => {
    const box = node.getBoundingClientRect();
    return box.left >= 8 && box.right <= window.innerWidth - 8 && box.top >= 70 && box.bottom <= window.innerHeight - 150;
  }));
  await expect.poll(findOnScreen, { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
  const onScreen = await findOnScreen();
  await groups.nth(onScreen).click();
  await expect.poll(() => zoomOf(page)).toBeGreaterThanOrEqual(7);
  await expect(routesMap(page)).not.toHaveAttribute("data-lines", "0");

  // Tap the line: the card names the ride, says Standout and credits the site.
  await clickMapAtCoordinate(page, CHEROHALA);
  const card = page.getByTestId("routes-map-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Standout");
  await expect(card).toContainText("Route from");
  const cardName = (await card.locator(".og-routes__card-name").innerText()).trim();
  expect(cardName.length).toBeGreaterThan(3);
  const zoomBefore = await zoomOf(page);

  await page.getByTestId("routes-open-ride").click();
  await expect(page).toHaveURL(/\/explore\/[a-z0-9-]+$/);
  // The ride page: the line is drawn, the source is credited and linked, and the button says what it does.
  await expect(page.getByRole("heading", { name: cardName })).toBeVisible();
  await expect(page.getByTestId("ride-this")).toHaveText("Follow this track");
  await expect(page.getByTestId("ride-credit").getByRole("link")).toHaveAttribute("href", /^https?:\/\//);
  await expect(page.getByTestId("planner-map")).toHaveAttribute("data-map-load", "ready");
  await expect(page.getByTestId("planner-map")).not.toHaveAttribute("data-map-scene", /^$/);

  // Back lands on the same map, in the same place.
  await page.goBack();
  await expect(routesMap(page)).toBeVisible();
  await expect(page).toHaveURL(/view=map/);
  await expect.poll(async () => Math.abs((await zoomOf(page)) - zoomBefore), { timeout: 15_000 }).toBeLessThan(0.6);
});

test("the Dirt chip hides the twisty ride from the map and from the list", async ({ page }) => {
  const smokies = "at=35.82,-82.04,9";
  await page.goto(`/explore?view=map&${smokies}`);
  await expect(routesMap(page)).toBeVisible();
  await expect(routesMap(page)).not.toHaveAttribute("data-lines", "0");
  await expect(page.getByTestId("routes-pill")).toHaveText(/^1 ride here · List$/);

  await page.getByTestId("chip-dirt").click();
  await expect(page).toHaveURL(/type=dirt/);
  await expect(page.getByTestId("routes-pill")).toHaveText("0 rides here · List");
  // Tapping where the twisty line runs finds nothing now.
  await clickMapAtCoordinate(page, { lon: -82.042, lat: 35.8214 });
  await expect(page.getByTestId("routes-map-card")).toHaveCount(0);

  await page.getByTestId("routes-pill").click();
  await expect(page.getByTestId("routes-here-title")).toHaveText("0 rides here");
  await expect(page.getByTestId("library-row")).toHaveCount(0);

  // The chip is the only difference: without it the same view lists the ride.
  await page.goto(`/explore?view=list&here=-82.6,35.3,-81.4,36.3`);
  await expect(page.getByTestId("library-row").filter({ hasText: "Diamondback" })).toHaveCount(1);
  await page.goto(`/explore?view=list&here=-82.6,35.3,-81.4,36.3&type=dirt`);
  await expect(page.getByTestId("routes-here-title")).toHaveText("0 rides here");
});
