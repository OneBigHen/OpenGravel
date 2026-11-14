/**
 * TEMPORARY probe (QA lane B): is the black band the map canvas, an overlay, or
 * a compositing artefact? Hides each candidate in turn and re-screenshots.
 */
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { openRideSheet, startRide } from "./ride-focus-helpers";

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

async function blackBand(page: Page): Promise<string> {
  const png = await page.screenshot();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      const at = (y * info.width + x) * info.channels;
      if (data[at] === 0 && data[at + 1] === 0 && data[at + 2] === 0) {
        count += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return count === 0 ? "none" : `${count} px, ${Math.round(minX / 2)},${Math.round(minY / 2)}..${Math.round(maxX / 2)},${Math.round(maxY / 2)}`;
}

test("probe hiding candidates", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    try { window.localStorage.setItem("og-appearance", "day"); } catch { /* ignore */ }
  });
  await startRide(page);
  await openRideSheet(page);
  await page.waitForTimeout(2_000);
  console.log(`\n### baseline: ${await blackBand(page)}`);

  const steps: readonly [string, string][] = [
    ["canvas", "canvas.maplibregl-canvas"],
    ["attempt", ".og-map__attempt"],
    ["map-slot", "[data-testid=ride-map-slot]"],
    ["layers", ".og-layers-overlay"],
    ["places", ".og-places-overlay"],
    ["sheet", "#og-ride-sheet"],
    ["top", ".og-ride__top"],
  ];
  for (const [label, selector] of steps) {
    await page.evaluate((value: string) => {
      const element = document.querySelector(value) as HTMLElement | null;
      if (element !== null) element.style.visibility = "hidden";
    }, selector);
    await page.waitForTimeout(600);
    console.log(`### hidden ${label}: ${await blackBand(page)}`);
    await page.evaluate((value: string) => {
      const element = document.querySelector(value) as HTMLElement | null;
      if (element !== null) element.style.visibility = "";
    }, selector);
    await page.waitForTimeout(300);
  }

  // Does the band follow the map? Pan it with a drag.
  const box = await page.locator("canvas.maplibregl-canvas").boundingBox();
  if (box !== null) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1_500);
    console.log(`### after pan: ${await blackBand(page)}`);
  }
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
});
