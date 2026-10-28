import { expect, test } from "@playwright/test";
import { directionsTo } from "./search-helpers";
import { plannerMap, settledExtent } from "./map-helpers";

test("route context opens conditions and keeps Ask reachable", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.clock.setFixedTime(new Date("2026-10-28T08:00:00Z"));
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await directionsTo(page);
  const context = page.getByTestId("route-context");
  await expect(context).toContainText(/mi.*arrive/);
  await expect(context).toHaveAttribute("aria-label", /before sunrise/);
  const ask = page.getByTestId("map-ask-open");
  await expect(ask).toBeVisible();
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 852 });
    const dimensions = await context.evaluate((element) => {
      const text = element.querySelector("span")!;
      return { height: element.getBoundingClientRect().height, font: parseFloat(getComputedStyle(element).fontSize), textHeight: text.getBoundingClientRect().height, overflow: text.scrollWidth > text.clientWidth };
    });
    expect(dimensions.height).toBeGreaterThanOrEqual(44);
    expect(dimensions.font).toBeGreaterThanOrEqual(14);
    expect(dimensions.overflow).toBe(false);
    expect(dimensions.textHeight).toBeLessThanOrEqual(24);
    expect((await ask.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await context.click();
  const sheet = page.getByTestId("route-conditions");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Daylight" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Weather along the route" })).toBeVisible();
  await expect(sheet).toContainText("In the dark the whole way");
  await expect(sheet).toContainText("Sunrise");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(context).toBeFocused();
});
