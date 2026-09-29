import { expect, test } from "@playwright/test";

import {
  clickMapAtCoordinate,
  expectDrawnScene,
  plannerMap,
  settledExtent,
  type Coordinate,
} from "./map-helpers";

/**
 * The desktop planning rail (04-PLANNER-AND-WORKSPACE-UX §2; 12 §10).
 *
 * The owner review of 2026-09-21 found the left rail's content clipped at the
 * viewport bottom, with the controls past the fold unreachable: the dock's grid
 * row was sized by its own content (`align-content: start`), so a rail taller
 * than the viewport grew past it and `.og-planner { overflow: hidden }` cut the
 * bottom off — and the dock's own `overflow-y: auto` never had a bounded box to
 * scroll inside.
 *
 * These are two viewport-specific claims, so both are asserted on a real browser
 * at the two sizes 16 §10 names, in the same fixture mode and on the same
 * deterministic empty basemap as the rest of the gate (see `playwright.config.ts`).
 */

/** The fixture's canned geography, exactly as `first-route.spec.ts` places it. */
const START_COORDINATE: Coordinate = { lon: -75.4385, lat: 40.1385 };
const DESTINATION_COORDINATE: Coordinate = { lon: -75.4335, lat: 40.1325 };

/**
 * Fills the rail with the content that used to overrun the viewport: two
 * authored points, a planned fixture ride (so the route choices and the sketch
 * toolbar exist), and the offline disclosure last.
 */
async function fillRail(page: import("@playwright/test").Page): Promise<void> {
  await clickMapAtCoordinate(page, START_COORDINATE);
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await page.getByTestId("compose-create").click();
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2);
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
}

/**
 * Asserts the rail never leaves the viewport, and that its last control really
 * can be reached.
 *
 * "Reachable" is the whole point of the defect, so it is not asserted from a
 * bounding box alone: the control is scrolled into view and then hit-tested with
 * `document.elementFromPoint`, which is what a pointer press on it would hit. A
 * control clipped by an ancestor (or buried under one) fails that check however
 * its own rect reads.
 */
async function expectRailReachable(page: import("@playwright/test").Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("the gate needs a viewport size");

  const dock = page.getByTestId("planner-dock");
  const dockBox = await dock.boundingBox();
  if (dockBox === null) throw new Error("the planning dock has no measured box");

  // The rail lives inside the viewport: it scrolls instead of being clipped.
  expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(dockBox.y).toBeGreaterThanOrEqual(-1);

  const controls = dock.locator("button:visible, a:visible, input:visible, select:visible");
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  const last = controls.nth(count - 1);

  await last.scrollIntoViewIfNeeded();
  expect(await last.isVisible()).toBe(true);

  const box = await last.boundingBox();
  if (box === null) throw new Error("the rail's last control has no measured box");
  expect(box.y).toBeGreaterThanOrEqual(dockBox.y - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(dockBox.y + dockBox.height + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);

  const hitTest = await last.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return hit !== null && (hit === element || element.contains(hit));
  });
  expect(hitTest, "the rail's last control must be the element under its own center").toBe(
    true,
  );

  // The dock is the thing that scrolls. Without a scroller the control is only
  // "reachable" because nothing overflowed, which would not prove the fix.
  const metrics = await dock.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(metrics.scrollHeight).toBeGreaterThanOrEqual(metrics.clientHeight);
}

test("the rail scrolls at 1440x900 and its last control is reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);

  await fillRail(page);
  await expectDrawnScene(page, { routes: "2" });
  await expectRailReachable(page);

  // Parity row 27: the ride's result sits in the inspector, a card floating over
  // the map's right side opposite the rail (map-first desktop, UX rework phase
  // 7), with the choices and Start ride on screen without scrolling anything.
  const inspector = page.getByTestId("planner-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId("route-list")).toBeVisible();
  const map = await page.getByTestId("map-host").boundingBox();
  const panel = await inspector.boundingBox();
  const rail = await page.getByTestId("planner-dock").boundingBox();
  if (map === null || panel === null || rail === null) {
    throw new Error("map, rail or inspector has no box");
  }
  expect(map.width).toBeGreaterThanOrEqual(1439);
  expect(panel.x).toBeGreaterThan(rail.x + rail.width + 200);
  expect(panel.x + panel.width).toBeLessThanOrEqual(map.x + map.width);
  const startRide = inspector.getByRole("button", { name: "Start ride" });
  await expect(startRide).toBeInViewport();
  await expect(page.getByTestId("planner-dock").getByTestId("route-list")).toHaveCount(0);
  // The page itself never scrolls: only the rail does.
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
    (page.viewportSize()?.height ?? 0) + 1,
  );
});

test("the rail scrolls at 1280x800 and its last control is reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);

  await fillRail(page);
  await expectDrawnScene(page, { routes: "2" });
  await expectRailReachable(page);
  // The page itself never scrolls: only the rail does.
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
    (page.viewportSize()?.height ?? 0) + 1,
  );
});

/**
 * Short landscape (MVP parity row 28): a phone on its side uses the same
 * side-by-side workspace, and the whole map — with the fitted route on it —
 * sits inside the viewport instead of below the fold.
 */
for (const size of [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
]) {
  test(`short landscape ${size.width}x${size.height} keeps the map and the rail on screen`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);

    await fillRail(page);
    await expectDrawnScene(page, { routes: "2" });

    const mapBox = await page.getByTestId("map-host").boundingBox();
    if (mapBox === null) throw new Error("the map host has no measured box");
    expect(mapBox.y).toBeGreaterThanOrEqual(0);
    expect(mapBox.y + mapBox.height).toBeLessThanOrEqual(size.height + 1);
    expect(mapBox.height).toBeGreaterThanOrEqual(size.height * 0.75);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(size.height + 1);

    await expectRailReachable(page);
  });
}
