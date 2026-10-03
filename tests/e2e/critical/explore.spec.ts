import { expect, test } from "@playwright/test";

import { clickMapAtCoordinate, plannerMap, settledExtent, type Coordinate } from "./map-helpers";

const START: Coordinate = { lon: -75.4385, lat: 40.1385 };
const FINISH: Coordinate = { lon: -75.4335, lat: 40.1325 };

test("browses Explore, uses a route, returns to Explore, and lists a saved personal ride", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("opengravel.vnext.garage.v1", JSON.stringify({
      activeBikeId: "bike-trail",
      bikes: [{
        id: "bike-trail",
        name: "Trail bike",
        category: "adventure",
        fuelRangeMiles: 60,
        reserveMiles: 30,
        maintainedGravel: "allow",
        roughTracks: "allow",
        unknownSurface: "allow-with-warning",
      }],
    }));
  });
  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sample (Ridge|Creek|Foothills)/ })).toHaveCount(3);

  await page.getByRole("combobox", { name: "Filter by source" }).selectOption("catalog");
  await expect(page.locator(".og-explore-card__source").first()).toHaveText("Catalog");
  await page.getByRole("link", { name: /Sample Ridge Loop/ }).click();
  await expect(page).toHaveURL(/\/explore\/sample-ridge-loop$/);
  // The rider-facing line is short and honest, and the engine mechanics — including
  // the provider and profile names the old paragraph carried — are behind a
  // disclosure (09 §6 step 8, Mission 1's "no engine/provider jargon").
  await expect(
    page.getByText("Synthetic demo route — not a real or recommended ride."),
  ).toBeVisible();
  const provenance = page.getByText("Where this route came from");
  await expect(provenance).toBeVisible();
  expect(await provenance.evaluate((element) => element.closest("details")?.open)).toBe(false);
  await expect(page.getByText(/GraphHopper|motorcycle_scenic|tomtom|NWS/)).toHaveCount(0);
  await provenance.click();
  await expect(page.locator(".og-route-detail__provenance-detail")).toContainText(
    "generated test data",
  );
  // Even the disclosure is rider copy: it may not name a provider, a profile or an
  // engine (VNX-007 / Rule E, Mission 1).
  await expect(page.locator(".og-route-detail__provenance-detail")).not.toContainText(
    /GraphHopper|motorcycle_scenic|routing engine|TomTom|NWS/,
  );
  await expect(page.getByRole("heading", { name: "Before you ride" })).toBeVisible();
  await expect(page.getByTestId("preparation-state-weather")).toHaveText("Ready");
  await expect(page.getByTestId("weather-freshness")).toHaveText("Fresh");
  await expect(page.getByText(/Source: (National Weather Service|weather service) · updated/)).toBeVisible();
  await expect(page.getByText("Clear", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Offline ready", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Plan this ride" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("active-ride-title")).toHaveText("Sample Ridge Loop copy");
  await expect(page.getByTestId("active-ride-provenance")).toContainText("catalog");
  const prepare = page.getByTestId("prepare");
  if ((await prepare.getAttribute("open")) === null) await page.getByTestId("prepare-toggle").click();
  await expect(page.getByText("Riding: Trail bike · 60 mi range")).toBeVisible();

  await page.getByRole("link", { name: "Explore" }).click();
  await expect(page).toHaveURL(/\/explore$/);

  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await clickMapAtCoordinate(page, START);
  await clickMapAtCoordinate(page, FINISH);
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await page.getByTestId("named-ride-title").fill("My sample ride");
  await page.getByTestId("save-named-ride").click();
  await expect(page.getByText("Named ride saved. Your active draft remains available.")).toBeVisible();

  await page.goto("/explore");
  await expect(page.getByRole("link", { name: "My sample ride" })).toBeVisible();
  await expect(page.locator(".og-explore-card__source").filter({ hasText: "Yours" })).toBeVisible();
});

test("labels missing road evidence clearly and without console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await clickMapAtCoordinate(page, START);
  await clickMapAtCoordinate(page, FINISH);
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");

  await page.goto("/explore/sample-ridge-loop");
  await expect(page.getByRole("heading", { name: "Before you ride" })).toBeVisible();
  await expect(page.getByTestId("preparation-state-weather")).toHaveText("Ready");
  await expect(page.getByTestId("weather-freshness")).toHaveText("Fresh");
  await expect(page.getByText("Clear", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Offline ready", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Roads on this ride" })).toBeVisible();
  await expect(page.getByTestId("roads-none-matched")).toContainText(
    "No roads on this ride are matched to our road data yet",
  );
  await expect(page.getByRole("list", { name: "Roads on this ride" })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("shows the Roads empty state when no rider evidence is present", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/explore");
  await page.getByRole("tab", { name: "Ride", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Worth riding", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ready-made rides" })).toBeVisible();
  await expect(page.getByRole("button", { name: /road details/i })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("shows the honest Roads empty state when road data is unavailable", async ({ page }) => {
  await page.goto("/explore?roads=empty");
  await page.getByRole("tab", { name: "Ride", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ready-made rides" })).toBeVisible();
  await expect(page.getByRole("button", { name: /road details/i })).toHaveCount(0);
});
