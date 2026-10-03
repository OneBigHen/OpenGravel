import { expect, test, type Page } from "@playwright/test";

import {
  cameraGeneration,
  clickMapAtCoordinate,
  fractionOf,
  openRefine,
  plannerMap,
  settledExtent,
  type Extent,
} from "./map-helpers";
import { openRideSheet, rideMapReady, startRide } from "./ride-focus-helpers";

const SAMPLE_CAFE = {
  id: "hh:sample-cafe",
  coordinate: { lon: -75.435, lat: 40.136 },
} as const;

const START_COORDINATE = { lon: -75.4385, lat: 40.1385 } as const;
const DESTINATION_COORDINATE = { lon: -75.4335, lat: 40.1325 } as const;

function showsCoordinate(
  extent: Extent,
  coordinate: { readonly lon: number; readonly lat: number },
): boolean {
  const fraction = fractionOf(extent, coordinate);
  return fraction.x >= 0.08 && fraction.x <= 0.92 && fraction.y >= 0.08 && fraction.y <= 0.92;
}

/** Zooms out through MapLibre until the fixture place is comfortably on screen. */
async function showPlaceCoordinate(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const extent = await settledExtent(page);
    if (showsCoordinate(extent, SAMPLE_CAFE.coordinate)) return;

    const before = await cameraGeneration(page);
    const box = await plannerMap(page).boundingBox();
    if (box === null) throw new Error("the Ride Focus map has no measured box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 480);
    await expect.poll(async () => cameraGeneration(page)).toBeGreaterThan(before);
  }

  const extent = await settledExtent(page);
  expect(showsCoordinate(extent, SAMPLE_CAFE.coordinate)).toBe(true);
}

function waitForSamplePlaceAnswer(page: Page) {
  return page.waitForResponse(async (response) => {
    if (new URL(response.url()).pathname !== "/api/places" || response.request().method() !== "GET") {
      return false;
    }
    try {
      const body = await response.json() as {
        readonly availability?: unknown;
        readonly places?: readonly { readonly id?: unknown }[];
      };
      return body.availability === "available"
        && body.places?.some((place) => place.id === SAMPLE_CAFE.id) === true;
    } catch {
      return false;
    }
  });
}

async function planFixtureRide(page: Page): Promise<void> {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await clickMapAtCoordinate(page, START_COORDINATE);
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
}

test("Ride Focus finds fixture places in the visible viewport", async ({ page }) => {
  await startRide(page);
  await rideMapReady(page);

  const placesControl = page.getByTestId("places-control").locator(".og-places-control__toggle");
  await expect(placesControl).toHaveAttribute("aria-pressed", "true");
  // DV-10: the map's pills ride in the sheet.
  await openRideSheet(page);
  // Ride Focus defaults Places on. Toggle through the rider control so this flow
  // proves both the off and on states before querying the fixture viewport.
  await placesControl.click();
  await expect(placesControl).toHaveAttribute("aria-pressed", "false");
  await placesControl.click();
  await expect(placesControl).toHaveAttribute("aria-pressed", "true");

  const fixtureAnswer = waitForSamplePlaceAnswer(page);
  await showPlaceCoordinate(page);
  const answer = await fixtureAnswer;
  const body = await answer.json() as {
    readonly attribution: string;
    readonly places: readonly { readonly id: string }[];
  };
  expect(body.attribution).toContain("(fixture)");
  expect(body.places.some((place) => place.id === SAMPLE_CAFE.id)).toBe(true);

  // The critical gate's deterministic empty basemap has no glyph URL, so the
  // map host omits its WebGL pill and selected-symbol layers. It has no rendered
  // place target to click; this browser path stops at the fixture-backed badge.
  const count = page.getByTestId("places-count");
  await expect.poll(async () => Number(await count.textContent())).toBeGreaterThan(0);
});

test("Along this ride lazily adds a fixture destination to the itinerary", async ({ page }) => {
  let opportunityRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/rider-opportunities") opportunityRequests++;
  });
  await planFixtureRide(page);
  expect(opportunityRequests).toBe(0);
  const along = page.getByRole("region", { name: "Route opportunities" });
  await along.getByRole("button", { name: "Along this ride" }).click();
  const firstRow = along.locator("li.og-explore-card").filter({ has: page.getByRole("button", { name: /^Add stop/ }) }).first();
  await expect(firstRow).toBeVisible();
  await expect(firstRow).toContainText(/Mile/);
  const title = await firstRow.locator("strong").textContent();
  if (title === null) throw new Error("the destination has no name");
  await firstRow.getByRole("button", { name: /^Add stop/ }).click();
  await openRefine(page);
  const itineraryStop = page.getByTestId("stops-list").locator('[data-testid^="point-row-stop-"]');
  await expect(itineraryStop).toHaveCount(1);
  await expect(itineraryStop.first()).toContainText(title);
});
