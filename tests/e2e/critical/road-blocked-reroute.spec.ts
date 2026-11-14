import { expect, test, type Page } from "@playwright/test";

import type { RoutePlanRequestBody, RoutePlanSuccessBody } from "../../../src/application/planner/ports/route-plan-contract";
import { openRideSheet, startRide } from "./ride-focus-helpers";
import { pinAppearance } from "./rider-gate-helpers";
import { plannerMap, type Coordinate } from "./map-helpers";

/**
 * "Road blocked" while riding reroutes the ride in progress (#295).
 *
 * On a started ride, at the two smallest phone sizes and in Day and Night: the
 * report control is reachable from the ride screen, one choice marks the spot,
 * the rider is told plainly what is happening, a new route is asked for at once
 * with the spot in its avoid areas, and the screen ends with the new route on
 * the map and a plain sentence about what changed. When the router cannot help,
 * the screen says so, keeps the old line and never goes blank.
 *
 * The fixture router has one canned line, so after the report the browser answers
 * the reroute request itself (the same wire shape, a bent line from the rider to
 * where the planned line ends). "The new line really goes round the spot" is
 * proven by the ride-sim and the real-router check, not here.
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

/** After the report: answer the reroute with a bent line from the rider, or with a router error. */
async function answerRerouteWith(page: Page, answer: "a new line" | "no way"): Promise<void> {
  await page.route("**/api/route-plan", async (route) => {
    if (answer === "no way") {
      await route.fulfill({ status: 503, json: { error: { code: "router-unavailable", message: "The routing service could not plan this trip.", recoverable: true } } });
      return;
    }
    const response = await route.fetch();
    const body = await response.json() as RoutePlanSuccessBody;
    const { request } = route.request().postDataJSON() as RoutePlanRequestBody;
    const from = request.origin;
    const to = request.destination;
    const bend: Coordinate = {
      lon: (from.lon + to.lon) / 2 + (to.lat - from.lat) * 0.6,
      lat: (from.lat + to.lat) / 2 - (to.lon - from.lon) * 0.6,
    };
    const metersBetween = (a: Coordinate, b: Coordinate): number => Math.hypot((a.lon - b.lon) * 85_000, (a.lat - b.lat) * 111_000);
    const first = metersBetween(from, bend);
    const second = metersBetween(bend, to);
    await route.fulfill({ response, json: { ...body, bundle: { ...body.bundle,
      candidates: body.bundle.candidates.map((candidate, index) => ({ ...candidate,
        geometry: [from, bend, to],
        distanceMeters: first + second,
        durationSeconds: (first + second) / 12,
        instructions: [
          { text: "Head out", type: "depart", distanceMeters: first, durationSeconds: first / 12, geometryIndex: 0 },
          { text: "Turn right onto Detour Road", type: "turn", maneuver: "right", roadName: "Detour Road", distanceMeters: second, durationSeconds: second / 12, geometryIndex: 1 },
          { text: "Arrive", type: "finish", distanceMeters: 0, durationSeconds: 0, geometryIndex: 2 },
        ],
        fingerprint: `${candidate.fingerprint}:blocked:${index}`,
      })),
    } } });
  });
}

const CASES = [
  ...SIZES.flatMap((size) => (["day", "night"] as const).map((look) => ({ size, look, answer: "a new line" as const }))),
  { size: SIZES[1], look: "night" as const, answer: "no way" as const },
  { size: SIZES[0], look: "day" as const, answer: "no way" as const },
];

for (const { size, look, answer } of CASES) {
  test(`${size.width}x${size.height} ${look}: road blocked, router has ${answer}`, async ({ page }, info) => {
    await pinAppearance(page, look);
    await page.setViewportSize(size);
    const bodies: Posted[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST" || !request.url().includes("/api/route-plan")) return;
      try { bodies.push(request.postDataJSON() as Posted); } catch { /* not JSON */ }
    });

    await startRide(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", look);
    await answerRerouteWith(page, answer);
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

    const sheet = page.getByTestId("road-blocked-sheet");
    await expect(sheet).toBeVisible();
    // The two choices and Cancel sit fully on screen, above the stat bar.
    for (const id of ["road-blocked-gate", "road-blocked-rough", "road-blocked-cancel"]) {
      await expect(page.getByTestId(id)).toBeVisible();
      const choice = await page.getByTestId(id).boundingBox();
      expect(choice!.y + choice!.height).toBeLessThanOrEqual(size.height + 0.5);
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: info.outputPath(`sheet-${size.width}-${look}-${answer.replace(" ", "-")}.png`) });
    await page.getByTestId("road-blocked-gate").click();

    // Told plainly, at once.
    await expect(page.getByTestId("road-blocked-toast")).toContainText("Marked and saved. Finding a way around it.");
    await page.screenshot({ path: info.outputPath(`told-${size.width}-${look}-${answer.replace(" ", "-")}.png`) });

    // Saved as a reported spot.
    const stored = await page.evaluate(() => window.localStorage.getItem("og-rider-reports"));
    const reports = JSON.parse(stored ?? "[]") as { point: Coordinate; kind: string }[];
    expect(reports).toHaveLength(1);
    const point = reports[0]!.point;

    // A new route is asked for right away, with the spot avoided.
    await expect.poll(() => bodies.length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(bodies.every((body) => body.request.avoidPolygons.some((ring) => inside(ring, point)))).toBe(true);

    // The screen says what changed, in words, over a map that still has a route.
    if (answer === "a new line") {
      await expect(page.getByText(/Around the spot you marked · [\d.,]+ (mi|ft) to go/).first()).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText("Couldn't find a way around the spot you marked. Your route is unchanged and the spot is saved.").first()).toBeVisible({ timeout: 30_000 });
    }
    await expect(plannerMap(page)).toBeVisible();
    await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready");
    await expect(page.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: info.outputPath(`after-${size.width}-${look}-${answer.replace(" ", "-")}.png`) });
  });
}
