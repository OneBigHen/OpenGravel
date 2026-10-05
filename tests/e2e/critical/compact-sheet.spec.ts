import { expect, test } from "@playwright/test";

import {
  clickMapAtCoordinate,
  expectDrawnScene,
  expectHealthyMap,
  plannerMap,
  settledExtent,
} from "./map-helpers";

/**
 * The compact composition (04-PLANNER-AND-WORKSPACE-UX §2, 12 §4/§10/§13;
 * owner review 2026-09-17).
 *
 * The first preview was reviewed on a phone, so the compact tier needs evidence
 * that is not a screenshot somebody has to squint at: the map covers the viewport,
 * the composer is a real bottom sheet with **two visible heights** (peek, and
 * expanded with the ride choices scrolling inside it), the status line lives
 * *inside* that sheet rather than floating over the map, every control keeps a
 * 44px hit area, and the two typefaces actually arrive in the browser rather than
 * being requested in a stylesheet nobody loads.
 *
 * It runs in the same fixture mode and against the same production build as
 * `first-route.spec.ts` (see `playwright.config.ts`) and in the deterministic
 * empty basemap, so it never depends on a tile server.
 */

/** 12 §12's phone tier: 390×844 (the target the owner reviewed on). */
const PHONE = { width: 390, height: 844 };

/**
 * The fixture's own area (see `first-route.spec.ts`), which is where this spec
 * places its ride: a fixture answer does not follow the rider's points, so taps
 * inside the canned geometry are what make the committed route the thing the
 * camera frames — and the route list the thing the sheet reveals.
 */
const START_COORDINATE = { lon: -75.4385, lat: 40.1385 };
const DESTINATION_COORDINATE = { lon: -75.4335, lat: 40.1325 };

test.use({ viewport: PHONE });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
});

test("the map fills the viewport and the composer is a bottom sheet", async ({
  page,
}) => {
  const mapBox = await page.getByTestId("map-host").boundingBox();
  expect(mapBox).not.toBeNull();
  if (mapBox === null) throw new Error("the map host has no measured box");
  expect(mapBox.width).toBeGreaterThanOrEqual(PHONE.width - 1);
  expect(mapBox.height).toBeGreaterThanOrEqual(PHONE.height - 1);

  const dock = page.getByTestId("planner-dock");
  const sheet = page.getByTestId("planner-sheet");
  expect(await dock.evaluate((element) => getComputedStyle(element).position)).toBe(
    "fixed",
  );

  const sheetBox = await sheet.boundingBox();
  const statusBox = await page.getByTestId("status-line").boundingBox();
  expect(sheetBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  if (sheetBox === null || statusBox === null) {
    throw new Error("the sheet and its status line must both be measurable");
  }

  // The tab bar is a glass capsule floating just above the bottom edge (OW-03;
  // Trail Glass: 8px with no safe-area inset), inset from the sides, and the
  // sheet is a card resting 6px above it. The status line is *inside* the sheet
  // — the defect the owner review flagged was a status chip floating over the
  // map. On the idle sheet it is announced but not drawn (Trail Glass).
  const tabBar = await page.getByTestId("primary-nav").boundingBox();
  if (tabBar === null) throw new Error("the tab bar has no measured box");
  const barGap = PHONE.height - (tabBar.y + tabBar.height);
  expect(barGap).toBeGreaterThanOrEqual(7);
  expect(barGap).toBeLessThanOrEqual(9);
  expect(tabBar.x).toBeGreaterThanOrEqual(9);
  expect(Math.abs(tabBar.y - (sheetBox.y + sheetBox.height) - 6)).toBeLessThanOrEqual(1);
  await expect(sheet).toHaveAttribute("data-idle", "true");
  expect(statusBox.y).toBeGreaterThanOrEqual(sheetBox.y - 1);
  expect(statusBox.y + statusBox.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height);

  // A sheet, not an inline panel: a border, rounded corners, padding and an
  // opaque surface, so map labels never show through the text
  // (UX rework 2, #5).
  const sheetStyle = await sheet.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      radius: style.borderTopLeftRadius,
      borderTopWidth: style.borderTopWidth,
      paddingBottom: style.paddingBottom,
      background: style.backgroundColor,
    };
  });
  expect(Number.parseFloat(sheetStyle.radius)).toBeGreaterThanOrEqual(12);
  expect(Number.parseFloat(sheetStyle.borderTopWidth)).toBeGreaterThan(0);
  expect(Number.parseFloat(sheetStyle.paddingBottom)).toBeGreaterThan(0);
  expect(sheetStyle.background).toMatch(/^rgb\(/);

  // The determinism claim of the compact gate: no tiles are requested.
  await expect(plannerMap(page)).toHaveAttribute("data-basemap", "empty");
});

