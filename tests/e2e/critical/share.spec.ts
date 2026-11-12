import { expect, test, type Page } from "@playwright/test";

import {
  placeEndpoint,
  plannerMap,
  pressPlan,
  settledExtent,
  type Coordinate,
} from "./map-helpers";

/**
 * Critical browser workflow (R3-3): sharing is one tap.
 *
 * The promises this spec holds at the browser boundary:
 *
 * 1. **Nothing to fill in.** Share opens on the ride's own name and one green
 *    Create link, with no error and no JSON before the rider asks for anything.
 * 2. **Privacy trims the shared route** (11 §1). The options sit behind one
 *    closed line, the trim reads in miles, and the link's bytes show the trim.
 * 3. **Revocation makes the link unusable** (10 §10): revoking reports it
 *    honestly and only a new link (re-issue) works again — a different one.
 *
 * It runs in the same production fixture mode as the rest of the critical gate
 * (`OGV_ROUTE_PLAN_FIXTURE=1`), so the ride is authored at the fixture's
 * geography (Norristown; see `first-route.spec.ts` for why the taps go there).
 */

const START_COORDINATE: Coordinate = { lon: -75.4385, lat: 40.1385 };
const DESTINATION_COORDINATE: Coordinate = { lon: -75.4335, lat: 40.1325 };

function routeCards(page: Page) {
  return page.locator('[data-testid^="route-card-"]');
}

/** Places both endpoints, plans the fixture ride, and selects its first choice. */
async function selectFixtureRoute(page: Page): Promise<void> {
  await placeEndpoint(page, "start", START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await placeEndpoint(page, "finish", DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
  await pressPlan(page);
  await expect(routeCards(page)).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await routeCards(page).first().click();
}

async function openShareSheet(page: Page): Promise<void> {
  await page.getByTestId("open-share").click();
  const sheet = page.getByTestId("share-sheet");
  await expect(sheet).toBeVisible();
  // The name comes from the ride; the button is ready without typing anything.
  await expect(page.getByTestId("share-title")).not.toHaveValue("");
  await expect(page.getByTestId("share-publish")).toBeEnabled();
  // No error until the rider presses the button with an empty title.
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await expect(sheet.getByText(/needs a title/i)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("share opens on one button, hides its options, and the link dies on revoke", async ({
  page, request,
}) => {
  await selectFixtureRoute(page);
  await openShareSheet(page);

  // 1. One closed privacy line, in the rider's words and unit.
  const sheet = page.getByTestId("share-sheet");
  await expect(sheet.getByText("Privacy: start and finish hidden")).toBeVisible();
  await expect(sheet.getByText(/meters/i)).toHaveCount(0);
  await sheet.getByText("Privacy: start and finish hidden").click();
  await expect(sheet.getByRole("checkbox", { name: "Hide the start" })).toBeChecked();
  await expect(sheet.getByRole("checkbox", { name: "Hide the finish" })).toBeChecked();
  await expect(sheet.getByText("Trim from both ends (miles)")).toBeVisible();

  // 2. The controls reach the link: show both ends, trim a tenth of a mile.
  await sheet.getByRole("checkbox", { name: "Hide the start" }).click();
  await sheet.getByRole("checkbox", { name: "Hide the finish" }).click();
  await sheet.getByTestId("share-trim-miles").fill("0.1");
  await expect(sheet.getByText(/0.1 mi trimmed from each end/)).toBeVisible();

  // 3. Publishing mints one opaque link; the page shows no payload.
  await sheet.getByTestId("share-publish").click();
  const linkInput = page.getByTestId("share-link");
  await expect(linkInput).toBeVisible();
  await expect(sheet.getByText('{"version"')).toHaveCount(0);
  await expect(page.getByText('{"version"')).toHaveCount(0);
  await expect(sheet.getByText(/meters/i)).toHaveCount(0);

  const firstLink = await linkInput.inputValue();
  expect(firstLink).toMatch(/\/share\/[0-9a-f]{64}$/);
  const token = firstLink.split("/").pop()!;
  const output = await (await request.get(new URL(`/api/shares/resolve/${token}`, firstLink).href)).text();
  expect(output.startsWith('{"version":1,')).toBe(true);
  // The privacy allowlist only: no location provenance, no name by default.
  expect(output).not.toMatch(/"sourceId"|"observedAt"|"savedPlaceId"|"query"/);
  const snapshot = JSON.parse(output) as {
    author: unknown;
    distanceMeters: number;
    rideDistanceMeters: number | null;
  };
  expect(snapshot.author).toBeNull();
  expect(snapshot.distanceMeters).toBeGreaterThan(0);
  // The trimmed shared line is shorter than the ride the planner showed.
  if (snapshot.rideDistanceMeters !== null) {
    expect(snapshot.distanceMeters).toBeLessThan(snapshot.rideDistanceMeters);
  }

  // 4. Revocation is an honest state — and the revoked sheet carries no link.
  await page.getByTestId("share-revoke").click();
  await expect(page.getByTestId("share-revoked")).toBeVisible();
  await expect(page.getByTestId("share-link")).toHaveCount(0);
  expect((await request.get(new URL(`/api/shares/resolve/${token}`, firstLink).href)).status()).toBe(410);

  // 5. Re-issue is the only way back: a new, different link (the old one stays
  //    dead — proven at the service boundary by the unit suite).
  await page.getByTestId("share-reissue").click();
  await expect(linkInput).toBeVisible();
  const secondLink = await linkInput.inputValue();
  expect(secondLink).not.toBe(firstLink);
  expect(secondLink).toMatch(/\/share\/[0-9a-f]{64}$/);
  expect(await (await request.get(new URL(`/api/shares/resolve/${secondLink.split("/").pop()!}`, secondLink).href)).text()).toBe(output);
});
