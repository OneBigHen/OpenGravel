import { expect, test, type Page } from "@playwright/test";

import {
  placeEndpoint,
  plannerMap,
  pressPlan,
  settledExtent,
  type Coordinate,
} from "./map-helpers";

/**
 * Critical browser workflow: plan on the laptop, send the ride to a phone, ride
 * it there.
 *
 * The promises this spec holds at the browser boundary:
 *
 * 1. "Send to phone" is a desktop affordance beside Save, and it publishes the
 *    rider's own line with no privacy trim.
 * 2. The QR is drawn in the browser as inline SVG: opening the dialog makes no
 *    request to any third-party host, so the link never leaves the app to be
 *    turned into a picture.
 * 3. The phone opens the same route, shows the same distance, and "Ride this"
 *    puts that exact shared line into the planner with Start enabled.
 */

const START_COORDINATE: Coordinate = { lon: -75.4385, lat: 40.1385 };
const DESTINATION_COORDINATE: Coordinate = { lon: -75.4335, lat: 40.1325 };

function routeCards(page: Page) {
  return page.locator('[data-testid^="route-card-"]');
}

async function planFixtureRoute(page: Page): Promise<void> {
  await placeEndpoint(page, "start", START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await placeEndpoint(page, "finish", DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
  await pressPlan(page);
  await expect(routeCards(page)).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await routeCards(page).first().click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("the laptop sends the exact route to a phone, which rides it", async ({
  page,
  browser,
  baseURL,
}) => {
  await planFixtureRoute(page);
  const distance = ((await routeCards(page).first().getByTestId("route-distance").textContent()) ?? "").trim();
  expect(distance.length).toBeGreaterThan(0);

  // The QR dialog is a desktop secondary action; opening it must not ask an
  // outside service to draw the code.
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.getByTestId("send-to-phone").click();
  const linkText = page.getByTestId("send-to-phone-link");
  await expect(linkText).toBeVisible();
  const link = ((await linkText.textContent()) ?? "").trim();
  expect(link).toMatch(/\/share\/[0-9a-f]{64}$/);

  const qr = page.getByTestId("send-to-phone-qr");
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((element) => element.tagName.toLowerCase())).toBe("svg");
  const base = new URL(baseURL ?? "http://127.0.0.1");
  const foreign = requests
    .map((url) => new URL(url))
    .filter((url) => url.protocol !== "data:" && url.origin !== base.origin);
  expect(foreign, "the QR must be drawn without a third-party request").toEqual([]);

  // The rider's own phone: a fresh context at iPhone Pro Max size, no laptop
  // storage shared, exactly as a scan would open it.
  const phone = await browser.newContext({
    viewport: { width: 440, height: 956 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const phonePage = await phone.newPage();
    await phonePage.goto(link);
    await expect(phonePage.getByTestId("shared-distance")).toHaveText(distance);
    await expect(phonePage.getByTestId("shared-time")).not.toHaveText("Not shared");

    await phonePage.getByTestId("ride-this-shared").click();
    await expect(phonePage.getByTestId("planner-map")).toBeVisible();
    await expect(phonePage.locator('[data-testid^="route-card-"]')).toHaveCount(1);
    await expect(phonePage.getByTestId("route-distance")).toHaveText(distance);
    await expect(phonePage.getByTestId("start-ride")).toBeEnabled();
  } finally {
    await phone.close();
  }
});
