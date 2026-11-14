import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { RoutePlanSuccessBody } from "../../../src/application/planner/ports/route-plan-contract";
import { rideMapReady, startRide } from "./ride-focus-helpers";

/**
 * OG-19: the street name is the part of a turn a rider acts on, so it is never
 * the part that gets cut. The screenshot that opened the issue read
 * "Turn right onto West Monument Aven…" — the card has to wrap the whole name,
 * on a normal phone (390) and on the smallest one still supported (320).
 *
 * The fixture plan's street names are replaced with a deliberately long one, so
 * the width is the only thing under test rather than whatever name a canned
 * route happened to carry.
 */

const LONG_STREET = "West Monument Avenue";
const VIEWPORT = { width: 390, height: 844 } as const;

test.use({ viewport: VIEWPORT, hasTouch: true });
test.describe.configure({ timeout: 120_000 });

/** Every instruction names the same long street, whichever maneuver is current. */
async function planAlongLongStreet(page: Page): Promise<void> {
  await page.route("**/api/route-plan", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as RoutePlanSuccessBody;
    const candidates = body.bundle.candidates.map((candidate) => ({
      ...candidate,
      instructions: candidate.instructions?.map((instruction) => ({
        ...instruction,
        text: `Turn left onto ${LONG_STREET}`,
        roadName: LONG_STREET,
      })),
    }));
    await route.fulfill({ response, json: { ...body, bundle: { ...body.bundle, candidates } } });
  });
}

/** What the rider can see of a card's street name: whole words, nothing over them. */
async function expectWholeStreet(page: Page, testInfo: TestInfo, width: number): Promise<void> {
  const card = page.getByTestId("ride-maneuver");
  await expect(card).toBeVisible();
  const road = page.getByTestId("ride-maneuver-road");
  await expect(road).toContainText(LONG_STREET);

  const seen = await card.evaluate((element) => {
    const action = element.querySelector(".og-ride__maneuver-action");
    if (action === null) throw new Error("the card has no action line");
    const box = action.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      text: action.textContent ?? "",
      scrollWidth: action.scrollWidth,
      clientWidth: action.clientWidth,
      left: box.left,
      right: box.right,
      cardScrollWidth: element.scrollWidth,
      cardClientWidth: element.clientWidth,
      cardHeight: element.getBoundingClientRect().height,
      hitInside: hit !== null && element.contains(hit),
    };
  });

  // The name is there whole — no ellipsis, no clipped overflow — and nothing is
  // drawn over it where the rider reads it.
  expect(seen.text).toContain(LONG_STREET);
  expect(seen.text).not.toContain("…");
  expect(seen.scrollWidth).toBeLessThanOrEqual(seen.clientWidth + 1);
  expect(seen.left).toBeGreaterThanOrEqual(0);
  expect(seen.right).toBeLessThanOrEqual(width);
  expect(seen.hitInside).toBe(true);
  // The card grows to a second line rather than pushing the name out of the box.
  expect(seen.cardScrollWidth).toBeLessThanOrEqual(seen.cardClientWidth + 1);
  expect(seen.cardHeight).toBeGreaterThanOrEqual(96);

  // A taller card still leaves the road ahead: it never runs into the strip.
  const room = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="ride-maneuver"]')!.getBoundingClientRect();
    const strip = document.querySelector('[data-testid="ride-strip-bar"]')!.getBoundingClientRect();
    return { top: card.top, bottom: card.bottom, stripTop: strip.top };
  });
  expect(room.top).toBeGreaterThanOrEqual(0);
  expect(room.bottom).toBeLessThanOrEqual(room.stripTop);

  await page.screenshot({ path: testInfo.outputPath(`turn-name-${width}.png`) });
}

test("a long street name is shown whole on the turn card, at 390 and at 320 (OG-19)", async ({ page }, testInfo) => {
  // Hold the fixture rider still after a couple of fixes, so the card stays on
  // the same instruction while the name is measured at both widths.
  await page.addInitScript(() => {
    window.localStorage.setItem("og.rideFixture.maxFixes", "2");
  });
  await planAlongLongStreet(page);
  await startRide(page);
  await rideMapReady(page);
  await expect(page.locator("html")).toHaveAttribute("data-ride-fixture", "held");

  await expectWholeStreet(page, testInfo, VIEWPORT.width);

  await page.setViewportSize({ width: 320, height: 568 });
  // The card re-lays out on the resize; assert against the same instruction.
  await expect(page.getByTestId("ride-maneuver-road")).toContainText(LONG_STREET);
  await expectWholeStreet(page, testInfo, 320);
});
