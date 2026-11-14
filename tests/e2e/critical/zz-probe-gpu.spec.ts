/**
 * TEMPORARY probe (QA lane B): does the black band survive on the real GPU?
 * Runs the full Chromium (not the headless shell) with the D3D11 ANGLE backend.
 */
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { openRideSheet, startRide } from "./ride-focus-helpers";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  channel: "chromium",
  launchOptions: {
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"],
  },
});

async function report(page: Page): Promise<void> {
  const renderer = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl === null || gl === undefined || debug === null || debug === undefined
      ? "no webgl"
      : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
  });
  const png = await page.screenshot();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      const at = (y * info.width + x) * info.channels;
      if (data[at] === 0 && data[at + 1] === 0 && data[at + 2] === 0) count += 1;
    }
  }
  console.log(`\n### renderer: ${renderer}\n### pure-black pixels: ${count}`);
}

test("probe on the real GPU", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    try { window.localStorage.setItem("og-appearance", "day"); } catch { /* ignore */ }
  });
  await startRide(page);
  await openRideSheet(page);
  await page.waitForTimeout(2_500);
  await report(page);
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
});
