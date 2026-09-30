import { expect, test, type Page } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";

/**
 * Ride style (MVP parity M2, OGV-D-262): a loop needs only a start and a ride
 * time; road character, surface, highways and tolls are one tap each and every
 * change replans. The route answer is the fixture (`OGV_ROUTE_PLAN_FIXTURE`);
 * `tests/real-router/ride-style-live.test.ts` proves the engine answers
 * differently for each choice.
 */

function routeCards(page: Page) {
  return page.locator('[data-testid^="route-card-"]');
}

/** Opens the style panel when it is behind the compact disclosure (and the
 * phone sheet, whose peek detent leaves ride style behind the handle). */
async function openStyle(page: Page) {
  const sheet = page.locator(".og-planner__sheet");
  if ((await sheet.getAttribute("data-detent")) === "peek") {
    await page.getByTestId("sheet-handle").click();
  }
  const toggle = page.getByTestId("ride-style-toggle");
  if (await toggle.isVisible()) {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await page.getByTestId("start-search").fill("Jim Thorpe");
  await page.getByTestId("start-search").press("Enter");
  await expect(page.getByTestId("start-value")).toContainText("Jim Thorpe, PA");
});

test("a loop from the start with a ride time plans without a destination", async ({ page }) => {
  // The chip's radio covers it (it is the tap target), so tap the radio.
  await page.getByTestId("ride-shape-loop").check();
  await expect(page.getByTestId("ride-shape-loop")).toBeChecked();
  await expect(page.getByTestId("loop-time")).toBeVisible();
  await expect(page.getByTestId("finish-search")).toHaveCount(0);
  await expect(page.getByTestId("loop-time-120")).toBeChecked();

  await page.getByTestId("loop-time-90").check();
  await expect(page.getByTestId("loop-time-90")).toBeChecked();

  await page.getByTestId("compose-create").click();
  await expect(routeCards(page).first()).toBeVisible();

  // Back to a destination: the destination row returns.
  await page.getByTestId("ride-shape-destination").check();
  await expect(page.getByTestId("finish-search")).toBeVisible();
});

test("road character, surface and tolls are one tap each and replan", async ({ page }) => {
  await page.getByTestId("finish-search").fill("hawk mountain s");
  await page.getByTestId("finish-search").press("Enter");
  await expect(page.getByTestId("finish-value")).toContainText("Hawk Mountain Sanctuary, PA");
  await page.getByTestId("compose-create").click();
  await expect(routeCards(page).first()).toBeVisible();

  await openStyle(page);
  await page.getByTestId("road-character-curvy").check();
  await expect(page.getByTestId("road-character-curvy")).toBeChecked();
  await page.getByTestId("novelty-preference-prefer-new-to-me").check();
  await expect(page.getByTestId("novelty-preference-prefer-new-to-me")).toBeChecked();
  await page.getByTestId("surface-preference-pavement").check();
  await expect(page.getByTestId("surface-preference-pavement")).toBeChecked();
  // Tolls are avoided by default; one tap lets them back in.
  await expect(page.getByTestId("avoid-tolls")).toBeChecked();
  await page.getByTestId("avoid-tolls").uncheck();
  await expect(page.getByTestId("avoid-tolls")).not.toBeChecked();
  await expect(page.getByTestId("ride-style-summary")).toHaveText("Curvy · New to me · Paved");

  // The replan the style change started still answers.
  await expect(routeCards(page).first()).toBeVisible();
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
});
