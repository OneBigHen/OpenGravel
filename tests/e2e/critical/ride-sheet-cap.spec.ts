import { expect, test, type Locator, type Page } from "@playwright/test";
import { useConnectedRouteFixture } from "./connected-route-fixture";
import { plannerMap, settledExtent } from "./map-helpers";

/**
 * Map first (#221, owner 2026-11-12): the ride sheet at half is capped near 40%
 * of the screen so the map gets the rest. This guards what the cap must never
 * cost a rider on a small or a big phone: Start and Compare rides stay whole
 * and tappable, Compare's rides and Start fit inside the sheet, no row is cut
 * in half by the sheet's edge, and peek is a smaller sheet than half.
 */

const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 440, height: 956 },
] as const;

test.use({ hasTouch: true, geolocation: { latitude: 40.8757, longitude: -75.7324 }, permissions: ["geolocation"] });
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });

type Box = { top: number; bottom: number; left: number; right: number };

async function box(locator: Locator): Promise<Box> {
  const measured = await locator.boundingBox();
  if (measured === null) throw new Error("expected a measurable box");
  return { top: measured.y, bottom: measured.y + measured.height, left: measured.x, right: measured.x + measured.width };
}

/** Whole, inside the sheet, and the thing a finger at its centre would actually hit. */
async function expectReachable(page: Page, locator: Locator, name: string) {
  const sheet = await box(page.getByTestId("planner-sheet"));
  const target = await box(locator);
  expect(target.top, `${name} top inside the sheet`).toBeGreaterThanOrEqual(sheet.top - 1);
  expect(target.bottom, `${name} bottom inside the sheet`).toBeLessThanOrEqual(sheet.bottom + 1);
  expect(target.bottom - target.top, `${name} at least 44px tall`).toBeGreaterThanOrEqual(44);
  const hit = await locator.evaluate((element) => {
    const r = element.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top !== null && (top === element || element.contains(top));
  });
  expect(hit, `${name} is not covered by anything`).toBe(true);
}

/** Text in the sheet body that the sheet's bottom edge cuts through. */
async function slicedRows(page: Page): Promise<string[]> {
  return page.getByTestId("planner-sheet").evaluate((sheet) => {
    const edge = sheet.getBoundingClientRect().bottom;
    const cut: string[] = [];
    for (const element of sheet.querySelectorAll<HTMLElement>(".og-sheet__body *")) {
      if (element.children.length > 0 || !element.textContent?.trim()) continue;
      const r = element.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(element).visibility === "hidden") continue;
      if (r.top < edge - 1 && r.bottom > edge + 1) cut.push(element.textContent.trim().slice(0, 40));
    }
    return cut;
  });
}

for (const size of SIZES) {
  test(`the capped ride sheet keeps Start and Compare whole at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await useConnectedRouteFixture(page);
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);
    await page.getByTestId("search-chip-gas").click();
    await page.getByTestId("category-result").first().click();
    await page.getByTestId("place-directions").click();
    const sheet = page.getByTestId("planner-sheet");
    await expect(page.getByTestId("route-summary")).toBeVisible();
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await expect(page.getByTestId("start-ride")).toBeEnabled();

    // Half: the answer, Start and Compare rides, nothing cut by the edge.
    await expectReachable(page, page.getByTestId("start-ride"), "Start");
    await expectReachable(page, page.getByTestId("compare-rides"), "Compare rides");
    expect(await slicedRows(page)).toEqual([]);
    // The map's legend would sit on the destination; it waits while a ride is shown.
    await expect(page.getByTestId("map-legend")).toHaveCount(0);
    const half = await box(sheet);

    // Compare: every ride row and Start fit in the sheet, and Start is not covered.
    await page.getByTestId("compare-rides").click();
    const rows = page.getByTestId("phone-alternatives").locator(".og-phone-choice");
    await expect(rows).toHaveCount(2);
    for (const [index, row] of (await rows.all()).entries()) await expectReachable(page, row, `ride ${index + 1}`);
    await expectReachable(page, page.getByTestId("start-ride"), "Start while comparing");
    await expect(page.getByTestId("phone-ride-style")).toBeHidden();
    expect(await slicedRows(page)).toEqual([]);
    await page.getByTestId("compare-rides").click();
    await expect(page.getByTestId("phone-alternatives")).toHaveCount(0);

    // Peek is smaller than half and still offers Start.
    await page.getByTestId("sheet-handle").press("ArrowDown");
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await expect.poll(async () => { const peek = await box(sheet); return peek.bottom - peek.top; })
      .toBeLessThan(half.bottom - half.top);
    await expectReachable(page, page.getByTestId("start-ride"), "Start at peek");
  });
}
