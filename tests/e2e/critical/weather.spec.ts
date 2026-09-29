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

test("renders fixture weather and its freshness", async ({ page }) => {
  await page.goto("/explore/sample-ridge-loop");
  await expect(page.getByTestId("preparation-state-weather")).toHaveText("Ready");
  await expect(page.getByTestId("weather-freshness")).toHaveText("Fresh");
  await expect(page.getByText("Sunny · 72°F · 10 mph wind · 10% precip")).toBeVisible();
  await expect(page.getByText(/Source: (National Weather Service|weather service) · updated/)).toBeVisible();
});

test("shows stale fixture weather honestly after the 45 minute boundary", async ({ page }) => {
  await page.route(WEATHER_URL, async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ snapshot: { ...snapshot, fetchedAt: "2020-01-01T12:00:00.000Z" } }),
  }));
  await page.goto("/explore/sample-ridge-loop");
  await expect(page.getByTestId("preparation-state-weather")).toHaveText("Stale");
  await expect(page.getByTestId("weather-freshness")).toHaveText("Stale");
});

test("shows the planning-server absence instead of clear weather", async ({ page }) => {
  await page.route(WEATHER_URL, async (route) => route.fulfill({ status: 404, body: "Not Found" }));
  await page.goto("/explore/sample-ridge-loop");
  await expect(page.getByTestId("preparation-state-weather")).toHaveText("Unknown");
  await expect(page.getByText("Weather needs the planning server.")).toBeVisible();
  await expect(page.getByText("Clear", { exact: true })).toHaveCount(0);
});
