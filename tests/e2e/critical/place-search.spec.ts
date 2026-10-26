import { expect, test } from "@playwright/test";
import { plannerMap, settledExtent, clickMapAtCoordinate } from "./map-helpers";
import { chooseStart, directionsTo, searchPlace } from "./search-helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/"); await expect(plannerMap(page)).toBeVisible(); await settledExtent(page);
});

test("search opens a card and Directions plans from My location", async ({ page }) => {
  await directionsTo(page);
  await expect(page.getByTestId("finish-value")).toContainText("Hawk Mountain Sanctuary, PA");
  await expect(page.locator('[data-testid^="route-card-"]').first()).toBeVisible();
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
});

test("arrow keys choose among results and Escape clears the field", async ({ page }) => {
  const field = page.getByTestId("finish-search");
  await field.fill("hawk");
  const options = page.getByTestId("finish-search-results").getByTestId("place-option");
  await expect(options).toHaveCount(2);
  await field.press("ArrowDown"); await field.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await field.press("Escape"); await expect(field).toHaveValue("");
  await expect(page.getByTestId("finish-search-results")).toBeHidden();
  await field.fill("hawk"); await expect(options).toHaveCount(2);
  await field.press("ArrowDown"); await field.press("ArrowDown"); await field.press("Enter");
  await expect(page.getByTestId("place-sheet")).toContainText("Hawk Mountain Brewery");
  await expect(page.getByTestId("finish-value")).not.toHaveAttribute("data-coordinate");
});

test("a pin dropped near a known place reads as that place", async ({ page }) => {
  await chooseStart(page);
  await page.getByTestId("finish-chip").click();
  await clickMapAtCoordinate(page, { lat: 40.8785, lon: -75.7300 });
  await expect(page.getByTestId("finish-value")).toContainText("Jim Thorpe, PA");
});

test("search down gives a quiet message and the map still places points", async ({ page }) => {
  await page.getByTestId("start-search").fill("outage");
  await expect(page.getByTestId("start-search-status")).toContainText("Place search is unavailable right now.");
  await page.getByTestId("start-chip").click();
  const extent = await settledExtent(page);
  await clickMapAtCoordinate(page, { lat: (extent.minLat + extent.maxLat) / 2, lon: (extent.minLon + extent.maxLon) / 2 });
  await expect(page.getByTestId("start-value")).toContainText("Dropped pin");
});

test("a card closes with Escape and never authors a destination", async ({ page }) => {
  await searchPlace(page, "Hawk Mountain Sanctuary");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("place-sheet")).toHaveCount(0);
  await expect(page.getByTestId("finish-value")).not.toHaveAttribute("data-coordinate");
});
