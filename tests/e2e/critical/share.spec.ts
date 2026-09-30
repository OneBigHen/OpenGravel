import { expect, test, type Page } from "@playwright/test";

import { clickMapAtCoordinate, plannerMap, settledExtent, type Coordinate } from "./map-helpers";

/**
 * Critical browser workflow (Task 11.1): the share flow, end to end.
 *
 * The three promises this spec holds at the browser boundary:
 *
 * 1. **Preview exact before publish.** The privacy preview renders the exact
 *    serialized bytes a link exposes (versioned canonical JSON), and the link
 *    is minted over that very snapshot.
 * 2. **Privacy trims the shared route** (11 §1): the hide controls change what
 *    the preview exposes, and the shared geometry is never the full geometry
 *    while zones are hidden.
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
  await clickMapAtCoordinate(page, START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
  await page.getByTestId("compose-create").click();
  await expect(routeCards(page)).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await routeCards(page).first().click();
}

async function openShareSheet(page: Page): Promise<void> {
  await page.getByTestId("open-share").click();
  await expect(page.getByTestId("share-sheet")).toBeVisible();
  // §12 requires the shared ride to carry a title, and the sheet owns that
  // field (the active draft is usually untitled — named saves are copies), so
  // the preview refuses to render until one is given. Naming it is the flow.
  await page.getByTestId("share-title").fill("Pine Loop");
  await expect
    .poll(async () => (await payload(page)).length)
    .toBeGreaterThan('{"version":1,'.length);
}

async function payload(page: Page): Promise<string> {
  return (await page.getByTestId("share-preview-payload").textContent()) ?? "";
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("share exposes only a privacy-trimmed snapshot and the link dies on revoke", async ({
  page, request,
}) => {
  await selectFixtureRoute(page);
  await openShareSheet(page);

  // 1. The preview is real data: canonical versioned JSON (§12 allowlist —
  //    the sheet is the whole payload surface and it carries no location
  //    provenance fields), and privacy-first by default.
  const initialBytes = await payload(page);
  expect(initialBytes.startsWith('{"version":1,')).toBe(true);
  expect(initialBytes).not.toMatch(/"sourceId"|"observedAt"|"savedPlaceId"|"query"/);
  const initial = JSON.parse(initialBytes) as {
    distanceMeters: number;
    author: unknown;
  };
  expect(initial.author).toBeNull();
  const privacyFirstDistance = initial.distanceMeters;
  expect(privacyFirstDistance).toBeGreaterThan(0);

  // 2. The §11 trims respond to their controls: showing the start again and
  //    trimming 250 m from both ends changes exactly what the link would expose.
  await page.getByRole("checkbox", { name: "Hide the start" }).click();
  await page.getByTestId("share-trim-meters").fill("250");
  await expect
    .poll(async () => {
      const parsed = JSON.parse(await payload(page)) as { distanceMeters: number };
      return parsed.distanceMeters;
    })
    .not.toBe(privacyFirstDistance);

  // 3. Publishing mints one opaque, unguessable link over the previewed bytes.
  const previewedBytes = await payload(page);
  await page.getByTestId("share-publish").click();
  const linkInput = page.getByTestId("share-link");
  await expect(linkInput).toBeVisible();
  const firstLink = await linkInput.inputValue();
  expect(firstLink).toMatch(/\/share\/[0-9a-f]{64}$/);
  const token = firstLink.split("/").pop()!;
  expect(await (await request.get(new URL(`/api/shares/resolve/${token}`, firstLink).href)).text()).toBe(previewedBytes);

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
  expect(await (await request.get(new URL(`/api/shares/resolve/${secondLink.split("/").pop()!}`, secondLink).href)).text()).toBe(previewedBytes);
  // The bytes behind the new link are still the previewed bytes.
  expect(previewedBytes.startsWith('{"version":1,')).toBe(true);
});
