import { expect, test, type Page } from "@playwright/test";

import { clickInRideSheet, openRideSheet, RIDE_FIXTURE_DESTINATION, RIDE_FIXTURE_START, startRide } from "./ride-focus-helpers";
import { placeEndpoint, plannerMap, pressPlan, settledExtent, type Coordinate } from "./map-helpers";

/**
 * "Gate closed: one tap, and I am not sent there again" (R3-6).
 *
 * Start a ride, mark the spot from the Menu (the fixture rider is always moving,
 * so the 5 mph rail button is covered by its unit rules and by the handlebar
 * gate), end the ride, plan the same loop: the request the browser posts carries
 * an avoid box around the marked point. Removing the report in Settings makes the
 * next request carry none. The fixture router returns a canned line, so "the line
 * keeps 60 m away" is proven by the real-router case in tests/real-router.
 */
test.setTimeout(240_000);

interface Posted { readonly request: { readonly avoidPolygons: readonly (readonly Coordinate[])[] } }

function recordPlanBodies(page: Page): Posted[] {
  const bodies: Posted[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes("/api/route-plan")) return;
    try { bodies.push(request.postDataJSON() as Posted); } catch { /* not JSON */ }
  });
  return bodies;
}

async function planSameRide(page: Page): Promise<void> {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  await placeEndpoint(page, "start", RIDE_FIXTURE_START);
  await placeEndpoint(page, "finish", RIDE_FIXTURE_DESTINATION);
  await pressPlan(page);
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
}

function inside(ring: readonly Coordinate[], point: Coordinate): boolean {
  const lons = ring.map((c) => c.lon);
  const lats = ring.map((c) => c.lat);
  return point.lon > Math.min(...lons) && point.lon < Math.max(...lons) && point.lat > Math.min(...lats) && point.lat < Math.max(...lats);
}

test("Gate closed is marked once and avoided by the next plan until removed", async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  const bodies = recordPlanBodies(page);

  await startRide(page);
  const row = page.getByTestId("ride-menu-road-blocked-row");
  await openRideSheet(page);
  await expect(row).toBeEnabled({ timeout: 30_000 });
  await row.click();

  // Two glove-size choices and Cancel; no typing.
  await expect(page.getByTestId("road-blocked-gate")).toBeVisible();
  await expect(page.getByTestId("road-blocked-rough")).toBeVisible();
  await expect(page.getByTestId("road-blocked-cancel")).toBeVisible();
  await page.getByTestId("road-blocked-gate").click();
  await expect(page.getByTestId("road-blocked-toast")).toContainText("Marked. Your next routes avoid this spot.");
  await expect(page.getByTestId("road-blocked-undo")).toBeVisible();

  const stored = await page.evaluate(() => window.localStorage.getItem("og-rider-reports"));
  const reports = JSON.parse(stored ?? "[]") as { point: Coordinate; kind: string }[];
  expect(reports).toHaveLength(1);
  expect(reports[0]?.kind).toBe("gate-closed");
  const point = reports[0]!.point;

  // End the ride without saving trouble: the report outlives the ride.
  await clickInRideSheet(page, "ride-stop", "ride-stop-confirm");
  await page.getByTestId("ride-finish").click();
  await expect(page.getByTestId("ride-card")).toBeVisible({ timeout: 30_000 });

  bodies.length = 0;
  await planSameRide(page);
  const withReport = bodies[bodies.length - 1];
  expect(withReport?.request.avoidPolygons.some((ring) => inside(ring, point))).toBe(true);
  // The truth line counts it apart from official checks and never calls it closed.
  await expect(page.getByTestId("ride-truth").first()).toContainText("Avoiding 1 spot you reported.");

  // Remove it in Settings; the next plan has no avoid box.
  await page.goto("/settings");
  await expect(page.getByTestId("settings-rider-reports-title")).toHaveText("Spots you reported (1)");
  await page.getByTestId("settings-rider-report-remove").click();
  await expect(page.getByTestId("settings-rider-reports-title")).toHaveText("Spots you reported (0)");

  bodies.length = 0;
  await planSameRide(page);
  expect(bodies[bodies.length - 1]?.request.avoidPolygons ?? []).toEqual([]);
});
