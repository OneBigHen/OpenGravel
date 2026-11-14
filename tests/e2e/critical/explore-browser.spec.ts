import { expect, test } from "@playwright/test";
import catalogFixture from "../../../data/catalog/e2e-fixture-routes.json";

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`browses more than ten rides, PA areas and the expanded map at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // Synthetic catalog rows exercise collection size without depending on live data.
    await page.route("**/api/catalog", async (route) => {
      const sample = catalogFixture[0]!;
      const routes = Array.from({ length: 32 }, (_, index) => ({
        ...sample, id: `browse-${index}`, name: `Browse ride ${index}`, region: "Pennsylvania",
        preview: index === 31
          ? [{ lon: -80, lat: 40.5 }, { lon: -79.9, lat: 40.6 }]
          : [{ lon: -75.5 + index * 0.001, lat: 40.6 }, { lon: -75.4, lat: 40.7 }],
      }));
      await route.fulfill({ json: { count: routes.length, routes } });
    });
    await page.goto("/explore");
    // The list draws the nearest 20 and adds the rest on request.
    await expect(page.getByRole("list", { name: "Explore routes" }).getByRole("link")).toHaveCount(20);
    await page.getByTestId("explore-show-more").click();
    await expect(page.getByRole("list", { name: "Explore routes" }).getByRole("link")).toHaveCount(32);
    await expect(page.getByTestId("explore-map")).toContainText("32 rides");
    // The area picker lives in the Filters panel at every width: a bottom sheet
    // on a phone, a popover under the chip that opened it on a wide screen. The
    // chip is the last one in the row, so it keeps search the whole width above.
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("combobox", { name: "PA riding area" }).selectOption("eastern-pa");
    await expect(page.getByRole("list", { name: "Explore routes" }).getByRole("link")).toHaveCount(20);
    await expect(page).toHaveURL(/area=eastern-pa/);
    if (viewport.width <= 760) {
      // Search owns its row on a phone: the whole width, not the ~130px it had
      // while it shared the row with the Filters button.
      const search = await page.getByRole("searchbox", { name: "Search routes" }).boundingBox();
      expect(search!.width).toBeGreaterThan(viewport.width * 0.8);
      // The sheet dims the page, and a tap on the scrim closes it. The sheet
      // rises from the bottom edge, so the part of the scrim a rider can reach
      // is the strip above it; the tap goes there, not through the sheet.
      const scrim = page.getByRole("button", { name: "Close filters" });
      await expect(scrim).toBeVisible();
      const veil = await scrim.boundingBox();
      expect(veil!.width).toBeGreaterThanOrEqual(viewport.width - 1);
      const sheet = await page.getByRole("region", { name: "Explore filters" }).boundingBox();
      // The page above the sheet stays reachable, by more than a gloved tap.
      expect(sheet!.y).toBeGreaterThan(48);
      await scrim.click({ position: { x: veil!.width / 2, y: Math.min(12, sheet!.y / 2) } });
      // A closed sheet is not rendered at all on a phone, so the chip that opens
      // it is what states it, and focus is back on that chip.
      await expect(page.getByRole("region", { name: "Explore filters" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Filters/ })).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("button", { name: /^Filters/ })).toBeFocused();
    }
    await page.reload();
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.getByRole("combobox", { name: "PA riding area" })).toHaveValue("eastern-pa");
    await page.getByRole("button", { name: /^Show \d+ routes$/ }).click();
    await page.getByRole("button", { name: "Expand map" }).click();
    const dialog = page.getByRole("dialog", { name: "Explore route map" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("planner-map")).toHaveAttribute("data-map-load", "ready");
    await expect(dialog.getByTestId("planner-map")).toHaveAttribute("data-map-painted", "true");
    await expect(dialog).toContainText("31 rides");
    await expect(page.getByTestId("planner-map")).toHaveCount(1);
    const box = await dialog.getByTestId("planner-map").boundingBox();
    expect(box!.height).toBeGreaterThan(viewport.height * 0.65);
    await dialog.getByRole("button", { name: "Fit routes" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand map" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("the Explore map panel is the map and nothing opaque is painted over it (QA-15)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/catalog", async (route) => {
    const sample = catalogFixture[0]!;
    const routes = Array.from({ length: 12 }, (_, index) => ({
      ...sample, id: `clear-${index}`, name: `Clear ride ${index}`, region: "Pennsylvania",
      preview: [{ lon: -75.5 + index * 0.001, lat: 40.6 }, { lon: -75.4, lat: 40.7 }],
    }));
    await route.fulfill({ json: { count: routes.length, routes } });
  });
  await page.goto("/explore");
  const panel = page.getByTestId("explore-map");
  await expect(panel).toContainText("12 rides");
  await panel.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("planner-map")).toHaveAttribute("data-map-load", "ready");
  await expect(page.getByTestId("planner-map")).toHaveAttribute("data-map-painted", "true");

  const report = await page.evaluate(() => {
    const map = document.querySelector('[data-testid="planner-map"]');
    const canvas = map?.querySelector("canvas.maplibregl-canvas");
    if (map === null || canvas === null || canvas === undefined) return null;
    const mapBox = map.getBoundingClientRect();
    const canvasBox = canvas.getBoundingClientRect();
    const mapArea = mapBox.width * mapBox.height;
    // The page and its wrappers paint *behind* the map: they are not a cover.
    const behind = new Set<Element>();
    for (let node: Element | null = map; node !== null; node = node.parentElement) behind.add(node);
    const allowed = (element: Element): boolean =>
      element === canvas ||
      element.classList.contains("og-map") ||
      element.classList.contains("og-map-host") ||
      element.classList.contains("og-map__attempt") ||
      // The load veil is the map's own paper and hides itself once painted.
      element.classList.contains("og-map__veil") ||
      element.classList.contains("og-map__veil-label") ||
      [...element.classList].some((name) => name.startsWith("maplibregl-"));
    /** A flat rectangle this much of the map's size is the QA-15 bug shape. */
    const COVER_SHARE = 0.3;
    const offenders: string[] = [];
    for (const element of document.querySelectorAll("*")) {
      if (behind.has(element) || allowed(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 25) continue;
      const overlapWidth = Math.min(rect.right, mapBox.right) - Math.max(rect.left, mapBox.left);
      const overlapHeight = Math.min(rect.bottom, mapBox.bottom) - Math.max(rect.top, mapBox.top);
      if (overlapWidth <= 0 || overlapHeight <= 0) continue;
      if ((overlapWidth * overlapHeight) / mapArea < COVER_SHARE) continue;
      const style = getComputedStyle(element);
      // A hidden or clear layer paints nothing, whatever colour it declares.
      if (style.visibility === "hidden" || Number(style.opacity) < 0.05 || style.display === "none") continue;
      const clear = style.backgroundColor === "rgba(0, 0, 0, 0)" && style.backgroundImage === "none";
      if (clear) continue;
      offenders.push(`${element.className || element.tagName} ${style.backgroundColor} covers ${Math.round((overlapWidth * overlapHeight * 100) / mapArea)}%`);
    }
    return {
      offenders,
      canvasCoversMap: Math.abs(canvasBox.width - mapBox.width) < 1.5 && Math.abs(canvasBox.height - mapBox.height) < 1.5,
    };
  });
  expect(report).not.toBeNull();
  expect(report!.canvasCoversMap).toBe(true);
  expect(report!.offenders).toEqual([]);
});
