/**
 * Shared measuring tools for the rider gates (GATE-* issues #320-#328).
 *
 * These gates ask what a rider can SEE and TOUCH, not whether an element exists:
 * a control counts only when its box is inside the screen and the browser says
 * that point on screen belongs to it (`elementFromPoint`), not to a neighbour.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import type { Coordinate } from "./map-helpers";

export const PHONE_SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;
export const LANDSCAPE = { width: 844, height: 390 } as const;

/** A weather alert in the top bar: the chip that squeezes a small phone's header. */
export async function withWeatherAlert(page: Page): Promise<void> {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  await page.route("**/api/weather?*", (route) =>
    route.fulfill({
      json: {
        snapshot: {
          fetchedAt: new Date().toISOString(),
          source: "nws",
          alerts: [{ event: "Freeze Warning", severity: "Moderate", onset: null, ends: null, area: "Lehigh" }],
          forecast: [
            {
              name: "Now",
              startTime: start.toISOString(),
              endTime: new Date(start.getTime() + 3 * 3_600_000).toISOString(),
              temperatureF: 33,
              precipChance: 0,
              shortForecast: "Clear",
            },
          ],
        },
      },
    }),
  );
}

/** Pins the Day or Night look before the page loads (Auto follows the sun, so it would drift). */
export async function pinAppearance(page: Page, look: "day" | "night"): Promise<void> {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("og-appearance", value);
    } catch {
      /* storage off */
    }
  }, look);
}

export interface Problem {
  readonly kind: "off-screen" | "overlap" | "covered";
  readonly detail: string;
}

/**
 * Every control that floats over the map (fixed, sticky or absolute), measured the way a thumb meets it:
 *  - off-screen: any edge outside the viewport;
 *  - overlap: two floating controls share more than a few pixels;
 *  - covered: the point at a control's centre belongs to something that is not the control.
 */
