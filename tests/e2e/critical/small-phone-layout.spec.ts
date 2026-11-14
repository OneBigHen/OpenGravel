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
    const shown = controls.flatMap((el) => { const r = visible(el); return r === null ? [] : [{ el, r }]; });
    for (let i = 0; i < shown.length; i += 1) {
      const a = shown[i]!;
      const cx = a.r.left + a.r.width / 2;
      const cy = a.r.top + a.r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      if (top !== null && !a.el.contains(top) && !top.contains(a.el)) {
        problems.push({ kind: "covered", detail: `${label(a.el)} is under ${label(top)}` });
      }
      for (let j = i + 1; j < shown.length; j += 1) {
        const b = shown[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
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
      await expectClean(page, `explore ${tag}`);
    });

    test(`ride screen fits, no controls overlap (${tag})`, async ({ page }) => {
      await startRide(page);
      await expectClean(page, `ride ${tag}`);
    });
  });
}
