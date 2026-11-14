import { copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "@playwright/test";
const PACK = join(tmpdir(), "og-route-library-e2e", "pack.sqlite");
test.use({ viewport: { width: 390, height: 844 } });
test("dbg", async ({ page }) => {
  mkdirSync(dirname(PACK), { recursive: true });
  copyFileSync(join(process.cwd(), "tests/fixtures/route-library/pack.sqlite"), PACK);
  await page.goto("/explore?view=map");
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(400);
    console.log(await page.evaluate(() => { const m = document.querySelector("[data-testid=routes-map]"); return `${m?.getAttribute("data-zoom")} b=${m?.getAttribute("data-bubbles")} url=${location.search}`; }));
  }
});