export async function floatingControlProblems(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const problems: { kind: "off-screen" | "overlap" | "covered"; detail: string }[] = [];
    const label = (el: Element): string =>
      (el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
    const selector = "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='switch'], [role='radio']";
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
    const controls = [...document.querySelectorAll<HTMLElement>(selector)].filter((el) => {
      if (el.closest("[aria-hidden='true'], [inert], [hidden]") !== null) return false;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      if (getComputedStyle(el).pointerEvents === "none") return false;
      if (el.closest(".maplibregl-canvas-container") !== null) return false;
      // The "Skip to main content" link waits above the screen on purpose until a keyboard focuses it.
      if (el instanceof HTMLAnchorElement && /^#/.test(el.getAttribute("href") ?? "") && /skip/i.test(el.textContent ?? "")) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 8 && r.height >= 8 && floats(el);
    });
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const el of controls) {
      if (inScroller(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > W + 1 || r.left < -1 || r.bottom > H + 1 || r.top < -1) {
        problems.push({ kind: "off-screen", detail: `${label(el)} spans x ${Math.round(r.left)}..${Math.round(r.right)} y ${Math.round(r.top)}..${Math.round(r.bottom)} of ${W}x${H}` });
      }
    }
    // The part of a control a finger can reach: clipped to the screen and to any scrolling parent.
    const reachable = (el: HTMLElement): DOMRect | null => {
      let { left, top, right, bottom } = el.getBoundingClientRect();
      left = Math.max(left, 0); top = Math.max(top, 0); right = Math.min(right, W); bottom = Math.min(bottom, H);
      for (let p = el.parentElement; p !== null; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (st.overflowX !== "visible" || st.overflowY !== "visible") {
          const pr = p.getBoundingClientRect();
          left = Math.max(left, pr.left); top = Math.max(top, pr.top); right = Math.min(right, pr.right); bottom = Math.min(bottom, pr.bottom);
        }
      }
      return right - left > 4 && bottom - top > 4 ? new DOMRect(left, top, right - left, bottom - top) : null;
    };
    const shown = controls.flatMap((el) => { const r = reachable(el); return r === null ? [] : [{ el, r }]; });
    for (let i = 0; i < shown.length; i += 1) {
      const a = shown[i]!;
      const top = document.elementFromPoint(a.r.left + a.r.width / 2, a.r.top + a.r.height / 2);
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

/** Nothing scrolls the page sideways. */
export async function expectNoSidewaysScroll(page: Page, where: string): Promise<void> {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll, `${where}: the page scrolls sideways (${widths.scroll} > ${widths.inner})`).toBeLessThanOrEqual(widths.inner);
}

/** Lets sheets and toasts finish moving, and drops the keyboard's recents list, before measuring. */
export async function settleChrome(page: Page): Promise<void> {
  await page.waitForTimeout(900);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(250);
}

/**
 * A rider can use this control: it is wholly on screen and a tap at its centre
 * lands on it (or something inside it), not on whatever floats above.
 */
export async function expectReachable(page: Page, target: Locator, name: string): Promise<void> {
  await expect(target.first(), `${name} is visible`).toBeVisible();
  const box = await target.first().boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error(`${name} has no box`);
  expect(box.x, `${name} left edge`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${name} top edge`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${name} right edge past ${viewport.width}`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height, `${name} bottom edge past ${viewport.height}`).toBeLessThanOrEqual(viewport.height + 1);
  const owns = await target.first().evaluate((el, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return hit !== null && (el.contains(hit) || hit.contains(el));
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(owns, `${name}: something else sits on top of its centre`).toBe(true);
}

/** WCAG contrast of two [r,g,b] colours. */
export function contrast(a: readonly number[], b: readonly number[]): number {
  const lum = (c: readonly number[]): number => {
    const [r, g, bl] = c.map((v) => {
      const s = (v ?? 0) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text that is too faint to read: every visible text element whose colour and an OPAQUE background
 * behind it (found by walking up) are under `minimum`:1. Text over the map or over a translucent
 * glass with nothing opaque behind it cannot be measured honestly from styles, so it is skipped
 * rather than guessed.
 */
export async function faintText(page: Page, minimum = 4.5, within = "body"): Promise<string[]> {
  return page.evaluate(
    ({ minimum: min, within: scope }) => {
      const parse = (css: string): [number, number, number, number] | null => {
        const m = /rgba?\(([^)]+)\)/.exec(css);
        if (m === null) return null;
        const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
        return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
      };
      const lum = (c: readonly number[]): number => {
        const [r, g, b] = c.slice(0, 3).map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a: readonly number[], b: readonly number[]): number => {
        const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
        return (hi + 0.05) / (lo + 0.05);
      };
      const out: string[] = [];
      const root = document.querySelector(scope) ?? document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const seen = new Set<Element>();
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const el = node.parentElement;
        if (el === null || seen.has(el) || (node.textContent ?? "").trim().length < 2) continue;
        seen.add(el);
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        if (el.closest("[aria-hidden='true'], .og-visually-hidden, .maplibregl-canvas-container, script, style, noscript") !== null) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
        const style = getComputedStyle(el);
        const fg = parse(style.color);
        if (fg === null) continue;
        // Find the first opaque background behind the text; anything translucent or imaged on the way means "cannot say".
        let bg: [number, number, number, number] | null = null;
        let unknown = false;
        for (let p: Element | null = el; p !== null; p = p.parentElement) {
          const ps = getComputedStyle(p);
          if (ps.backgroundImage !== "none") { unknown = true; break; }
          const c = parse(ps.backgroundColor);
          if (c !== null && c[3] >= 0.98) { bg = c; break; }
          if (c !== null && c[3] > 0.02) { unknown = true; break; }
        }
        if (unknown || bg === null || fg[3] < 0.98) continue;
        const r = ratio(fg, bg);
        if (r < min) out.push(`"${(node.textContent ?? "").trim().slice(0, 30)}" ${r.toFixed(2)}:1 (${style.color} on rgb(${bg.slice(0, 3).join(",")}))`);
      }
      return out;
    },
    { minimum, within },
  );
}

/**
 * Marks the running test as waiting on a fix that is still in an open PR.
 * The test is skipped (shown as "fixme") unless `OGV_RUN_FIXME=1`, which runs it anyway:
 * that is how to prove it still fails on main and passes once the PR lands.
 */
export function waitingOn(reason: string): void {
  test.fixme(process.env["OGV_RUN_FIXME"] !== "1", reason);
}

interface Candidate { readonly geometry: readonly Coordinate[] }

/** A point both fixture routes pass through (so it is on the selected line whichever one is selected). */
export function sharedLinePoint(): Coordinate {
  const { candidates } = JSON.parse(
    readFileSync(join(process.cwd(), "tests/fixtures/route-plan/candidates-basic.json"), "utf8"),
  ) as { candidates: Candidate[] };
  const [a, b] = [candidates[0]!.geometry, candidates[1]!.geometry];
  const metres = (p: Coordinate, q: Coordinate): number =>
    Math.hypot((p.lon - q.lon) * 111_320 * Math.cos((p.lat * Math.PI) / 180), (p.lat - q.lat) * 110_540);
  let best: { point: Coordinate; gap: number } | null = null;
  for (let i = 2; i < a.length - 2; i += 1) {
    for (let j = 2; j < b.length - 2; j += 1) {
      const gap = metres(a[i]!, b[j]!);
      if (best === null || gap < best.gap) best = { point: a[i]!, gap };
    }
  }
  if (best === null) throw new Error("fixture routes have no shared point");
  return best.point;
}

