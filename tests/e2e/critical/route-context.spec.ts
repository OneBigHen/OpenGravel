import { expect, test } from "@playwright/test";
import { directionsTo } from "./search-helpers";
import { plannerMap, settledExtent } from "./map-helpers";

test("daylight chip in the sheet opens conditions; Ask lives in Options", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.clock.setFixedTime(new Date("2026-10-28T08:00:00Z"));
  // Ask is off on the front door until Settings turns it on (front-door.spec.ts
  // drives that switch); this spec is about the Ask control itself.
  await page.addInitScript(() => localStorage.setItem("og-front-door-ask", "on"));
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await directionsTo(page);
  // PF-3: no stats pill on the map; the daylight fact is a chip in the sheet.
  await expect(page.getByTestId("route-context-row")).toHaveCount(0);
  const context = page.getByTestId("route-context");
  await expect(context).toBeVisible();
  await expect(context).toContainText(/before sunrise/);
  await expect(context).toHaveAttribute("aria-label", /(Arrive|Back) \d.*before sunrise/);
  // The chip is inside the sheet, not over the map.
  const sheetBox = (await page.getByTestId("start-ride").boundingBox())!;
  expect((await context.boundingBox())!.y).toBeGreaterThan(sheetBox.y - 400);
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
  // Ask moved into the Options view.
  await expect(page.getByTestId("map-ask-open")).toHaveCount(0);
  await page.getByTestId("sheet-handle").click();
  await page.getByTestId("route-options-settings").click();
  const ask = page.getByTestId("map-ask-open");
  await expect(ask).toBeVisible();
  expect((await ask.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
