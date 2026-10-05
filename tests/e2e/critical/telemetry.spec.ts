import { expect, test } from "@playwright/test";
import { plannerMap, settledExtent } from "./map-helpers";

test("the production planner emits typed planning outcomes from its own store", async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await page.evaluate(() => {
    const target = window as unknown as { planningTelemetryEvents: string[] };
    target.planningTelemetryEvents = [];
    window.addEventListener("opengravel:telemetry-intent", event => {
      target.planningTelemetryEvents.push((event as CustomEvent<{ name: string }>).detail.name);
    });
  });
  await page.getByTestId("start-search").fill("Jim Thorpe");
  await page.getByTestId("start-search").press("Enter");
  await expect(page.getByTestId("start-value")).toContainText("Jim Thorpe, PA");
  await page.getByTestId("finish-search").fill("hawk mountain s");
  await page.getByTestId("finish-search").press("Enter");
  await expect(page.getByTestId("finish-value")).toContainText("Hawk Mountain Sanctuary, PA");
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { planningTelemetryEvents: string[] }).planningTelemetryEvents)).toEqual(expect.arrayContaining(["route_plan_requested", "route_primary_ready"]));
});
