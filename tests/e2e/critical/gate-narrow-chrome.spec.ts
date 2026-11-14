import { expect, test } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";
import {
  PHONE_SIZES,
  expectNoSidewaysScroll,
  expectReachable,
  floatingControlProblems,
  settleChrome,
  waitingOn,
  withWeatherAlert,
} from "./rider-gate-helpers";
import { directionsTo } from "./search-helpers";

/**
 * GATE-NARROW-CHROME (#320; behind QA-01, QA-02, QA-08).
 *
 * On the two phones riders actually hold (390 wide, and the small 320), with a weather alert squeezing
 * the top bar: nothing hangs off the screen, no two top-bar controls sit on top of each other, and the
 * words the rider types into the search box are really there to read.
 *
 * Waiting on the fixes in open PR #242 (small phones and landscape): on main the weather chip spills
 * over the menu button at 320 and covers typed text. Remove the fixme when #242 lands.
 */
test.describe.configure({ timeout: 120_000 });

const FIX_242 = "waiting on PR #242 (small phones and landscape): on main the weather chip crowds the menu at 320";

for (const size of PHONE_SIZES) {
  const tag = `${size.width}x${size.height}`;

  test.describe(tag, () => {
    test.beforeEach(async ({ page }) => {
      await withWeatherAlert(page);
      await page.setViewportSize(size);
      await page.goto("/");
      await expect(plannerMap(page)).toBeVisible();
      await settledExtent(page);
      await expect(page.getByTestId("top-search")).toBeVisible();
    });

    test(`home map with a weather alert: nothing hangs off ${tag} and no controls overlap`, async ({ page }) => {
      if (size.width === 320) waitingOn(FIX_242);
      // The alert really is in the bar (otherwise this measures nothing).
      await expect(page.getByTestId("top-search").getByText(/Freeze Warning/)).toBeVisible({ timeout: 15_000 });
      await settleChrome(page);
      await expectNoSidewaysScroll(page, `home ${tag}`);
      expect(await floatingControlProblems(page), `home ${tag}`).toEqual([]);
      await expectReachable(page, page.getByTestId("app-menu"), "the menu button");
      await expectReachable(page, page.getByTestId("map-layers-toggle"), "the Layers button");
    });

    test(`typed search text is visible ${tag}`, async ({ page }) => {
      if (size.width === 320) waitingOn(FIX_242);
      const field = page.getByTestId("top-place-search");
      await field.fill("Hawk Mountain Sanctuary");
      const box = await field.boundingBox();
      if (box === null) throw new Error("the search field has no box");
      // Enough room to read what was typed, and nothing floating over the field.
      expect(box.width, "the typed text has room").toBeGreaterThanOrEqual(size.width * 0.35);
      const covered = await field.evaluate((input) => {
        const r = input.getBoundingClientRect();
        // Probe along the writing line, from the first letter to near the end of the field.
        return [0.08, 0.3, 0.55, 0.8].filter((share) => {
          const hit = document.elementFromPoint(r.left + r.width * share, r.top + r.height / 2);
          return hit !== null && hit !== input && !input.contains(hit);
        });
      });
      expect(covered, "points along the typed text that belong to another control").toEqual([]);
      // What the field holds is what it shows: the text is not scrolled out of its own box.
      const scrolled = await field.evaluate((input: HTMLInputElement) => input.scrollLeft);
      expect(scrolled, "the field has not scrolled past its first letters").toBeLessThanOrEqual(1);
      expect(box.x + box.width, "the field ends on screen").toBeLessThanOrEqual(size.width + 1);
    });

    test(`the plan sheet after Directions keeps every control on screen ${tag}`, async ({ page }) => {
      if (size.width === 320) waitingOn(FIX_242);
      await directionsTo(page);
      await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
      await settleChrome(page);
      await expectNoSidewaysScroll(page, `plan ${tag}`);
      expect(await floatingControlProblems(page), `plan ${tag}`).toEqual([]);
      await expectReachable(page, page.getByTestId("start-ride"), "Start");
    });

    test(`Explore header does not stretch the page ${tag}`, async ({ page }) => {
      if (size.width === 320) waitingOn(FIX_242);
      await page.goto("/explore");
      await expect(page.getByRole("heading", { name: "Explore" }).first()).toBeVisible();
      await settleChrome(page);
      await expectNoSidewaysScroll(page, `explore ${tag}`);
      expect(await floatingControlProblems(page), `explore ${tag}`).toEqual([]);
    });
  });
}
