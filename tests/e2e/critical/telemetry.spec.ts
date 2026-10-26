import { directionsTo } from "./search-helpers";
import { expect, test } from "@playwright/test";
import { plannerMap, pressPlan, settledExtent } from "./map-helpers";

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
  await directionsTo(page);
  await pressPlan(page);
  await expect(page.locator('[data-testid^="route-card-"]').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { planningTelemetryEvents: string[] }).planningTelemetryEvents)).toEqual(expect.arrayContaining(["route_plan_requested", "route_primary_ready"]));
});
