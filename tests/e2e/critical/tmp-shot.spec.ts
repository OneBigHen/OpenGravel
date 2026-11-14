import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { plannerMap } from "./map-helpers";
const PACK = join(tmpdir(), "og-route-library-e2e", "pack.sqlite");
const FIXTURE = join(process.cwd(), "tests/fixtures/route-library/pack.sqlite");
test.beforeAll(() => { mkdirSync(dirname(PACK), { recursive: true }); copyFileSync(FIXTURE, PACK); });
test.afterAll(() => { rmSync(dirname(PACK), { recursive: true, force: true }); });
for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`shot ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/explore?view=map");
    await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready");
    await expect(page.locator('.og-routes__bubble[data-kind="state"]').first()).toBeVisible();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `test-results/explore-map-${size.width}.png` });
    await page.goto("/explore?view=list");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `test-results/explore-list-${size.width}.png` });
  });
}