test("the sheet has a peek detent and an expanded one", async ({ page }) => {
  const sheet = page.getByTestId("planner-sheet");
  const handle = page.getByTestId("sheet-handle");
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  // Idle (Trail Glass): nothing planned, so there is no "Ride choices" handle —
  // just "Where to?" and the quick starts.
  await expect(sheet).toHaveAttribute("data-idle", "true");
  await expect(handle).toBeHidden();
  await expect(page.getByTestId("loop-near-me")).toBeVisible();
  await expect(page.getByTestId("just-ride")).toBeVisible();

  // The peek detent is the composer's own height: the ride choices are not
  // visible until the rider asks for them.
  const peekBox = await sheet.boundingBox();
  if (peekBox === null) throw new Error("the sheet has no measured box");

  // Author both endpoints and plan the fixture ride; the sheet rises to its
  // expanded detent once the choices arrive (04 §2).
  await clickMapAtCoordinate(page, START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
  // A destination ends idle: the full composer is back.
  await expect(sheet).not.toHaveAttribute("data-idle", "true");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("aria-expanded", "false");
  await page.getByTestId("compose-create").click();

  const cards = page.locator('[data-testid^="route-card-"]');
  await expect(cards).toHaveCount(2);
  // A planned ride settles at the ride detent (UX rework 2, #8): the chosen
  // route and Start ride, with the map keeping most of the screen. (61% on a
  // 6.7" phone; the 60% target at 390x844 waits on the slimmer header.)
  await expect(sheet).toHaveAttribute("data-detent", "ride");
  await expect(page.getByTestId("start-ride")).toBeInViewport();
  const rideBox = await sheet.boundingBox();
  if (rideBox === null) throw new Error("the ride sheet has no measured box");
  expect(rideBox.y).toBeGreaterThanOrEqual(PHONE.height * 0.55);

  await handle.click();
  await expect(sheet).toHaveAttribute("data-detent", "expanded");
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("route-list")).toBeVisible();

  const expandedBox = await sheet.boundingBox();
  if (expandedBox === null) throw new Error("the expanded sheet has no measured box");
  expect(expandedBox.height).toBeGreaterThan(peekBox.height);
  // The map stays mostly visible (04 §2): the sheet is bounded by the 58dvh cap.
  expect(expandedBox.height).toBeLessThanOrEqual(PHONE.height * 0.59);

  // The handle is the way back down. Its visible label names the surface, the
  // chevron says which way the next press moves it, the count badge says how many
  // choices are behind it, and the accessible name carries the action (owner
  // review 2026-09-17).
  await handle.click();
  await expect(sheet).toHaveAttribute("data-detent", "ride");
  await expect(cards.nth(1)).toBeHidden();
  await expect(page.getByTestId("sheet-handle-label")).toHaveText("Compare rides");
  await expect(page.getByTestId("ride-choices-count")).toHaveText("2");
  await expect(handle).toHaveAttribute("aria-expanded", "false");
  await expect(handle).toHaveAccessibleName("Show ride choices (2)");

  // The drawing survived the collapse.
  await expectDrawnScene(page, { routes: "2" });
  await expectHealthyMap(page);
});

test("safe-area, control sizes and typefaces are the intended ones", async ({
  page,
}) => {
  // The sheet pads itself with the device's safe-area inset, and `viewportFit:
  // cover` is what makes that inset non-zero on a notched phone (12 §12). The
  // declaration is asserted in the served stylesheet because the inset itself is
  // 0 in a headless browser.
  // Every served stylesheet, not the first: the font faces ship as their own
  // sheet and the build decides the order.
  const stylesheetHrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
      (link) => (link as HTMLLinkElement).href,
    ),
  );
  expect(stylesheetHrefs.length).toBeGreaterThan(0);
  for (const href of stylesheetHrefs) expect(href).toContain("/_next/");
  const css = (
    await Promise.all(stylesheetHrefs.map(async (href) => (await page.request.get(href)).text()))
  ).join("\n");
  // Minified by the production build, so the rule is asserted without the space
  // the stylesheet source has.
  // The sheet pads itself with the safe-area token, which `globals.css` derives
  // from `env(safe-area-inset-bottom)`.
  expect(css).toContain("--og-safe-bottom:env(safe-area-inset-bottom,0px)");
  expect(css).toContain("calc(12px + var(--og-safe-bottom))");

  // 12 §10: every planning control is at least 44×44 CSS px.
  // On the idle sheet "Create ride" waits for a destination; the quick starts
  // take its place.
  for (const testId of ["start-chip", "finish-chip", "loop-near-me", "record-a-ride", "just-ride"]) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box, `${testId} must be measurable`).not.toBeNull();
    if (box === null) throw new Error(`${testId} has no measured box`);
    expect(box.height, `${testId} height`).toBeGreaterThanOrEqual(44);
  }

  // 12 §4 (revised in VISUAL-OVERHAUL.md): Outfit for headings, Plus Jakarta Sans for body — and both are self-hosted by
  // `next/font`, so the family names resolve to real faces.
  const headingFamily = await page
    .getByRole("heading", { name: "OpenGravel" })
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(headingFamily).toMatch(/Outfit/i);
  const bodyFamily = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  expect(bodyFamily).toMatch(/Plus Jakarta Sans/i);
});

