import { expect, test } from "@playwright/test";

const WEATHER_URL = "**/api/weather**";

const snapshot = {
  fetchedAt: "2026-09-17T14:32:00.000Z",
  source: "nws",
  alerts: [],
  forecast: [{
    name: "This Afternoon",
    startTime: "2026-09-17T16:00:00.000Z",
    endTime: "2026-09-17T18:00:00.000Z",
    temperatureF: 72,
    windMph: 10,
    precipChance: 10,
    shortForecast: "Sunny",
  }],
};

test("renders fixture weather in the rider's words, with one agency credit", async ({ page }) => {
  await page.goto("/explore/sample-ridge-loop");
  await expect(page.getByTestId("preparation-value-weather")).toContainText("Sunny · 72°F");
  await expect(page.getByText("Weather from the National Weather Service")).toBeVisible();
  // A current forecast says nothing about its own freshness.
  await expect(page.getByText("Fresh", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Source:/)).toHaveCount(0);
});

test("shows stale fixture weather honestly after the 45 minute boundary", async ({ page }) => {
  await page.route(WEATHER_URL, async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ snapshot: { ...snapshot, fetchedAt: "2020-01-01T12:00:00.000Z" } }),
  }));
  await page.goto("/explore/sample-ridge-loop");
  await expect(page.getByTestId("preparation-value-weather")).toContainText("Sunny · 72°F");
  // Old weather says so in words, and never wears a "Stale" chip.
  await expect(page.getByText(/^Forecast is .+ old$/)).toBeVisible();
  await expect(page.getByText("Stale", { exact: true })).toHaveCount(0);
});

test("shows the planning-server absence instead of clear weather", async ({ page }) => {
  await page.route(WEATHER_URL, async (route) => route.fulfill({ status: 404, body: "Not Found" }));
  await page.goto("/explore/sample-ridge-loop");
  // Unknown weather is left out rather than drawn as a row, and is never clear.
  await expect(page.getByTestId("preparation-value-weather")).toHaveCount(0);
  await expect(page.getByText("Clear", { exact: true })).toHaveCount(0);
});
