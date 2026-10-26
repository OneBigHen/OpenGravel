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
  // No downloaded area on this device: the sheet offers one plain row to save
  // one, and never claims a capability is ready or calls the phone online-only
  // in a status line.
  const saveArea = page.getByTestId("offline-save-area");
  await expect(saveArea).toBeVisible();
  await expect(saveArea).toContainText("Save this area for offline");
  await expect(page.getByText(/online only/)).toHaveCount(0);
  await expect(page.getByText("Offline ready", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Offline readiness", { exact: true })).toHaveCount(0);
  // The row leads to the download itself, which lives in Settings.
  await saveArea.click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole("heading", { name: "Offline areas" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
