/**
 * TEMPORARY probe (QA lane B): what paints the flat block over the ride map?
 * Lists every element whose box covers the block centre, including ones with
 * pointer-events:none that elementsFromPoint cannot see.
 */
import { test } from "@playwright/test";

import { openRideSheet, startRide } from "./ride-focus-helpers";

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

for (const theme of ["day", "night"] as const) {
  test(`probe ride stack (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript((value: string) => {
      try { window.localStorage.setItem("og-appearance", value); } catch { /* ignore */ }
    }, theme);
    await startRide(page);
    await openRideSheet(page);
    await page.waitForTimeout(2_500);
    const list = await page.evaluate(({ x, y }: { x: number; y: number }) => {
      const out: Record<string, unknown>[] = [];
      for (const element of document.querySelectorAll("*")) {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5) continue;
        if (!(rect.left <= x && rect.right >= x && rect.top <= y && rect.bottom >= y)) continue;
        const style = getComputedStyle(node);
        out.push({
          at: `${node.tagName.toLowerCase()}${node.id === "" ? "" : `#${node.id}`}${node.className === "" ? "" : `.${String(node.className).trim().replace(/\s+/g, ".")}`}`,
          rect: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          bg: style.backgroundColor,
          bgImage: style.backgroundImage.slice(0, 60),
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          position: style.position,
          zIndex: style.zIndex,
          transform: style.transform,
          filter: style.filter,
          mixBlend: style.mixBlendMode,
          boxShadow: style.boxShadow.slice(0, 80),
        });
      }
      return out;
    }, { x: 195, y: 150 });
    console.log(`\n=== ride ${theme} stack at 195,150 ===\n${JSON.stringify(list, null, 2)}`);
  });
}
