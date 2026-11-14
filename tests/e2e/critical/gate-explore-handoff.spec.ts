import { expect, test } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";

/**
 * GATE-EXPLORE-HANDOFF (#323; behind QA-07).
 *
 * A rider picks the first ride in Explore, reads its facts, taps "Ride this" and lands in the planner.
 * The ride in front of them must be the ride they chose: same name, same distance, same surface words,
 * and a start and finish that are real places on the map (not blank, not "Set start").
 */
test.describe.configure({ timeout: 120_000 });

function milesIn(text: string | null): number {
  const found = /(\d+(?:[.,]\d+)?)\s*mi\b/.exec(text ?? "");
  if (found === null) throw new Error(`no miles in "${text}"`);
  return Number(found[1]!.replace(",", "."));
}

const squash = (text: string | null): string => (text ?? "").replace(/\s+/g, " ").trim();

for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }] as const) {
  test(`the first Explore ride keeps its distance, surface and name through Ride this (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/explore");
    const list = page.getByRole("list", { name: "Explore routes" });
    await expect(list).toBeVisible();
    const first = list.getByRole("link").first();
    const listedName = squash(await first.locator(".og-explore-card__title").first().textContent());
    await first.click();
    await expect(page).toHaveURL(/\/explore\/[^/]+$/);

    // What the ride page promised.
    const detailName = squash(await page.getByRole("heading", { level: 1 }).first().textContent());
    expect(detailName, "the page is the ride that was tapped").toBe(listedName);
    const distanceStat = page.locator("[data-testid='route-facts'] [data-stat='distance'] dd");
    await expect(distanceStat).toBeVisible();
    const promisedMiles = milesIn(await distanceStat.textContent());
    const surfaceLine = page.getByTestId("phone-surface-line");
    const promisedSurface = (await surfaceLine.count()) > 0 ? squash(await surfaceLine.first().textContent()) : null;

    await page.getByTestId("ride-this").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);
    const summary = page.getByTestId("route-summary");
    await expect(summary).toBeVisible({ timeout: 45_000 });

    // What the plan shows.
    expect(squash(await page.getByTestId("phone-destination").textContent()), "ride name").toBe(detailName);
    const planMiles = milesIn(await summary.locator(".og-phone-summary__arrive").textContent());
    expect(planMiles, "distance in the plan is the distance on the ride page").toBeCloseTo(promisedMiles, 0);
    if (promisedSurface !== null) {
      await expect(page.getByTestId("phone-surface-line").first(), "surface words").toHaveText(promisedSurface);
    }
    // Start and finish are named places the rider can read.
    for (const chip of ["start-chip", "finish-chip"]) {
      const text = squash(await page.getByTestId(chip).first().textContent());
      expect(text, `${chip} has a name`).not.toBe("");
      expect(text, `${chip} is a real stop, not the empty prompt`).not.toMatch(/^(Set |Choose |Add )/i);
    }
  });
}
