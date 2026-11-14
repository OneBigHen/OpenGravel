import { expect, test, type Page } from "@playwright/test";

import { fractionOf, plannerMap, readCoordinate, readExtent, settledExtent } from "./map-helpers";
import { directionsTo } from "./search-helpers";

/**
 * Sheets must leave the thing being edited visible (QA-06, QA-12, QA-14, 2026-11-14).
 *
 * At 390x844 and 320x568 the map keeps at least 40% of the screen at the sheet's
 * tallest phone height, and the route sits inside the map the rider can actually see.
 */

const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

test.describe.configure({ timeout: 120_000 });

async function openPlanner(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
}

/** Top edge of a surface, as a share of the viewport height. */
async function topShare(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error(`${testId} has no box`);
  return box.y / viewport.height;
}

/** Both route ends are inside the map rectangle that no sheet covers. */
async function expectRouteInVisibleMap(page: Page): Promise<void> {
  await expect(async () => {
    const map = await plannerMap(page).boundingBox();
    const sheet = await page.getByTestId("planner-sheet").boundingBox();
    if (map === null || sheet === null) throw new Error("no map or sheet box");
    const extent = await readExtent(page);
    for (const id of ["start-value", "finish-value"]) {
      const at = fractionOf(extent, await readCoordinate(page, id));
      const x = map.x + at.x * map.width;
      const y = map.y + at.y * map.height;
      expect(x, `${id} x`).toBeGreaterThan(map.x);
      expect(x, `${id} x`).toBeLessThan(map.x + map.width);
      expect(y, `${id} y below the map top`).toBeGreaterThan(map.y);
      expect(y, `${id} y above the sheet`).toBeLessThan(sheet.y);
    }
  }).toPass({ timeout: 20_000 });
}

for (const size of SIZES) {
  const label = `${size.width}x${size.height}`;

  test(`QA-06 ${label}: Edit ride keeps the route in the map and the stop count matches the list`, async ({ page }) => {
    await openPlanner(page, size);
    await directionsTo(page);
    await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
    await page.getByTestId("trip-edit").click();
    await expect(page.getByRole("heading", { name: "Edit ride" })).toBeVisible();
    await expect(page.getByTestId("stops-list")).toBeVisible();

    expect(await topShare(page, "planner-sheet"), "the map keeps at least 40% of the screen").toBeGreaterThanOrEqual(0.4 - 0.005);
    await expectRouteInVisibleMap(page);

    // "N stops" in the summary equals the stops listed (the list also holds start and finish).
    const summary = (await page.locator(".og-refine__summary").textContent()) ?? "";
    const claimed = /(\d+) stops?/.exec(summary);
    const listed = (await page.getByTestId("stops-list").locator("> li").count()) - 2;
    expect(claimed === null ? 0 : Number(claimed[1]), "stops claimed").toBe(listed);
  });

  test(`QA-12 ${label}: loop style controls leave the loop in view and every Roads choice whole`, async ({ page }) => {
    await page.context().setGeolocation({ latitude: 40.1385, longitude: -75.4385 });
    await page.context().grantPermissions(["geolocation"]);
    await openPlanner(page, size);
    await page.getByTestId("loop-near-me").click();
    await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 45_000 });
    // Open the sheet to its tallest height, where the Roads / Surface controls live.
    const dock = page.getByTestId("planner-dock");
    for (let step = 0; step < 3 && (await dock.getAttribute("data-detent")) !== "full"; step += 1) {
      await page.getByTestId("sheet-handle").press("ArrowUp");
      await page.waitForTimeout(400);
    }
    await expect(dock).toHaveAttribute("data-detent", "full");
    expect(await topShare(page, "planner-sheet"), "the map keeps at least 40% of the screen").toBeGreaterThanOrEqual(0.4 - 0.005);

    const track = page.locator(".og-phone-style__track").first();
    await track.scrollIntoViewIfNeeded();
    const trackBox = await track.boundingBox();
    if (trackBox === null) throw new Error("no Roads track");
    expect(await track.evaluate((el) => el.scrollWidth <= el.clientWidth), "Roads choices are not clipped").toBe(true);
    const chips = track.locator(".og-phone-style__chip span");
    for (let index = 0; index < (await chips.count()); index += 1) {
      const chip = await chips.nth(index).boundingBox();
      if (chip === null) throw new Error("chip has no box");
      expect(chip.x, `chip ${index} left`).toBeGreaterThanOrEqual(trackBox.x - 1);
      expect(chip.x + chip.width, `chip ${index} right`).toBeLessThanOrEqual(trackBox.x + trackBox.width + 1);
    }
  });

  test(`QA-14 ${label}: Layers leaves the map visible and "N active" agrees with the rows`, async ({ page }) => {
    await openPlanner(page, size);
    await page.getByTestId("map-layers-toggle").click();
    const panel = page.getByRole("region", { name: "Map layers" });
    await expect(panel).toBeVisible();
    const share = (await panel.boundingBox())!.y / size.height;
    expect(share, "the map keeps at least 40% of the screen").toBeGreaterThanOrEqual(0.4 - 0.005);

    await page.getByTestId("map-lens-fun").click();
    const header = (await panel.locator(".og-layers__active").textContent()) ?? "";
    const active = Number(/(\d+) active/.exec(header)?.[1]);
    const switchedOn = await panel.locator('[role="switch"][aria-checked="true"]').count();
    expect(active, "the count in the header is the number of layers switched on below").toBe(switchedOn);
    // A quick set never says only "Partial": it says how many of its layers are on.
    const lens = (await page.getByTestId("map-lens-fun").textContent()) ?? "";
    expect(lens).toMatch(/On|\d of \d on/);
  });
}

for (const size of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
  test(`Directions at ${size.width}x${size.height} lets go of the search box and its list`, async ({ page }) => {
    await openPlanner(page, size);
    await directionsTo(page);
    await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
    const focusedInput = await page.evaluate(() => document.activeElement instanceof HTMLInputElement);
    expect(focusedInput, "no search box keeps focus").toBe(false);
    await expect(page.locator('[data-testid$="-search-results"]:visible')).toHaveCount(0);
  });
}
