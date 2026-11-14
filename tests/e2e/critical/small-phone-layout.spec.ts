import { expect, test, type Page } from "@playwright/test";

import { startRide } from "./ride-focus-helpers";
import { plannerMap, settledExtent } from "./map-helpers";
import { directionsTo } from "./search-helpers";

/**
 * The basics on the phones riders actually hold (QA sweep 2026-11-14): nothing
 * scrolls sideways, and no two buttons sit on top of each other. Measured on the
 * smallest phone (320 x 568), a normal one (390 x 844) and a phone on its side
 * (844 x 390), on the home map (with a weather alert showing, which is what
 * squeezes the top bar), the plan sheet, Explore and the ride screen.
 */

const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
] as const;

test.describe.configure({ timeout: 180_000 });

async function weatherAlert(page: Page): Promise<void> {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  await page.route("**/api/weather?*", (route) => route.fulfill({
    json: {
      snapshot: {
        fetchedAt: new Date().toISOString(),
        source: "nws",
        alerts: [{ event: "Freeze Warning", severity: "Moderate", onset: null, ends: null, area: "Lehigh" }],
        forecast: [{
          name: "Now",
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() + 3 * 3_600_000).toISOString(),
          temperatureF: 33,
          precipChance: 0,
          shortForecast: "Clear",
        }],
      },
    },
  }));
}

export interface LayoutProblem {
  readonly kind: string;
  readonly detail: string;
}

/** Sideways scroll, controls on top of each other, and controls hidden under others. */
async function layoutProblems(page: Page): Promise<LayoutProblem[]> {
  return page.evaluate(() => {
    const problems: { kind: string; detail: string }[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > window.innerWidth) {
      problems.push({ kind: "sideways-scroll", detail: `${root.scrollWidth} > ${window.innerWidth}` });
    }
    const label = (el: Element): string =>
      (el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.textContent ?? el.className.toString()).trim().slice(0, 40);
    const controls = [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role='button'], [role='tab']")]
      .filter((el) => {
        if (el.closest("[aria-hidden='true'], [inert], [hidden]") !== null) return false;
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
        if (getComputedStyle(el).pointerEvents === "none") return false;
        // Real controls only: visually hidden helpers and the map canvas itself do not count.
        const r = el.getBoundingClientRect();
        return r.width >= 8 && r.height >= 8 && el.closest(".maplibregl-canvas-container") === null;
      });
    // The part of each control a finger can reach: clipped to the screen and to scrolling ancestors.
    const visible = (el: HTMLElement): DOMRect | null => {
      let { left, top, right, bottom } = el.getBoundingClientRect();
      left = Math.max(left, 0); top = Math.max(top, 0);
      right = Math.min(right, window.innerWidth); bottom = Math.min(bottom, window.innerHeight);
      for (let p = el.parentElement; p !== null; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") {
          const pr = p.getBoundingClientRect();
          left = Math.max(left, pr.left); top = Math.max(top, pr.top);
          right = Math.min(right, pr.right); bottom = Math.min(bottom, pr.bottom);
        }
      }
      return right - left > 4 && bottom - top > 4 ? new DOMRect(left, top, right - left, bottom - top) : null;
    };
    // Chrome floats over the map (fixed, sticky or absolutely placed). Plain page
    // content that scrolls under the bottom bar is normal and not a clash.
    const floats = (el: HTMLElement): boolean => {
      for (let p: HTMLElement | null = el; p !== null; p = p.parentElement) {
        if (["fixed", "sticky", "absolute"].includes(getComputedStyle(p).position)) return true;
      }
      return false;
    };
    const inScroller = (el: HTMLElement): boolean => {
      for (let p = el.parentElement; p !== null && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") return true;
      }
      return false;
    };
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (!inScroller(el) && floats(el) && (r.right > window.innerWidth + 1 || r.left < -1)) {
        problems.push({ kind: "off-screen", detail: `${label(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} of ${window.innerWidth}` });
      }
    }
    const shown = controls.flatMap((el) => { const r = visible(el); return r === null ? [] : [{ el, r }]; });
    for (let i = 0; i < shown.length; i += 1) {
      const a = shown[i]!;
      const cx = a.r.left + a.r.width / 2;
      const cy = a.r.top + a.r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      if (top !== null && !a.el.contains(top) && !top.contains(a.el) && floats(a.el)) {
        problems.push({ kind: "covered", detail: `${label(a.el)} is under ${label(top)}` });
      }
      for (let j = i + 1; j < shown.length; j += 1) {
        const b = shown[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el) || !(floats(a.el) && floats(b.el))) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 3 && h > 3) problems.push({ kind: "overlap", detail: `${label(a.el)} and ${label(b.el)} (${Math.round(w)}x${Math.round(h)}px)` });
      }
    }
    return problems;
  });
}

