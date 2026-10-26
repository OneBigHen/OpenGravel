import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expectDrawnScene, plannerMap, settledExtent } from "../critical/map-helpers";
import { useConnectedRouteFixture } from "../critical/connected-route-fixture";

for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 812 }, { width: 390, height: 844 }]) {
  for (const theme of ["day", "night"] as const) {
    test(`Wave 1B ${viewport.width}x${viewport.height} ${theme}`, async ({ browser, baseURL }) => {
      const output = join(process.cwd(), "w1b-shots");
      await mkdir(output, { recursive: true });
      const context = await browser.newContext({ baseURL, viewport, hasTouch: true, reducedMotion: "reduce",
        colorScheme: theme === "day" ? "light" : "dark", geolocation: { latitude: 40.8757, longitude: -75.7324 }, permissions: ["geolocation"] });
      const page = await context.newPage();
      await useConnectedRouteFixture(page);
      await page.goto("/");
      await expect(plannerMap(page)).toBeVisible();
      const shot = async (state: string) => {
        await settledExtent(page);
        await expect(page.getByTestId("rider-toast")).toBeHidden();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: join(output, `${viewport.width}x${viewport.height}-${theme}-${state}.png`) });
      };
      await shot("home-idle");
      await page.getByTestId("search-chip-gas").click();
      await expect(page.getByTestId("category-result")).toBeVisible();
      await shot("chip-results");
      await page.getByTestId("category-result").first().click();
      await expect(page.getByTestId("place-sheet")).toContainText("Wawa Gas");
      await shot("place-card");
      await page.getByTestId("place-directions").click();
      await expect(page.getByTestId("route-options")).toBeVisible();
      await expectDrawnScene(page, { routes: "2", points: "2" });
      await expect(page.getByTestId("start-ride")).toBeInViewport({ ratio: 1 });
      await shot("route-options");
      await page.getByTestId("route-options-settings").click();
      await expect(page.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "full");
      await expect(page.getByTestId("surface-preference")).toBeVisible();
      await shot("options-full");
      await page.unrouteAll({ behavior: "wait" });
      await context.close();
    });
  }
}
