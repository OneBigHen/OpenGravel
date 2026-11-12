import { expect, test } from "@playwright/test";

import catalogFixture from "../../../data/catalog/e2e-fixture-routes.json";

import {
  placeEndpoint,
  plannerMap,
  pressPlan,
  settledExtent,
  type Coordinate,
} from "./map-helpers";

const START: Coordinate = { lon: -75.4385, lat: 40.1385 };
const FINISH: Coordinate = { lon: -75.4335, lat: 40.1325 };

/** Three rides near the test position, long enough and varied enough for the strip. */
const WEEKEND_ROUTES = [
  { id: "weekend-quarry", name: "Weekend Quarry Loop", lon: -75.49, surface: "Mostly unpaved · 42 mi gravel", curvature: "Few curves", distanceKm: 120, minutes: 200 },
  { id: "weekend-ridge", name: "Weekend Ridge Run", lon: -75.47, surface: "Mostly paved · 3 mi gravel", curvature: "17 mi of curves", distanceKm: 95, minutes: 170 },
  { id: "weekend-creek", name: "Weekend Creek Road", lon: -75.45, surface: "Paved", curvature: "Few curves", distanceKm: 80, minutes: 150 },
] as const;

const WEEKEND_POSITION = { latitude: 40.6, longitude: -75.5 };

/** The catalog list and detail shapes the Explore client reads. */
async function serveWeekendCatalog(page: import("@playwright/test").Page): Promise<void> {
  const sample = catalogFixture[0]!;
  const routes = WEEKEND_ROUTES.map((route) => ({
    ...sample,
    id: route.id,
    name: route.name,
    region: "Demo area",
    distanceKm: route.distanceKm,
    estimatedTimeMinutes: route.minutes,
    surfaceSummary: route.surface,
    curvatureSummary: route.curvature,
    preview: [
      { lon: route.lon, lat: 40.6 },
      { lon: route.lon + 0.04, lat: 40.63 },
    ],
  }));
  await page.route("**/api/catalog", (route) => route.fulfill({ json: { count: routes.length, routes } }));
  await page.route("**/api/catalog/*", (route) => {
    const id = route.request().url().split("/").at(-1) ?? "";
    const match = routes.find((candidate) => candidate.id === id) ?? routes[0]!;
    const { preview, ...rest } = match;
    return route.fulfill({
      json: {
        route: {
          ...rest,
          geometry: preview,
          previewGeometry: preview,
        },
        variants: [],
      },
    });
  });
}

/** A Saturday and Sunday worth naming, from the phone's own local days. */
async function serveWeekendWeather(page: import("@playwright/test").Page): Promise<void> {
  await page.clock.setFixedTime(new Date(2026, 10, 14, 12));
  const saturday = {
    name: "Saturday",
    startTime: new Date(2026, 10, 14, 15).toISOString(),
    endTime: new Date(2026, 10, 14, 18).toISOString(),
    temperatureF: 54,
    precipChance: 10,
    shortForecast: "Sunny",
  };
  const sunday = {
    name: "Sunday",
    startTime: new Date(2026, 10, 15, 14).toISOString(),
    endTime: new Date(2026, 10, 15, 17).toISOString(),
    temperatureF: 49,
    precipChance: 70,
    shortForecast: "Rain",
  };
  await page.route("**/api/weather?*", (route) => route.fulfill({
    json: { snapshot: { fetchedAt: new Date().toISOString(), source: "nws", alerts: [], forecast: [saturday, sunday] } },
  }));
}

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
  // The planner comes back with whatever ride was last open, so the ride this
  // test plans and saves is authored first, on a planner that starts empty.
  // Authoring it after "Ride this" would be planning on top of the catalog
  // ride, mid-restore, where a held press can only stop the camera.
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await pressPlan(page);
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await page.getByTestId("named-ride-title").fill("My sample ride");
  await page.getByTestId("save-named-ride").click();
  await expect(page.getByText("Named ride saved. Your active draft remains available.")).toBeVisible();

  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sample (Ridge|Creek|Foothills)/ })).toHaveCount(3);

  // Source is one of the decisions behind the first chip in the filter row: the
  // rider opens Filters, picks it there, and closes the sheet with the button
  // that says how many rides are left.
  await page.getByRole("button", { name: /^Filters/ }).click();
  const filters = page.getByRole("region", { name: "Explore filters" });
  await expect(filters).toHaveAttribute("data-open", "true");
  await filters.getByRole("combobox", { name: "Filter by source" }).selectOption("catalog");
  // The source badge says where the rider is, not the name of the store the
  // published rides are kept in.
  await expect(page.locator(".og-explore-card__source").first()).toHaveText("From Explore");
  await expect(filters.getByRole("option", { name: "From Explore" })).toHaveCount(1);
  await filters.getByRole("button", { name: /^Show \d+ routes$/ }).click();
  // The sheet is shut (it is `display: none` once closed, so the chip is what
  // states it) and the list it filters is the page again.
  await expect(page.getByRole("button", { name: /^Filters/ })).toHaveAttribute("aria-expanded", "false");
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
  await expect(page.getByRole("heading", { name: "Before you ride" })).toHaveCount(0);
  // One line of weather at the start: no state badge, no freshness badge and no
  // provider provenance on the route page.
  await expect(page.getByTestId("route-conditions")).toContainText("at the start");
  await expect(page.getByTestId("route-conditions")).not.toContainText(/Source:|Fresh|Ready/);
  // The per-check briefing rows belong to the planner, never to this page.
  await expect(page.getByTestId("preparation-value-weather")).toHaveCount(0);
  await expect(page.getByText("Clear", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Offline ready", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Offline readiness", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Ride this" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("active-ride-title")).toHaveText("Sample Ridge Loop");
  await expect(page.getByTestId("active-ride-provenance")).toContainText("catalog");
  const prepare = page.getByTestId("prepare");
  if ((await prepare.getAttribute("open")) === null) await page.getByTestId("prepare-toggle").click();
  // What the ride can use before its reserve: the garage fixture is a 60 mi
  // tank with a 30 mi reserve, so it says 30.
  await expect(page.locator(".og-prepare__bike > span")).toContainText("Trail bike · 30 mi range");

  await page.getByRole("link", { name: "Explore" }).click();
  await expect(page).toHaveURL(/\/explore$/);

  await page.goto("/explore");
  await expect(page.getByRole("link", { name: "My sample ride" })).toBeVisible();
  await expect(page.locator(".og-explore-card__source").filter({ hasText: "Yours" })).toBeVisible();
});

