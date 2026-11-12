import { directionsTo } from "./search-helpers";
import { expect, test } from "@playwright/test";

import { plannerMap, pressPlan, settledExtent } from "./map-helpers";

test("empty caches never claim offline-ready network capabilities", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await directionsTo(page);
  await pressPlan(page);
  await expect(page.locator('[data-testid^="route-card-"]').first()).toBeVisible();
  // No downloaded area on this device and no area offered by the server: the
  // sheet promises nothing and has no row leading to an empty Settings section.
  await expect(page.getByTestId("offline-save-area")).toHaveCount(0);
  await expect(page.getByText("Save this area for offline")).toHaveCount(0);
  await expect(page.getByText(/online only/)).toHaveCount(0);
  await expect(page.getByText("Offline ready", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Offline readiness", { exact: true })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