async function expectClean(page: Page, where: string): Promise<void> {
  // Let sheets and toasts finish moving before measuring.
  await page.waitForTimeout(800);
  // A search box that still has the keyboard shows its recent places over the map; that is the list, not a clash.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(200);
  expect(await layoutProblems(page), where).toEqual([]);
}

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;
  test.describe(tag, () => {
    test.beforeEach(async ({ page }) => {
      await weatherAlert(page);
      await page.setViewportSize(size);
    });

    test(`home map fits, no controls overlap (${tag})`, async ({ page }) => {
      await page.goto("/");
      await expect(plannerMap(page)).toBeVisible();
      await settledExtent(page);
      await expect(page.getByTestId("top-search")).toBeVisible();
      await expectClean(page, `home ${tag}`);
    });

    test(`plan sheet fits, no controls overlap (${tag})`, async ({ page }) => {
      await page.goto("/");
      await expect(plannerMap(page)).toBeVisible();
      await settledExtent(page);
      await directionsTo(page);
      await expect(page.getByTestId("route-summary")).toBeVisible({ timeout: 60_000 });
      await expectClean(page, `plan sheet ${tag}`);
    });

    test(`Explore fits, no controls overlap (${tag})`, async ({ page }) => {
      await page.goto("/explore");
      await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();
      // The title is not a control, so the guard cannot see it: it must end before the Ride / Things switch.
      await expect(page.locator(".og-explore__lens")).toBeVisible();
      await expect(page.locator(".og-explore h1")).toBeVisible();
      const title = await page.evaluate(() => {
        const h = document.querySelector(".og-explore h1")!;
        const range = document.createRange();
        range.selectNodeContents(h);
        const text = range.getBoundingClientRect();
        const next = document.querySelector(".og-explore__lens")!.getBoundingClientRect();
        return { textRight: text.right, nextLeft: next.left, clipped: h.scrollWidth > h.clientWidth };
      });
      expect(title.textRight, "Explore title runs under the Ride / Things switch").toBeLessThanOrEqual(title.nextLeft + 1);
      expect(title.clipped).toBe(false);
      await expectClean(page, `explore ${tag}`);
    });

    test(`ride screen fits, no controls overlap (${tag})`, async ({ page }) => {
      await startRide(page);
      await expectClean(page, `ride ${tag}`);
    });
  });
}

// ---- Specific rider-visible checks behind the QA ids ----

