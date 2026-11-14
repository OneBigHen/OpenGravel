import { expect, test } from "@playwright/test";

import { openRideSheet, startRide } from "./ride-focus-helpers";
import { pinAppearance } from "./rider-gate-helpers";
import { plannerMap, type Coordinate } from "./map-helpers";

/**
 * "Road blocked" while riding reroutes the ride in progress (#295).
 *
 * On a started ride, at the two smallest phone sizes and in Day and Night: the
 * report control is reachable from the ride screen, one choice marks the spot,
 * the rider is told plainly what is happening, a new route is asked for at once
 * with the spot in its avoid areas, and the screen ends up with a route on the
 * map and a plain sentence about what changed (or, if the router cannot help,
 * a plain sentence saying the old route stays). Never a blank map.
 *
 * The fixture router answers with a canned line, so "the new line really goes
 * round the spot" is proven by the ride-sim and the real-router check.
 */
test.setTimeout(240_000);

const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

interface Posted { readonly request: { readonly avoidPolygons: readonly (readonly Coordinate[])[] } }

function inside(ring: readonly Coordinate[], point: Coordinate): boolean {
  const lons = ring.map((c) => c.lon);
  const lats = ring.map((c) => c.lat);
  return point.lon > Math.min(...lons) && point.lon < Math.max(...lons) && point.lat > Math.min(...lats) && point.lat < Math.max(...lats);
}

for (const size of SIZES) {
  for (const look of ["day", "night"] as const) {
    test(`${size.width}x${size.height} ${look}: road blocked reroutes the ride in progress`, async ({ page }, info) => {
      await pinAppearance(page, look);
      await page.setViewportSize(size);
      const bodies: Posted[] = [];
      page.on("request", (request) => {
        if (request.method() !== "POST" || !request.url().includes("/api/route-plan")) return;
        try { bodies.push(request.postDataJSON() as Posted); } catch { /* not JSON */ }
      });

      await startRide(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", look);
      bodies.length = 0;

      // Reachable while riding: the Menu row is on screen, enabled and glove-sized.
      const row = page.getByTestId("ride-menu-road-blocked-row");
      await openRideSheet(page);
      await expect(row).toBeEnabled({ timeout: 30_000 });
      const box = await row.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 0.5);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 0.5);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await row.click();

      await expect(page.getByTestId("road-blocked-sheet")).toBeVisible();
      await page.screenshot({ path: info.outputPath(`sheet-${size.width}-${look}.png`) });
      await page.getByTestId("road-blocked-gate").click();

      // Told plainly, at once.
      const toast = page.getByTestId("road-blocked-toast");
      await expect(toast).toContainText("Marked and saved. Finding a way around it.");

      // Saved as a reported spot.
      const stored = await page.evaluate(() => window.localStorage.getItem("og-rider-reports"));
      const reports = JSON.parse(stored ?? "[]") as { point: Coordinate; kind: string }[];
      expect(reports).toHaveLength(1);
      const point = reports[0]!.point;

      // A new route is asked for right away, with the spot avoided.
      await expect.poll(() => bodies.length, { timeout: 30_000 }).toBeGreaterThan(0);
      expect(bodies.every((body) => body.request.avoidPolygons.some((ring) => inside(ring, point)))).toBe(true);

      // The screen says what changed, in words; a map is on screen under it.
      const said = page.getByTestId("ride-card-note").or(page.getByTestId("ride-toast")).or(toast);
      await expect(page.getByText(/Around the spot you marked|Couldn't find a way around the spot you marked/).first()).toBeVisible({ timeout: 30_000 });
      await expect(said.first()).toBeVisible();
      await expect(plannerMap(page)).toBeVisible();
      await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready");
      await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
      await page.screenshot({ path: info.outputPath(`after-${size.width}-${look}.png`), fullPage: false });
    });
  }
}
