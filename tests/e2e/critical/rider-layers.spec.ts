import { expect, test, type Page } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";

/**
 * LAYERS-HALF (#282) and LAYERS-RIDER (#283), as a rider sees them.
 *
 * The Layers sheet opens at half height with the map above it, stays open while
 * layers are switched, and lists the layers that stop a ride: gates, water
 * crossings, private roads, rough tracks and the USGS topo map. Each row is whole
 * (inside the screen, not cut off, not under another control, readable).
 */

const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;
const NEW_LAYERS = ["gates", "fords", "private-roads", "rough-tracks", "usgs-topo"] as const;

test.describe.configure({ timeout: 120_000 });

async function openLayers(page: Page, size: { width: number; height: number }, theme: "day" | "night"): Promise<void> {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: theme === "night" ? "dark" : "light" });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await page.getByTestId("map-layers-toggle").click();
  await expect(page.getByRole("region", { name: "Map layers" })).toBeVisible();
}

/** WCAG contrast of an element's text on the first opaque background behind it. */
async function contrastOf(page: Page, testId: string, selector: string): Promise<number> {
  return page.getByTestId(testId).locator(selector).first().evaluate((el) => {
    const parse = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]): number => {
      const f = (v: number): number => { const c = (v ?? 0) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    let bg: number[] = [255, 255, 255];
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.length >= 3 && (c.length === 3 || (c[3] ?? 1) > 0.95)) { bg = c; break; }
    }
    const fg = parse(getComputedStyle(el).color);
    const [a, b] = [lum(fg), lum(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

for (const size of SIZES) {
  for (const theme of ["day", "night"] as const) {
    const label = `${size.width}x${size.height} ${theme}`;

    test(`LAYERS-HALF ${label}: the sheet opens at half height and the map stays visible while layers are switched`, async ({ page }, info) => {
      await openLayers(page, size, theme);
      const panel = page.getByRole("region", { name: "Map layers" });
      await page.screenshot({ path: info.outputPath(`layers-half-${label.replace(" ", "-")}.png`) });
      const box = (await panel.boundingBox())!;
      expect(box.y / size.height, "the sheet top is at or below the middle of the screen").toBeGreaterThanOrEqual(0.5 - 0.01);
      expect(box.y + box.height, "inside the screen").toBeLessThanOrEqual(size.height + 1);

      // Switch a layer on: the sheet stays open and the map above is still the thing under the finger.
      await page.getByTestId("map-lens-fun").click();
      await expect(panel).toBeVisible();
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid") ?? "", { x: size.width / 2, y: size.height * 0.3 });
      expect(hit, "the top third of the screen is still the map").not.toMatch(/layers|sheet|panel/);
    });

    test(`LAYERS-RIDER ${label}: the ride-stopper layers are listed whole, readable and switch on`, async ({ page }, info) => {
      const topo: string[] = [];
      await page.route("https://basemap.nationalmap.gov/**", async (route) => {
        topo.push(route.request().url());
        await route.fulfill({ status: 204 });
      });
      await page.route("**/api/map-layers?*", (route) => route.fulfill({ json: { features: [], unavailable: [] } }));
      await openLayers(page, size, theme);
      const panel = page.getByRole("region", { name: "Map layers" });
      await page.getByTestId("map-layer-gates").scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`layers-rows-${label.replace(" ", "-")}.png`) });
      for (const id of NEW_LAYERS) {
        const row = page.getByTestId(`map-layer-${id}`);
        await row.scrollIntoViewIfNeeded();
        await expect(row, `${id} is listed`).toBeVisible();
        const rowBox = (await row.boundingBox())!;
        const panelBox = (await panel.boundingBox())!;
        expect(rowBox.x, `${id} left`).toBeGreaterThanOrEqual(0);
        expect(rowBox.x + rowBox.width, `${id} right`).toBeLessThanOrEqual(size.width);
        expect(rowBox.y + rowBox.height, `${id} inside the sheet`).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
        const name = row.locator(".og-layers__name");
        expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${id} name is not cut off`).toBe(true);
        const centre = { x: rowBox.x + rowBox.width / 2, y: rowBox.y + rowBox.height / 2 };
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid"), centre), `${id} is not under another control`).toBe(`map-layer-${id}`);
        expect(await contrastOf(page, `map-layer-${id}`, ".og-layers__name"), `${id} name contrast`).toBeGreaterThanOrEqual(4.5);
      }

      for (const id of NEW_LAYERS) {
        const row = page.getByTestId(`map-layer-${id}`);
        await row.scrollIntoViewIfNeeded();
        await row.click();
        await expect(row).toHaveAttribute("aria-checked", "true");
      }
      await expect(panel, "the sheet stays open").toBeVisible();
      await page.screenshot({ path: info.outputPath(`layers-rider-${label.replace(" ", "-")}.png`) });
      // The topo map really asks USGS for tiles.
      await expect.poll(() => topo.length, { timeout: 20_000 }).toBeGreaterThan(0);
      expect(topo[0]).toContain("USGSTopo");
    });
  }
}
