import { expect, test } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";

test("empty caches never claim offline-ready network capabilities", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await page.getByTestId("start-search").fill("Jim Thorpe");
  await page.getByTestId("start-search").press("Enter");
  await expect(page.getByTestId("start-value")).toContainText("Jim Thorpe, PA");
  await page.getByTestId("finish-search").fill("hawk mountain s");
  await page.getByTestId("finish-search").press("Enter");
  await expect(page.getByTestId("finish-value")).toContainText("Hawk Mountain Sanctuary, PA");
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]').first()).toBeVisible();
  // Offline readiness is a collapsed detail under the route briefing.
  await page.getByTestId("offline-toggle").click();
  await expect(page.getByTestId("offline-disclosure")).toBeVisible();
  await expect(page.getByTestId("offline-state-plan.route")).toHaveText("Needs network");
  await expect(page.getByTestId("offline-state-plan.replan")).toHaveText("Needs network");
  await expect(page.getByTestId("offline-state-nav.reroute")).toHaveText("Needs network");
  await expect(page.getByTestId("offline-state-explore.browse")).toHaveText("Needs network");
  await expect(page.getByTestId("offline-state-weather.live")).toHaveText("Needs network");
  await expect(page.getByTestId("offline-state-traffic.live")).toHaveText("Needs network");
  await expect(page.getByText("Offline ready", { exact: true })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
