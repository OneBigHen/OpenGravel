import { expect, test, type Page } from "@playwright/test";

import { plannerMap, settledExtent } from "./map-helpers";
import { PHONE_SIZES, waitingOn } from "./rider-gate-helpers";
import { directionsTo } from "./search-helpers";

/**
 * GATE-SUMMARY-TRUTH (#322; behind QA-09, QA-10, QA-16).
 *
 * For an A-to-B route and for a loop, on a normal and a small phone: the headline facts a rider decides
 * on (time, distance, climb) are shown whole and not cut off, the numbers repeated in different places
 * agree with each other, and the surface bar is honest about what it shows (a colour for every kind the
 * legend names, and the colours differ).
 *
 * The place-sheet distance against a real road distance is checked against the real router in
 * tests/real-router/rider-gates-live.test.ts.
 *
 * Waiting on PR #242: on main the climb reads "Clim..." on 320 and the time wraps.
 */
test.describe.configure({ timeout: 150_000 });

const WAIT_242 = "waiting on PR #242 (small phones and landscape): the climb is cut to \"Clim...\" at 320";

interface Truncation {
  readonly what: string;
  readonly text: string;
  readonly scroll: number;
  readonly client: number;
}

/** Headline text that does not fit in its own box (cut with an ellipsis, clipped or wrapped). */
async function cutOff(page: Page): Promise<Truncation[]> {
  return page.evaluate(() => {
    const selectors = [
      ".og-phone-summary__time",
      ".og-phone-summary__arrive",
      ".og-phone-summary__meta-text",
      "[data-testid='peek-facts']",
    ];
    const out: { what: string; text: string; scroll: number; client: number }[] = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll<HTMLElement>(`[data-testid='route-summary'] ${selector}`)) {
        if (!el.checkVisibility({ visibilityProperty: true })) continue;
        const style = getComputedStyle(el);
        const text = (el.textContent ?? "").trim();
        if (text === "") continue;
        const wide = el.scrollWidth > el.clientWidth + 1;
        const tall = style.display !== "inline" && el.scrollHeight > el.clientHeight + 1 && style.overflow !== "visible";
        // The time is one short token: it must not wrap onto a second line.
        const wrapped = selector.endsWith("__time") && el.getBoundingClientRect().height > parseFloat(style.lineHeight || "0") * 1.6;
        if (wide || tall || wrapped) out.push({ what: selector, text, scroll: el.scrollWidth, client: el.clientWidth });
        // Words ending in an ellipsis character are a cut, whatever CSS did.
        if (/…$|\.\.\.$/.test(text)) out.push({ what: `${selector} (ellipsis)`, text, scroll: el.scrollWidth, client: el.clientWidth });
      }
    }
    return out;
  });
}

/** Colours of the surface bar's segments, and the kinds the legend names. */
async function surfaceReport(page: Page): Promise<{ stripKinds: string[]; legendKinds: string[]; colours: string[] }> {
  return page.evaluate(() => {
    const strip = document.querySelector("[data-testid='phone-surface-strip']");
    const legend = document.querySelector("[data-testid='phone-surface-legend']");
    const spans = [...(strip?.querySelectorAll<HTMLElement>("[data-surface]") ?? [])];
    const legendSpans = [...(legend?.querySelectorAll<HTMLElement>("[data-surface]") ?? [])];
    const paint = (el: HTMLElement): string => {
      const s = getComputedStyle(el);
      return `${s.backgroundColor}|${s.backgroundImage === "none" ? "" : "hatch"}`;
    };
    return {
      stripKinds: spans.map((el) => el.dataset["surface"] ?? ""),
      legendKinds: legendSpans.map((el) => el.dataset["surface"] ?? ""),
      colours: [...new Set(spans.map(paint))],
    };
  });
}

function miles(text: string | null): number | null {
  const found = /(\d+(?:[.,]\d+)?)\s*mi\b/.exec(text ?? "");
  return found === null ? null : Number(found[1]!.replace(",", "."));
}

async function expectHeadlineTruth(page: Page, where: string): Promise<void> {
  const summary = page.getByTestId("route-summary");
  await expect(summary).toBeVisible();
  // The climb arrives a moment after the route (the elevation profile); wait for it, then check it is whole.
  await expect(summary.locator(".og-phone-summary__meta-text")).toContainText(/Climb\s+[\d,]+\s*ft/, { timeout: 20_000 });
  await page.waitForTimeout(500);
  expect(await cutOff(page), `${where}: headline facts cut off`).toEqual([]);

  // The distance on the arrival line and in the peek line is the same number.
  const arrive = miles(await summary.locator(".og-phone-summary__arrive").textContent());
  const peek = miles(await page.getByTestId("peek-facts").textContent());
  expect(arrive, `${where}: arrival line has a distance`).not.toBeNull();
  expect(peek, `${where}: peek line has a distance`).not.toBeNull();
  expect(peek, `${where}: peek distance agrees with the arrival line`).toBe(arrive);

  const surface = await surfaceReport(page);
  if (surface.stripKinds.length > 0) {
    expect(surface.legendKinds.length, `${where}: legend names something`).toBeGreaterThan(0);
    expect(surface.colours.length, `${where}: the bar has at least as many colours as the legend has entries`).toBeGreaterThanOrEqual(surface.legendKinds.length);
    expect([...new Set(surface.stripKinds)].sort(), `${where}: bar and legend name the same kinds`).toEqual([...surface.legendKinds].sort());
  }
}

for (const size of PHONE_SIZES) {
  const tag = `${size.width}x${size.height}`;

  test(`A-to-B route summary tells the whole truth ${tag}`, async ({ page }) => {
    if (size.width === 320) waitingOn(WAIT_242);
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);
    await directionsTo(page);
    await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 30_000 });
    await expectHeadlineTruth(page, `A-to-B ${tag}`);
  });

  test(`loop summary tells the whole truth ${tag}`, async ({ page }) => {
    if (size.width === 320) waitingOn(WAIT_242);
    await page.context().setGeolocation({ latitude: 40.1385, longitude: -75.4385 });
    await page.context().grantPermissions(["geolocation"]);
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(plannerMap(page)).toBeVisible();
    await settledExtent(page);
    await page.getByTestId("loop-near-me").click();
    await expect(page.getByTestId("status-line")).toHaveText("Ride ready.", { timeout: 45_000 });
    await expectHeadlineTruth(page, `loop ${tag}`);
  });
}
