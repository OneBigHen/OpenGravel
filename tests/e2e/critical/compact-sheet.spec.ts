import { expect, test } from "@playwright/test";

import {
  clickMapAtCoordinate,
  placeEndpoint,
  expectDrawnScene,
  expectHealthyMap,
  plannerMap,
  settledExtent,
  pressPlan,
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

  // The tab bar is a floating glass pill (DESIGN.md §2, v4): inset from the
  // edges and the bottom, 60px tall, and the sheet floats 8px above it. The
  // status line is *inside* the sheet — the defect the owner review flagged
  // was a status chip floating over the map. On the idle sheet it is announced
  // but not drawn (Trail Glass).
  const tabBar = await page.getByTestId("primary-nav").boundingBox();
  if (tabBar === null) throw new Error("the tab bar has no measured box");
  const barGap = PHONE.height - (tabBar.y + tabBar.height);
  expect(barGap).toBeGreaterThanOrEqual(6);
  expect(barGap).toBeLessThanOrEqual(10);
  expect(tabBar.x).toBeGreaterThanOrEqual(6);
  expect(tabBar.x + tabBar.width).toBeLessThanOrEqual(PHONE.width - 6);
  expect(tabBar.height).toBeGreaterThanOrEqual(59);
  expect(tabBar.height).toBeLessThanOrEqual(62);
  const sheetToBar = tabBar.y - (sheetBox.y + sheetBox.height);
  expect(sheetToBar).toBeGreaterThanOrEqual(6);
  expect(sheetToBar).toBeLessThanOrEqual(10);
  const barStyle = await page.getByTestId("primary-nav").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backdrop: style.backdropFilter,
      background: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      borderTopLeftRadius: style.borderTopLeftRadius,
    };
  });
  // Glass over the map (DESIGN.md §2, v4): a blurred, mostly opaque surface,
  // so the map reads through the bar and its labels stay legible.
  expect(barStyle.background).toMatch(/^(rgb|color\()/);
  expect(barStyle.backdrop).toMatch(/blur/);
  expect(Number.parseFloat(barStyle.borderTopWidth)).toBeGreaterThan(0);
  expect(Number.parseFloat(barStyle.borderTopLeftRadius)).toBeGreaterThanOrEqual(20);
  await expect(sheet).toHaveAttribute("data-idle", "true");
  expect(statusBox.y).toBeGreaterThanOrEqual(sheetBox.y - 1);
  expect(statusBox.y + statusBox.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height);

  // A sheet, not an inline panel: rounded corners, padding, a dense blurred
  // glass surface so map labels never compete with the text (UX rework 2, #5),
  // and the glass shadow that lifts it off the map (DESIGN.md §2, v4).
  const sheetStyle = await sheet.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      radius: style.borderTopLeftRadius,
      shadow: style.boxShadow,
      paddingBottom: style.paddingBottom,
      background: style.backgroundColor,
    };
  });
  expect(Number.parseFloat(sheetStyle.radius)).toBeGreaterThanOrEqual(12);
  expect(sheetStyle.shadow).not.toBe("none");
  expect(Number.parseFloat(sheetStyle.paddingBottom)).toBeGreaterThan(0);
  expect(sheetStyle.background).toMatch(/^(rgb|color\()/);

  // The determinism claim of the compact gate: no tiles are requested.
  await expect(plannerMap(page)).toHaveAttribute("data-basemap", "empty");
});

