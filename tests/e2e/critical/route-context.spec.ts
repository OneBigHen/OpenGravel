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
  await expect(context).toContainText("before sunrise");
  await expect(page.getByTestId("map-ask-open")).toBeVisible();
  await context.click();
  const sheet = page.getByTestId("route-conditions");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Daylight" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Weather along the route" })).toBeVisible();
  await expect(sheet).toContainText("does not include darkness before sunrise");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(context).toBeFocused();
});
