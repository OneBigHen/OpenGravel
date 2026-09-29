import { expect, test } from "@playwright/test";

test("shows the honest long-trip checklist for a long fixture", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/test-fixtures/long-trip");
  await expect(page.getByText("Synthetic fixture — not a world claim.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Long-trip considerations" })).toBeVisible();
  await expect(page.getByTestId("long-trip-consideration-fuel")).toContainText("Plan a fuel stop before the range gap.");
  await expect(page.getByTestId("long-trip-consideration-daylight")).toContainText("after sunset");
  await expect(page.getByTestId("long-trip-consideration-weather")).toContainText("70% precipitation chance");
  await expect(page.getByTestId("long-trip-consideration-lodging")).toContainText("unknown");
  await expect(page.getByTestId("long-trip-consideration-service")).toContainText("53 mi gap reported");
  expect(consoleErrors).toEqual([]);
});

test("shows no long-trip checklist for a short fixture", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/test-fixtures/short-trip");
  await expect(page.getByRole("heading", { name: "Short-trip fixture" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Long-trip considerations" })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
