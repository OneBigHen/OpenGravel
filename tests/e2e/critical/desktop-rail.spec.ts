import { expect, test } from "@playwright/test";

import {
  placeEndpointAtFraction,
  expectDrawnScene,
  plannerMap,
  settledExtent,
  pressPlan,
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

/**
 * Fills the rail with the content that used to overrun the viewport: two
 * authored points, a planned fixture ride (so the route choices and the sketch
 * toolbar exist), and the offline disclosure last.
 *
 * The points are placed by fraction of the visible map, below the top search and
 * clear of the rail: short landscape shows the search and its category chips
 * across the top, and a press aimed by geography can land under a chip instead
 * of on the map. These two points only need to author a ride; the fixture answer
 * is the route under test.
 */
async function fillRail(page: import("@playwright/test").Page): Promise<void> {
  // Destination first: the map's "Directions to here" menu action is the one
  // path every tier offers without the sheet's destination chip, and the start
  // placed afterwards keeps the destination. A start first would be cleared by
  // that action when no current-location fix is available (the gate has none).
  await placeEndpointAtFraction(page, "finish", { x: 0.6, y: 0.58 });
  await placeEndpointAtFraction(page, "start", { x: 0.4, y: 0.52 });
  await pressPlan(page);
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

/**
 * Next round N4: the laptop loop panel is one tidy column. The ride-time chips
 * wrap in at most two rows under their own label (they used to stack into a
 * staircase beside it), the plan button stays live and green in Loop mode
 * before and after a loop exists, the Best Ride card leads the list, and Start
 * ride is fully inside the result panel.
 */
test("the loop panel is one tidy column with a live green button at 1440x900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);

  await placeEndpointAtFraction(page, "start", { x: 0.5, y: 0.55 });
  await page.getByTestId("ride-shape-loop").check();
  const chips = page.getByTestId("loop-time").locator(".og-style__chip");
  await expect(chips.first()).toBeVisible();

  const label = await page.locator(".og-composer__row--loop > .og-composer__label").boundingBox();
  if (label === null) throw new Error("the ride-time label has no box");
  const tops = new Set<number>();
  for (const box of await chips.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: rect.bottom };
  }))) {
    tops.add(box.top);
    // No chip sits on the label's own line.
    expect(box.top).toBeGreaterThanOrEqual(label.y + label.height - 1);
  }
  expect(tops.size, "loop-time chips wrap in at most two rows").toBeLessThanOrEqual(2);

  const plan = page.getByTestId("compose-create");
  const primaryFill = async (): Promise<boolean> => plan.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.background = "var(--og-primary)";
    document.body.append(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(element).backgroundColor === want;
  });
  await expect(plan).toHaveText("Make my loop");
  await expect(plan).toBeEnabled();
  expect(await primaryFill(), "Make my loop is filled with the primary colour").toBe(true);

  await pressPlan(page);
  await expect(page.locator('[data-testid^="route-card-"]').first()).toBeVisible();
  await expect(page.getByTestId("status-line")).toHaveText("Ride ready.");
  await expect(plan).toHaveText("Try another loop");
  await expect(plan).toBeEnabled();
  expect(await primaryFill(), "Try another loop stays primary after a loop exists").toBe(true);

  const inspector = page.getByTestId("planner-inspector");
  await expect(inspector.locator('[data-testid^="route-card-"]').first()).toContainText(/Best Ride/i);

  const startRide = inspector.getByRole("button", { name: "Start ride" });
  const panelBox = await inspector.evaluate((element) => {
    const scroller = element.closest(".og-planner__inspector") ?? element;
    const rect = scroller.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  const startBox = await startRide.boundingBox();
  if (startBox === null) throw new Error("Start ride has no box");
  expect(startBox.y).toBeGreaterThanOrEqual(panelBox.top - 1);
  expect(startBox.y + startBox.height).toBeLessThanOrEqual(panelBox.bottom + 1);
});
