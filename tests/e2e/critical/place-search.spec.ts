import { expect, test, type Page } from "@playwright/test";

import {
  clickMapAtCoordinate,
  DROPPED_PIN_LABEL,
  plannerMap,
  pointLabel,
  settledExtent,
  type Coordinate,
} from "./map-helpers";

/**
 * Place names (MVP parity M1): search a town, search a place, plan — and a pin
 * dropped next to a known place reads as that place.
 *
 * The server runs the fixture geocoder (`OGV_GEOCODE_FIXTURE=1`,
 * `src/server/geocoding/fixture-places.ts`): six Lehigh Valley places; reverse
 * names only coordinates within 1 km of one of them; a query containing
 * "outage" fails like an upstream outage.
 */

const JIM_THORPE: Coordinate = { lat: 40.8757, lon: -75.7324 };
const HAWK_MOUNTAIN: Coordinate = { lat: 40.6348, lon: -75.9913 };

function routeCards(page: Page) {
  return page.locator('[data-testid^="route-card-"]');
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("search a town and a place, then plan the ride", async ({ page }) => {
  const start = page.getByTestId("start-search");
  await start.fill("Jim Thorpe");
  const option = page.getByTestId("start-search-results").getByTestId("place-option");
  await expect(option).toHaveCount(1);
  await expect(option).toContainText("Carbon County, PA");
  await option.click();

  await expect(page.getByTestId("start-value")).toContainText("Jim Thorpe, PA");
  await expect(page.getByTestId("start-value")).toHaveAttribute("data-coordinate", pointLabel(JIM_THORPE));
  // The chosen place replaces the search box; tapping it searches again.
  await expect(start).toHaveCount(0);
  await expect(page.getByTestId("start-change")).toBeVisible();

  // Enter picks the first result, keyboard only.
  const finish = page.getByTestId("finish-search");
  await finish.fill("hawk mountain s");
  await finish.press("Enter");
  await expect(page.getByTestId("finish-value")).toContainText("Hawk Mountain Sanctuary, PA");
  await expect(page.getByTestId("finish-value")).toHaveAttribute("data-coordinate", pointLabel(HAWK_MOUNTAIN));

  await page.getByTestId("compose-create").click();
  await expect(routeCards(page).first()).toBeVisible();
  // A search pick is a normal authored edit: one undo step, labelled.
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
});

test("arrow keys choose among results and Escape clears the field", async ({ page }) => {
  const finish = page.getByTestId("finish-search");
  await finish.fill("hawk");
  const options = page.getByTestId("finish-search-results").getByTestId("place-option");
  await expect(options).toHaveCount(2);
  await finish.press("ArrowDown");
  await finish.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await finish.press("Escape");
  await expect(finish).toHaveValue("");
  await expect(page.getByTestId("finish-search-results")).toBeHidden();
  await finish.fill("hawk");
  await expect(options).toHaveCount(2);
  await finish.press("ArrowDown");
  await finish.press("ArrowDown");
  await finish.press("Enter");
  await expect(page.getByTestId("finish-value")).toContainText("Hawk Mountain Brewery, PA");
});

test("a pin dropped near a known place reads as that place", async ({ page }) => {
  await page.getByTestId("start-search").fill("Jim Thorpe");
  await page.getByTestId("start-search").press("Enter");
  await expect(page.getByTestId("start-value")).toContainText("Jim Thorpe, PA");

  // ~350 m from the fixture's Jim Thorpe: the camera frames the start, and the
  // fixture reverse geocoder names points within 1 km of it.
  await page.getByTestId("finish-chip").click();
  await clickMapAtCoordinate(page, { lat: 40.8785, lon: -75.7300 });
  await expect(page.getByTestId("finish-value")).toContainText("Jim Thorpe, PA", { timeout: 5_000 });
});

test("search down: one quiet line, and the map still places points", async ({ page }) => {
  await page.getByTestId("start-search").fill("outage");
  await expect(page.getByTestId("start-search-status")).toHaveText(
    "Place search is unavailable right now. You can still set the point on the map.",
  );
  await page.getByTestId("start-chip").click();
  const extent = await settledExtent(page);
  await clickMapAtCoordinate(page, {
    lat: (extent.minLat + extent.maxLat) / 2,
    lon: (extent.minLon + extent.maxLon) / 2,
  });
  await expect(page.getByTestId("start-value")).toContainText(DROPPED_PIN_LABEL);
});
