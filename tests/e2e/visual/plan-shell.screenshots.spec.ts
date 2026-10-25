import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { plannerMap, settledExtent, pressPlan } from "../critical/map-helpers";

// Run after npm run build:
// OGV_RATE_LIMIT_UNLIMITED=1 npx playwright test tests/e2e/visual/plan-shell.screenshots.spec.ts --project=critical-chromium
const output = join(homedir(), "sol/shots/plan-shell");
for (const viewport of [{ width: 320, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 }]) {
  for (const theme of ["day", "night"] as const) {
    test(`${viewport.width}x${viewport.height} ${theme}`, async ({ browser }) => {
      test.setTimeout(90_000);
      await mkdir(output, { recursive: true });
      const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion: "reduce", colorScheme: theme === "day" ? "light" : "dark" });
      const page = await context.newPage();
      const base = test.info().project.use.baseURL ?? "http://127.0.0.1:3210";
      await page.goto(base);
      await expect(plannerMap(page)).toBeVisible();
      await settledExtent(page);
      await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "peek");
      const shot = async (state: string) => {
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: join(output, `${viewport.width}x${viewport.height}-${theme}-${state}.png`) });
      };
      const mapSpace = async () => {
        const box = await page.getByTestId("planner-sheet").boundingBox();
        expect(box!.y / viewport.height).toBeGreaterThanOrEqual(0.60);
      };
      await mapSpace();
      await shot("no-ride");
      await page.getByTestId("sheet-handle").click();
      await page.getByTestId("start-search").fill("Jim Thorpe");
      await page.getByTestId("start-search-results").getByTestId("place-option").click();
      await page.getByTestId("finish-search").fill("Hawk Mountain Sanctuary");
      await page.getByTestId("finish-search-results").getByTestId("place-option").click();
      await pressPlan(page);
      await expect(page.getByTestId("phone-ride-summary")).toBeVisible();
      await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "peek");
      await expect(page.getByTestId("start-ride")).toBeInViewport({ ratio: 1 });
      await mapSpace();
      await shot("ride-peek");
      // Mouse input catches the original bug too: both mouse and touch must drag.
      const handle = page.getByTestId("sheet-handle");
      const grip = await handle.boundingBox();
      const before = await page.getByTestId("planner-sheet").boundingBox();
      await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + 32);
      await page.mouse.down();
      await page.mouse.move(grip!.x + grip!.width / 2, grip!.y - 60, { steps: 8 });
      const during = await page.getByTestId("planner-sheet").boundingBox();
      expect(during!.height).toBeGreaterThan(before!.height + 40);
      await page.mouse.up();
      await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "half");
      await shot("half");
      await handle.press("ArrowUp");
      await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "full");
      await shot("full");
      await handle.click();
      await page.getByTestId("map-layers-toggle").click();
      await expect(page.getByRole("region", { name: "Map layers" })).toBeVisible();
      await shot("layers");
      await context.close();
    });
  }
}
