import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "@playwright/test";

import { plannerMap } from "./map-helpers";

/**
 * EXPLORE-FRAMING (#285): the country view on a phone opens framed on the rides,
 * not a thin band of bubbles in the middle of an empty screen. Every state
 * bubble is whole and tappable (nothing covers it), and together the bubbles
 * use most of the width of the phone.
 */
const PACK = join(tmpdir(), "og-route-library-e2e", "pack.sqlite");
const FIXTURE = join(process.cwd(), "tests/fixtures/route-library/pack.sqlite");

test.beforeAll(() => {
  mkdirSync(dirname(PACK), { recursive: true });
  copyFileSync(FIXTURE, PACK);
});
test.afterAll(() => {
  rmSync(dirname(PACK), { recursive: true, force: true });
});

const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the country view is framed on the rides and every bubble is whole and tappable`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await page.goto("/explore?view=map");
    await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready");
    const bubbles = page.locator('.og-routes__bubble[data-kind="state"]');
    await expect(bubbles.first()).toBeVisible();
    await page.waitForTimeout(2500);

    const boxes = await bubbles.evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { x: box.left, y: box.top, right: box.right, bottom: box.bottom, covered: top !== node && !node.contains(top) };
    }));
    expect(boxes.length).toBeGreaterThan(3);
    await page.screenshot({ path: info.outputPath(`explore-country-${size.width}.png`) });

    for (const [index, box] of boxes.entries()) {
      expect(box.x, `bubble ${index} left edge on screen`).toBeGreaterThanOrEqual(0);
      expect(box.right, `bubble ${index} right edge on screen`).toBeLessThanOrEqual(size.width);
      expect(box.y, `bubble ${index} top on screen`).toBeGreaterThanOrEqual(0);
      expect(box.bottom, `bubble ${index} above the tab bar`).toBeLessThanOrEqual(size.height - 60);
      expect(box.covered, `bubble ${index} is not under a control`).toBe(false);
    }
    const spread = Math.max(...boxes.map((box) => box.right)) - Math.min(...boxes.map((box) => box.x));
    expect(spread / size.width, "the rides use most of the phone's width").toBeGreaterThanOrEqual(0.85);
  });
}