test("a dropped pin is named, and its coordinate is rendered in full", async ({ page }) => {
  // Owner review 2026-09-17: the destination cell read `40.0717, -…`. Owner
  // review 2026-09-21: it read the raw coordinate as the place value. So the cell
  // now shows the name ("Dropped pin") over the coordinate, the coordinate is
  // never clipped, and nothing invents a place name for a pin the rider dropped.
  await clickMapAtCoordinate(page, START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");

  for (const testId of ["start-value", "finish-value"]) {
    await expect(page.getByTestId(testId)).toContainText("Dropped pin");
  }

  for (const testId of ["start-coordinate", "finish-coordinate"]) {
    const value = page.getByTestId(testId);
    const measured = await value.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        text: element.textContent ?? "",
        overflow: style.overflow,
        ellipsis: style.textOverflow,
        nowrap: style.whiteSpace,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });

    // The whole coordinate is in the DOM and on screen: `lat, lon` at four
    // decimals, with the space the wrap can break at.
    expect(measured.text).toMatch(/^-?\d+\.\d{4}, -?\d+\.\d{4}$/);
    expect(measured.text).toContain(", ");
    expect(measured.ellipsis).not.toBe("ellipsis");
    expect(measured.nowrap).not.toBe("nowrap");
    // Nothing is hidden horizontally: the cell can wrap, so it never overflows.
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth + 1);
  }
});

test("the armed-placement instruction is a note, never a control", async ({
  page,
}) => {
  // One instruction at a time (OGV-D-214): the blocked state shows the composer
  // reason only.
  await expect(page.getByTestId("plan-disabled-reason")).toHaveText(
    "Search for a start, or set it on the map.",
  );
  await expect(page.getByTestId("map-hint")).toHaveCount(0);

  // The empty map is directly usable: two unarmed taps author both endpoints.
  await clickMapAtCoordinate(page, START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await expect(page.getByTestId("plan-disabled-reason")).toHaveText(
    "Search for a destination, or choose it on the map.",
  );
  await expect(page.getByTestId("map-hint")).toHaveCount(0);
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await expect(page.getByTestId("finish-value")).not.toHaveText("No destination yet");
  await expect(page.getByTestId("plan-disabled-reason")).toHaveCount(0);

  // Nothing blocks planning now, so the armed tool is what the map states.
  await page.getByTestId("start-chip").click();
  const hint = page.getByTestId("map-hint");
  await expect(hint).toHaveText("Tap the map to set your start.");
  await expect(hint).toHaveAttribute("role", "note");
  expect(await hint.evaluate((element) => element.tagName)).not.toBe("BUTTON");
  // An instruction takes no pointer events, so a tap that lands on it still
  // places the point the rider aimed at.
  expect(
    await hint.evaluate((element) => getComputedStyle(element).pointerEvents),
  ).toBe("none");
});

/** A one-finger vertical drag on an element, as the browser reports a touch. */
async function touchDrag(page: import("@playwright/test").Page, testId: string, dy: number): Promise<void> {
  await page.getByTestId(testId).evaluate((el, delta) => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + Math.min(box.height / 2, 12);
    const fire = (type: string, clientY: number): void => {
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, pointerType: "touch", pointerId: 7, clientX: x, clientY }),
      );
    };
    fire("pointerdown", y);
    fire("pointerup", y + delta);
  }, dy);
}

test("dragging the sheet down folds it to a thin bar, and dragging up opens it again", async ({ page }) => {
  const sheet = page.getByTestId("planner-sheet");
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  const openBox = await sheet.boundingBox();
  if (openBox === null) throw new Error("the sheet has no measured box");

  await touchDrag(page, "sheet-head", 80);
  await expect(sheet).toHaveAttribute("data-detent", "mini");
  const miniBox = await sheet.boundingBox();
  if (miniBox === null) throw new Error("the folded sheet has no measured box");
  expect(miniBox.height).toBeLessThan(openBox.height / 2);
  expect(miniBox.height).toBeLessThan(110);
  await expect(page.getByTestId("sheet-handle")).toBeVisible();
  await expect(page.getByTestId("sheet-handle")).toHaveAccessibleName("Show planner");

  // Down again does nothing; up brings the sheet back.
  await touchDrag(page, "sheet-head", 80);
  await expect(sheet).toHaveAttribute("data-detent", "mini");
  await touchDrag(page, "sheet-head", -80);
  await expect(sheet).toHaveAttribute("data-detent", "peek");

  // A tap on the bar opens it too.
  await touchDrag(page, "sheet-head", 80);
  await expect(sheet).toHaveAttribute("data-detent", "mini");
  // A swipe swallows the click it ends in for a moment; a real tap comes later.
  await page.waitForTimeout(500);
  await page.getByTestId("sheet-handle").click();
  await expect(sheet).toHaveAttribute("data-detent", "peek");
});