test("leaves the road section out when no road evidence is matched, without console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await placeEndpoint(page, "start", START);
  await placeEndpoint(page, "finish", FINISH);
  await pressPlan(page);
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");

  await page.goto("/explore/sample-ridge-loop");
  // No matched road data means no road section at all: a heading plus an
  // explanation of an absence is longer than the fact it reports.
  await expect(page.getByRole("heading", { name: "Roads on this ride" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Roads on this ride" })).toHaveCount(0);
  await expect(page.getByTestId("route-conditions")).toContainText("at the start");
  await expect(page.getByRole("heading", { name: "Before you ride" })).toHaveCount(0);
  await expect(page.getByTestId("preparation-value-weather")).toHaveCount(0);
  await expect(page.getByText("Clear", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Offline ready", { exact: true })).toHaveCount(0);
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
  // The rides lead the screen; the search field and the list are the first content.
  await expect(page.getByRole("searchbox", { name: "Search routes" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Explore routes" })).toBeVisible();
  await expect(page.getByRole("button", { name: /road details/i })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("shows the honest Roads empty state when road data is unavailable", async ({ page }) => {
  await page.goto("/explore?roads=empty");
  await page.getByRole("tab", { name: "Ride", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search routes" })).toBeVisible();
  await expect(page.getByRole("button", { name: /road details/i })).toHaveCount(0);
});

test("shows rides near the rider this weekend, opens one, and tells the truth about it", async ({ page, context }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(WEEKEND_POSITION);
  await serveWeekendCatalog(page);
  await serveWeekendWeather(page);
  let weatherRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/weather?")) weatherRequests += 1;
  });

  await page.goto("/explore");
  const strip = page.getByTestId("weekend-picks");
  await expect(strip).toBeVisible();
  const cards = strip.getByTestId("weekend-pick");
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);
  for (let index = 0; index < count; index += 1) {
    const weather = cards.nth(index).getByTestId("weekend-pick-weather");
    await expect(weather).not.toBeEmpty();
    // A phrase names its day; no day was ever called dry without a forecast.
    await expect(weather).toContainText(/^(?:Sat|Sun):|Forecast not available/);
  }
  // One forecast per card start, never one per render.
  expect(weatherRequests).toBeGreaterThan(0);
  expect(weatherRequests).toBeLessThanOrEqual(3);

  const opened = cards.first();
  const openedName = (await opened.textContent()) ?? "";
  await opened.click();
  await expect(page).toHaveURL(/\/explore\/weekend-/);

  // The ride page tells the truth: surface, bike, closure check, in that order.
  const truth = page.getByTestId("ride-truth");
  await expect(truth).toBeVisible();
  await expect(truth.locator(".og-truth__line")).toHaveCount(3);
  await expect(truth).toContainText(/Surface unknown|\d+(?:\.\d+)? mi (?:gravel|dirt|unpaved)|all paved/);
  await expect(truth).toContainText("Closures not checked for this ride");
  // The planner's long-trip checklist is no longer this page's box.
  await expect(page.getByText("Long-trip considerations")).toHaveCount(0);
  // Share and GPX live under "Take it with you"; the bar is the two commitments.
  const actions = page.getByRole("region", { name: "Route actions" });
  await expect(actions.getByRole("button")).toHaveCount(2);
  await expect(actions.getByRole("button", { name: "Ride this" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Save" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Take this ride with you" }).getByTestId("route-share")).toBeVisible();

  // The fixed bar never covers the first truth line.
  const firstLine = truth.locator(".og-truth__line").first();
  await firstLine.scrollIntoViewIfNeeded();
  const barBox = await actions.boundingBox();
  const lineBox = await firstLine.boundingBox();
  expect(barBox).not.toBeNull();
  expect(lineBox).not.toBeNull();
  const overlaps = barBox!.y < lineBox!.y + lineBox!.height
    && lineBox!.y < barBox!.y + barBox!.height
    && barBox!.x < lineBox!.x + lineBox!.width
    && lineBox!.x < barBox!.x + barBox!.width;
  expect(overlaps).toBe(false);
  expect(openedName.length).toBeGreaterThan(0);
});

test("shows no weekend strip without a position", async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await serveWeekendCatalog(page);

  await page.goto("/explore");
  await expect(page.getByRole("list", { name: "Explore routes" })).toBeVisible();
  await expect(page.getByTestId("weekend-picks")).toHaveCount(0);
});
