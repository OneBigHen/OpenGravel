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
    await expect(page.getByRole("list", { name: "Explore routes" }).getByRole("link")).toHaveCount(32);
    await expect(page.getByTestId("explore-map")).toContainText("32 mapped");
    await page.getByRole("combobox", { name: "PA riding area" }).selectOption("eastern-pa");
    await expect(page.getByRole("list", { name: "Explore routes" }).getByRole("link")).toHaveCount(31);
    await expect(page).toHaveURL(/area=eastern-pa/);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "PA riding area" })).toHaveValue("eastern-pa");
    await page.getByRole("button", { name: "Expand map" }).click();
    const dialog = page.getByRole("dialog", { name: "Explore route map" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("planner-map")).toHaveAttribute("data-map-load", "ready");
    await expect(dialog.getByTestId("planner-map")).toHaveAttribute("data-map-painted", "true");
    await expect(dialog).toContainText("31 mapped");
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
