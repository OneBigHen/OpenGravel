import { expect, test, type Page } from "@playwright/test";

import { fractionOf, placeEndpoint, plannerMap, settledExtent, type Coordinate } from "./map-helpers";
import { contrast, faintText, pinAppearance, sharedLinePoint } from "./rider-gate-helpers";

/**
 * GATE-DAY-NIGHT (#325; behind QA-05).
 *
 * Day and Night are both readable. For each look, on a planned ride with the Layers panel open:
 *  - every piece of chrome text that sits on a solid background clears 4.5:1;
 *  - the route line, sampled from the pixels the rider actually sees, clears 3:1 against the map around it.
 *
 * Limit, stated plainly: the gate's fixture basemap has no glyph URL, so the map host draws no place or
 * event label text there. The label-pill colours themselves (QA-05's "black box with no text") are guarded
 * by tests/integration/maplibre-host.test.ts and tests/unit/infrastructure/maplibre/style-places.test.ts,
 * which read the pixels the host hands MapLibre. A label-pixel and pin-over-location-dot gate needs a
 * basemap with fonts and is filed as a follow-up.
 */
test.describe.configure({ timeout: 120_000 });

const START: Coordinate = { lon: -75.44, lat: 40.14 };
const FINISH: Coordinate = { lon: -75.4328, lat: 40.131 };

/** The pixel colours of the map element, as seen by the rider. */
async function lineVersusMap(page: Page, point: Coordinate): Promise<{ line: number[]; ground: number[]; ratio: number }> {
  const map = plannerMap(page);
  const box = await map.boundingBox();
  if (box === null) throw new Error("no map box");
  const at = fractionOf(await settledExtent(page), point);
  const png = (await map.screenshot()).toString("base64");
  return map.evaluate(
    async (_el, input) => {
      const image = new Image();
      image.src = `data:image/png;base64,${input.png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const scale = image.width / input.width;
      const pixel = (x: number, y: number): number[] => [...context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data.slice(0, 3)];
      // Ground: the most common colour on a sparse grid of the whole map.
      const counts = new Map<string, number>();
      for (let y = 4; y < input.height; y += 14) for (let x = 4; x < input.width; x += 14) {
        const key = pixel(x, y).join(",");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const ground = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0].split(",").map(Number);
      const lum = (c: number[]): number => {
        const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a: number[], b: number[]): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      // Line: the pixel within a few px of the route point that differs most from the ground.
      let line = ground;
      let best = 0;
      const cx = input.x;
      const cy = input.y;
      for (let dy = -7; dy <= 7; dy += 1) for (let dx = -7; dx <= 7; dx += 1) {
        const c = pixel(cx + dx, cy + dy);
        const r = ratio(c, ground);
        if (r > best) { best = r; line = c; }
      }
      return { line, ground, ratio: best };
    },
    { png, width: box.width, height: box.height, x: at.x * box.width, y: at.y * box.height },
  );
}

for (const look of ["day", "night"] as const) {
  test(`${look}: chrome text is readable and the route line stands out from the map`, async ({ page }) => {
    await pinAppearance(page, look);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", look);
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);
    await placeEndpoint(page, "start", START);
    await placeEndpoint(page, "finish", FINISH);
    await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 60_000 });
    await page.waitForTimeout(1_500);

    // The route line against the map, as pixels.
    const shot = await lineVersusMap(page, sharedLinePoint());
    expect(shot.ratio, `${look}: route line ${shot.line} on ground ${shot.ground}`).toBeGreaterThanOrEqual(3);
    expect(contrast(shot.line, shot.ground)).toBeGreaterThanOrEqual(3);

    // Text on the planner chrome.
    expect(await faintText(page), `${look}: faint text on the plan`).toEqual([]);

    // And with the Layers panel open.
    await page.getByTestId("map-layers-toggle").click();
    await expect(page.getByRole("region", { name: "Map layers" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await faintText(page), `${look}: faint text in Layers`).toEqual([]);
  });

  test(`${look}: Explore text is readable`, async ({ page }) => {
    await pinAppearance(page, look);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/explore");
    await expect(page.locator("html")).toHaveAttribute("data-theme", look);
    await expect(page.getByRole("list", { name: "Explore routes" })).toBeVisible();
    await page.waitForTimeout(800);
    expect(await faintText(page), `${look}: faint text in Explore`).toEqual([]);
  });
}