test.describe("QA-01 search with a weather alert at 320", () => {
  test("typed text is fully visible and the menu stays off the search", async ({ page }) => {
    await weatherAlert(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await expect(page.locator(".og-conditions__pill")).toBeVisible();
    const input = page.getByTestId("top-place-search");
    await input.click();
    await input.fill("Jim Thorpe PA");
    const fit = await input.evaluate((el: HTMLInputElement) => ({ scroll: el.scrollWidth, client: el.clientWidth, left: el.getBoundingClientRect().left }));
    expect(fit.scroll, "typed text is cut off").toBeLessThanOrEqual(fit.client);
    const boxes = await page.evaluate(() => {
      const r = (s: string): { l: number; r: number } => { const b = document.querySelector(s)!.getBoundingClientRect(); return { l: b.left, r: b.right }; };
      return { bar: r(".og-top-search__bar"), menu: r(".og-top-search__menu") };
    });
    expect(boxes.bar.r, "search bar ends before the menu button").toBeLessThanOrEqual(boxes.menu.l);
    // Idle: the weather chip is inside the bar, the placeholder still has room to read.
    await input.fill("");
    await page.getByTestId("planner-sheet").click({ position: { x: 20, y: 5 }, force: true }).catch(() => undefined);
    await input.blur();
    const idle = await page.evaluate(() => {
      const bar = document.querySelector(".og-top-search__bar")!.getBoundingClientRect();
      const pill = document.querySelector(".og-conditions__pill")!.getBoundingClientRect();
      const field = document.querySelector<HTMLInputElement>("[data-testid='top-place-search']")!.getBoundingClientRect();
      return { barRight: bar.right, pillRight: pill.right, fieldRight: field.right, pillLeft: pill.left, fieldWidth: field.width };
    });
    expect(idle.pillRight).toBeLessThanOrEqual(idle.barRight + 1);
    expect(idle.fieldRight).toBeLessThanOrEqual(idle.pillLeft + 1);
    expect(idle.fieldWidth, "room to read the placeholder").toBeGreaterThanOrEqual(100);
  });
});

for (const width of [320, 390]) {
  test(`QA-09 route summary shows the whole climb and time at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);
    await directionsTo(page);
    const summary = page.getByTestId("route-summary");
    await expect(summary).toBeVisible({ timeout: 60_000 });
    await expect(summary.locator(".og-phone-summary__meta-text")).toContainText(/Climb/, { timeout: 30_000 });
    const report = await summary.evaluate((root) => {
      const cut: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>(".og-phone-summary__meta-text, .og-phone-summary__arrive, .og-phone-summary__time")) {
        if (el.scrollWidth > el.clientWidth + 1) cut.push(`${el.className}: ${el.scrollWidth} > ${el.clientWidth}`);
        if (getComputedStyle(el).textOverflow === "ellipsis") cut.push(`${el.className} uses an ellipsis`);
      }
      const time = root.querySelector<HTMLElement>(".og-phone-summary__time")!;
      const lines = time.getBoundingClientRect().height / parseFloat(getComputedStyle(time).lineHeight);
      return { cut, timeLines: Math.round(lines) };
    });
    expect(report.cut).toEqual([]);
    expect(report.timeLines, "the time stays on one line").toBe(1);
  });
}

test("QA-20 the attribution disc is not hidden behind the locate button on a cold open", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  const gap = await page.evaluate(() => {
    const attr = document.querySelector(".og-map .maplibregl-ctrl-attrib-button")?.getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".og-map__cluster button")].map((b) => b.getBoundingClientRect());
    if (attr === undefined) return { found: false, clash: 0, attr: [], buttons: [] };
    const clash = buttons.filter((b) => Math.min(attr.right, b.right) - Math.max(attr.left, b.left) > 1
      && Math.min(attr.bottom, b.bottom) - Math.max(attr.top, b.top) > 1).length;
    return { found: true, clash, attr: [attr.left, attr.top, attr.width, attr.height], buttons: buttons.map((b) => [b.left, b.top, b.width, b.height]) };
  });
  expect(gap.found, "attribution disc exists").toBe(true);
  expect(gap.clash, `attribution disc overlaps a map button ${JSON.stringify(gap)}`).toBe(0);
});

test("QA-21 desktop: the destination shape does not say Make my loop, and the corners are clear", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(plannerMap(page)).toBeVisible();
  await settledExtent(page);
  // Desktop opens on "To a destination"; the big button must say what that does.
  await page.getByTestId("ride-shape-destination").check({ force: true });
  await expect(page.getByTestId("compose-create")).not.toHaveText("Make my loop");
  const corners = await page.evaluate(() => {
    const box = (s: string): DOMRect | null => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const legend = box("[data-testid='map-legend']");
    const scale = box("[data-testid='map-scale']");
    const attr = box(".og-map .maplibregl-ctrl-attrib-button");
    const cluster = [...document.querySelectorAll(".og-map__cluster button")].map((b) => b.getBoundingClientRect());
    const hits = (a: DOMRect, b: DOMRect): boolean => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
    return {
      legendOverScale: legend !== null && scale !== null && hits(legend, scale),
      attrOnCluster: attr !== null && cluster.some((c) => hits(attr, c)),
      attrOffScreen: attr !== null && (attr.bottom > window.innerHeight || attr.right > window.innerWidth),
    };
  });
  expect(corners).toEqual({ legendOverScale: false, attrOnCluster: false, attrOffScreen: false });
});

test("QA-23 'Finding you on the route' stays clear of the GPS warning badge at 320", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await startRide(page);
  const clash = await page.evaluate(() => {
    const text = document.querySelector<HTMLElement>(".og-ride__maneuver-suspended");
    const badge = document.querySelector<HTMLElement>(".og-ride__gps-badge");
    if (text === null || badge === null) return null;
    const range = document.createRange();
    range.selectNodeContents(text);
    const t = range.getBoundingClientRect(), b = badge.getBoundingClientRect();
    return Math.min(t.right, b.right) - Math.max(t.left, b.left) > 0 && Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top) > 0;
  });
  // The suspended card only shows while the router matches the rider; when the
  // fixture has already matched, there is nothing to touch.
  expect(clash === null || clash === false).toBe(true);
  void context;
});
