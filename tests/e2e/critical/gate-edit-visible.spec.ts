import { expect, test } from "@playwright/test";

import { fractionOf, plannerMap, readCoordinate, readExtent, settledExtent } from "./map-helpers";
import { PHONE_SIZES } from "./rider-gate-helpers";
import { directionsTo, searchPlace } from "./search-helpers";

/**
 * GATE-EDIT-VISIBLE (#324; behind QA-06).
 *
 * Tapping Edit opens the stops list over the map. The ride being edited must still be on the part of
 * the map the sheet does not cover, and the "N stops" the summary claims must be the number of stops
 * actually listed. Measured with one stop added, so a count of zero cannot pass by accident.
 */
test.describe.configure({ timeout: 150_000 });

for (const size of PHONE_SIZES) {
  test(`Edit keeps the route on the visible map and counts its stops honestly (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);
    await directionsTo(page);
    await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });

    // Add one stop from a place card.
    await searchPlace(page, "Mountain Coffee");
    await page.getByTestId("place-sheet").getByRole("button", { name: "Add stop", exact: true }).click();
    await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });

    await page.getByTestId("trip-edit").click();
    await expect(page.getByRole("heading", { name: "Edit ride" })).toBeVisible();
    const list = page.getByTestId("stops-list");
    await expect(list).toBeVisible();

    // The count the summary states is the number of stops listed (start and finish are rows too).
    const summary = (await page.locator(".og-refine__summary").first().textContent()) ?? "";
    const claimed = /(\d+) stops?/.exec(summary);
    const listed = (await list.locator("> li").count()) - 2;
    expect(listed, "one stop was added, so one is listed").toBe(1);
    expect(claimed === null ? 0 : Number(claimed[1]), `the summary says "${summary}"`).toBe(listed);

    // The route's ends are inside the map the sheet leaves uncovered.
    await expect(async () => {
      const map = await plannerMap(page).boundingBox();
      const sheet = await page.getByTestId("planner-sheet").boundingBox();
      if (map === null || sheet === null) throw new Error("no map or sheet box");
      const extent = await readExtent(page);
      const visibleBottom = Math.min(map.y + map.height, sheet.y);
      expect(visibleBottom - map.y, "the sheet leaves a map to look at").toBeGreaterThan(size.height * 0.3);
      for (const id of ["start-value", "finish-value"]) {
        const at = fractionOf(extent, await readCoordinate(page, id));
        const x = map.x + at.x * map.width;
        const y = map.y + at.y * map.height;
        expect(x, `${id} x on screen`).toBeGreaterThan(map.x);
        expect(x, `${id} x on screen`).toBeLessThan(map.x + map.width);
        expect(y, `${id} below the map top`).toBeGreaterThan(map.y);
        expect(y, `${id} above the sheet`).toBeLessThan(visibleBottom);
      }
    }).toPass({ timeout: 20_000 });
  });
}
