import { expect, test, type Page } from "@playwright/test";

import { openRideSheet, rideMapReady, startRide } from "./ride-focus-helpers";

/**
 * The ride Menu on a phone (OG-16, OG-17, owner's screenshots 2026-11-13):
 *
 * - "Emergency / Where am I, call 911" is always whole on screen: pinned above
 *   the scrolling rows, never sliced by the sheet's top edge;
 * - every Menu row can be scrolled to and pressed: none is cut in half by its
 *   own group, none sits under the ride strip or past the screen's bottom.
 *
 * Measured at 390 x 844 (iPhone 17) and 320 x 568 (the smallest phone we hold).
 */

const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

test.describe.configure({ timeout: 120_000 });

async function rideWithMenu(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("og.rideFixture.maxFixes", "6");
  });
  await page.setViewportSize(size);
  await startRide(page);
  await rideMapReady(page);
  await expect(page.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "maneuver", { timeout: 30_000 });
}

interface RowReport {
  readonly name: string;
  readonly problem: string;
}

/**
 * Walks every visible Menu row in one synchronous step (the Menu closes itself
 * after 8 s idle): scrolls it into view, then checks it is whole inside the
 * sheet, inside the screen, clear of the ride strip, at least 44 px tall and the
 * thing a finger at its centre would press.
 */
async function rowProblems(page: Page): Promise<RowReport[]> {
  return page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>('[data-testid="ride-panel"]');
    const strip = document.querySelector<HTMLElement>('[data-testid="ride-strip"]');
    if (sheet === null) return [{ name: "sheet", problem: "missing" }];
    const problems: { name: string; problem: string }[] = [];
    const rows = [...sheet.querySelectorAll<HTMLElement>(".og-ride__sheet-row, .og-ride__switch-row, [data-testid='ride-exit']")]
      .filter((row) => row.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }));
    if (rows.length < 5) problems.push({ name: "menu", problem: `only ${rows.length} rows` });
    for (const row of rows) {
      const name = (row.getAttribute("data-testid") ?? row.textContent ?? "").trim().slice(0, 40);
      row.scrollIntoView({ block: "nearest" });
      const r = row.getBoundingClientRect();
      const s = sheet.getBoundingClientRect();
      if (r.height < 44) problems.push({ name, problem: `only ${Math.round(r.height)}px tall` });
      if (r.top < s.top - 1 || r.bottom > s.bottom + 1) problems.push({ name, problem: "outside the sheet" });
      if (r.top < -1 || r.bottom > window.innerHeight + 1) problems.push({ name, problem: "off screen" });
      if (strip !== null) {
        const t = strip.getBoundingClientRect();
        if (r.bottom > t.top + 1 && r.top < t.bottom - 1) problems.push({ name, problem: "under the ride strip" });
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit === null || !(hit === row || row.contains(hit))) {
        problems.push({ name, problem: `covered by ${hit?.className || hit?.tagName || "nothing"}` });
      }
    }
    return problems;
  });
}

for (const size of SIZES) {
  test(`the ride Menu keeps 911 whole and every row reachable at ${size.width}x${size.height}`, async ({ page }) => {
    await rideWithMenu(page, size);

    await expect(async () => {
      await openRideSheet(page);
      const emergency = page.getByTestId("ride-emergency");
      // Scroll the rows to the bottom first: 911 must stay put.
      await page.getByTestId("ride-panel").evaluate((sheet) => {
        for (const scroller of [sheet, ...sheet.querySelectorAll<HTMLElement>("*")]) scroller.scrollTop = 1e6;
      });
      const box = await emergency.boundingBox();
      expect(box, "the Emergency row is on screen").not.toBeNull();
      const sheet = await page.getByTestId("ride-panel").boundingBox();
      expect(sheet).not.toBeNull();
      expect(box!.y, "911 top inside the screen").toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, "911 bottom inside the screen").toBeLessThanOrEqual(size.height);
      expect(box!.y, "911 top inside the sheet").toBeGreaterThanOrEqual(sheet!.y);
      expect(box!.height, "911 row is whole").toBeGreaterThanOrEqual(56);
      const hit = await emergency.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return top !== null && (top === element || element.contains(top));
      });
      expect(hit, "nothing covers 911").toBe(true);
    }).toPass({ timeout: 30_000 });

    await expect(async () => {
      await openRideSheet(page);
      expect(await rowProblems(page)).toEqual([]);
    }).toPass({ timeout: 30_000 });
  });
}
