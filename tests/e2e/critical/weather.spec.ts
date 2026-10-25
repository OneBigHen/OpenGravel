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

// The route page carries the forecast as one line of conditions at the start.
// No state badge, freshness badge or provider provenance sits beside it, and no
// per-check briefing row is repeated from the planner.
test("says the forecast at the start in one line", async ({ page }) => {
  await page.goto("/explore/sample-ridge-loop");
  await expect(page.getByTestId("route-conditions")).toHaveText("Sunny · 72°F at the start");
  await expect(page.getByTestId("route-conditions")).not.toContainText(/Source:|Fresh|Ready/);
  await expect(page.getByTestId("preparation-value-weather")).toHaveCount(0);
  // A current forecast says nothing about its own freshness.
  await expect(page.getByText("Fresh", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Source:/)).toHaveCount(0);
});

test("stays silent on stale weather instead of showing it as today's", async ({ page }) => {
  await page.route(WEATHER_URL, async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ snapshot: { ...snapshot, fetchedAt: "2020-01-01T12:00:00.000Z" } }),
  }));
  await page.goto("/explore/sample-ridge-loop");
  // A forecast past its freshness window is unknown, and unknown is never shown
  // as clear weather. The line is simply absent.
  await expect(page.getByTestId("route-conditions")).toHaveCount(0);
  await expect(page.getByText(/Sunny/)).toHaveCount(0);
  // Old weather never wears a "Stale" chip, and no per-check row says its age.
  await expect(page.getByText("Stale", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Forecast is .+ old$/)).toHaveCount(0);
  await expect(page.getByTestId("preparation-value-weather")).toHaveCount(0);
  await expect(page.getByText("Clear", { exact: true })).toHaveCount(0);
});

test("shows no weather line when the planning server has no forecast", async ({ page }) => {
  await page.route(WEATHER_URL, async (route) => route.fulfill({ status: 404, body: "Not Found" }));
  await page.goto("/explore/sample-ridge-loop");
  // Unknown weather is left out rather than drawn as a row, and is never clear.
  await expect(page.getByTestId("route-conditions")).toHaveCount(0);
  await expect(page.getByTestId("preparation-value-weather")).toHaveCount(0);
  // Server mechanics are not rider copy.
  await expect(page.getByText("Weather needs the planning server.")).toHaveCount(0);
  await expect(page.getByText("Clear", { exact: true })).toHaveCount(0);
});
