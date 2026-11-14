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
  await page.waitForTimeout(3000);
  for (let i = 0; i < 5; i++) {
    console.log("DBG", await page.evaluate(() => Array.from(document.querySelectorAll(".og-routes__bubble")).map((b) => `${b.getAttribute("aria-label")}@${Math.round(b.getBoundingClientRect().left)},${Math.round(b.getBoundingClientRect().top)}`).join(" | ")));
    await page.waitForTimeout(500);
  }
});