test("the shared sheet has peek, half and full detents", async ({ page }) => {
  const sheet = page.getByTestId("planner-sheet"), handle = page.getByTestId("sheet-handle");
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  await expect(page.getByTestId("loop-near-me")).toBeVisible();
  await expect(page.getByTestId("just-ride")).toBeVisible();
  await handle.click();
  await expect(sheet).toHaveAttribute("data-detent", "half");
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  const half = await sheet.boundingBox();
  // Half is half the screen above the tab bar; the floating sheet's 8px gap
  // lifts its top edge by the same 8px.
  expect(half!.y).toBeGreaterThanOrEqual(PHONE.height * .5 - 10);
  await placeEndpoint(page, "start", START_COORDINATE);
  await placeEndpoint(page, "finish", DESTINATION_COORDINATE);
  await pressPlan(page);
  await expectDrawnScene(page, { routes: "2" });
  await expect(page.getByTestId("start-ride")).toBeVisible();
  await handle.press("ArrowUp");
  await expect(sheet).toHaveAttribute("data-detent", "full");
  await expect(page.getByTestId("top-search")).toBeHidden();
  const full = await sheet.boundingBox();
  expect(full!.height).toBeGreaterThan(half!.height);
  await handle.press("ArrowDown");
  await expect(sheet).toHaveAttribute("data-detent", "half");
  await expect(page.getByTestId("top-search")).toBeVisible();
  await handle.press("ArrowDown");
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  await expect(handle).toHaveAttribute("aria-expanded", "false");
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
  // tokens.css derives the safe-area token from `env(safe-area-inset-bottom)`;
  // the floating tab bar's bottom gap is what reserves it (design v4).
  expect(css).toContain("--og-safe-bottom:env(safe-area-inset-bottom,0px)");
  expect(css).toMatch(/--og-tabbar-gap:max\(var\(--og-space-2\),\s*calc\(var\(--og-safe-bottom\) - 14px\)\)/);

  // 12 §10: every planning control is at least 44×44 CSS px.
  // On the idle sheet "Create ride" waits for a destination; the quick starts
  // take its place.
  for (const testId of ["sheet-handle", "loop-near-me", "record-a-ride", "just-ride"]) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box, `${testId} must be measurable`).not.toBeNull();
    if (box === null) throw new Error(`${testId} has no measured box`);
    expect(box.height, `${testId} height`).toBeGreaterThanOrEqual(44);
  }

  // 12 §4 (revised in VISUAL-OVERHAUL.md): Outfit for headings, Plus Jakarta Sans for body — and both are self-hosted by
  // `next/font`, so the family names resolve to real faces.
  const headingFamily = await page
    .getByRole("heading", { name: "OpenGravel", includeHidden: true })
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
  await placeEndpoint(page, "start", START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await placeEndpoint(page, "finish", DESTINATION_COORDINATE);
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
    "Search for a start, or press and hold the map.",
  );
  await expect(page.getByTestId("map-hint")).toHaveCount(0);

  // A plain tap on the empty map authors nothing (maps-for-riders §1): riders
  // pan and pinch with gloves on, and a stray touch used to route them.
  await clickMapAtCoordinate(page, START_COORDINATE);
  await clickMapAtCoordinate(page, DESTINATION_COORDINATE);
  await expect(page.getByTestId("start-value")).toHaveText("No start yet");
  await expect(page.getByTestId("map-point-menu")).toHaveCount(0);

  // Press and hold is the map's way in: the point menu sets each endpoint.
  await placeEndpoint(page, "start", START_COORDINATE);
  await expect(page.getByTestId("start-value")).not.toHaveText("No start yet");
  await expect(page.getByTestId("plan-disabled-reason")).toHaveText(
    "Search for a destination, or press and hold the map.",
  );
  await expect(page.getByTestId("map-hint")).toHaveCount(0);
  await placeEndpoint(page, "finish", DESTINATION_COORDINATE);
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

test("swiping the shared handle visits all three detents", async ({ page }) => {
  const sheet = page.getByTestId("planner-sheet");
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  await touchDrag(page, "sheet-handle", -80);
  await expect(sheet).toHaveAttribute("data-detent", "half");
  await touchDrag(page, "sheet-handle", -80);
  await expect(sheet).toHaveAttribute("data-detent", "full");
  await touchDrag(page, "sheet-handle", 80);
  await expect(sheet).toHaveAttribute("data-detent", "half");
  await touchDrag(page, "sheet-handle", 80);
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  await touchDrag(page, "sheet-handle", 80);
  await expect(sheet).toHaveAttribute("data-detent", "peek");
});
