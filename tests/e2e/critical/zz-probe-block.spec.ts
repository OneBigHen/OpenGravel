/**
 * TEMPORARY probe (QA lane B): what paints the flat block over the map behind
 * Explore's "N rides / Fit routes" tools and above the ride Menu sheet?
 *
 * Not a test: it logs the element chain and the pixels. Delete before the PR.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import { openRideSheet, startRide } from "./ride-focus-helpers";
import { plannerMap } from "./map-helpers";

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

interface Block {
  readonly colour: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function blocksOf(page: Page): Promise<{ readonly blocks: readonly Block[]; readonly png: Buffer }> {
  const png = await page.screenshot();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const pixel = (x: number, y: number): string => {
    const at = (y * info.width + x) * channels;
    return `${data[at]},${data[at + 1]},${data[at + 2]}`;
  };
  const rows: { y: number; colour: string; x0: number; x1: number }[] = [];
  for (let y = 0; y < info.height; y += 2) {
    let start = 0;
    let current = pixel(0, y);
    for (let x = 2; x <= info.width; x += 2) {
      const value = x === info.width ? "" : pixel(x, y);
      if (value !== current) {
        if (x - start >= 120) rows.push({ y, colour: current, x0: start, x1: x - 2 });
        start = x;
        current = value;
      }
    }
  }
  const blocks: { y0: number; y1: number; colour: string; x0: number; x1: number }[] = [];
  for (const row of rows) {
    const last = blocks.at(-1);
    if (
      last !== undefined &&
      last.colour === row.colour &&
      row.y - last.y1 <= 4 &&
      Math.abs(row.x0 - last.x0) < 8 &&
      Math.abs(row.x1 - last.x1) < 8
    ) {
      last.y1 = row.y;
      continue;
    }
    blocks.push({ y0: row.y, y1: row.y, colour: row.colour, x0: row.x0, x1: row.x1 });
  }
  return {
    png,
    blocks: blocks
      .filter((block) => block.y1 - block.y0 >= 40)
      .map((block) => ({
        colour: block.colour,
        x: Math.round(block.x0 / 2),
        y: Math.round(block.y0 / 2),
        width: Math.round((block.x1 - block.x0) / 2),
        height: Math.round((block.y1 - block.y0) / 2),
      })),
  };
}

async function report(page: Page, label: string, x: number, y: number): Promise<void> {
  const chain = await page.evaluate(({ x, y }: { x: number; y: number }) => {
    interface Entry {
      readonly at: string;
      readonly data: Record<string, string>;
      readonly background: string;
      readonly rect: string;
      readonly opacity: string;
    }
    const entries: Entry[] = [];
    for (const element of document.elementsFromPoint(x, y).slice(0, 10)) {
      const node = element as HTMLElement;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      entries.push({
        at: `${node.tagName.toLowerCase()}${node.id === "" ? "" : `#${node.id}`}${node.className === "" ? "" : `.${String(node.className).trim().replace(/\s+/g, ".")}`}`,
        data: Object.fromEntries(
          [...node.attributes]
            .filter((attribute) => attribute.name.startsWith("data-"))
            .map((attribute) => [attribute.name, attribute.value.slice(0, 100)]),
        ),
        background: style.backgroundColor,
        opacity: `${style.opacity} filter:${style.filter}`,
        rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      });
    }
    const canvas = document.querySelector("canvas.maplibregl-canvas") as HTMLCanvasElement | null;
    let glInfo: Record<string, unknown> = {};
    if (canvas !== null) {
      const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
      if (gl !== null) {
        const clear = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
        const pixels = new Uint8Array(4);
        const deviceX = Math.round(x * window.devicePixelRatio);
        const deviceY = Math.round((window.innerHeight - y) * window.devicePixelRatio);
        gl.readPixels(deviceX, deviceY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        glInfo = {
          clear: [...clear],
          readback: [...pixels],
          drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          lost: gl.isContextLost(),
        };
      }
    }
    const map = document.querySelector("[data-testid=planner-map]");
    return {
      chain: entries,
      glInfo,
      canvases: [...document.querySelectorAll("canvas")].map((item) => {
        const rect = item.getBoundingClientRect();
        return {
          class: item.className,
          width: item.width,
          height: item.height,
          rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        };
      }),
      map: map === null ? null : {
        load: map.getAttribute("data-map-load"),
        painted: map.getAttribute("data-map-painted"),
        basemap: map.getAttribute("data-basemap"),
      },
    };
  }, { x, y });
  console.log(`\n=== ${label} at ${x},${y} ===\n${JSON.stringify(chain, null, 2)}`);
}

async function setTheme(page: Page, theme: "day" | "night"): Promise<void> {
  await page.addInitScript((value: string) => {
    try {
      window.localStorage.setItem("og-appearance", value);
    } catch {
      // ignore
    }
  }, theme);
}

async function findAndReport(page: Page, label: string, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const first = await blocksOf(page);
  writeFileSync(join(dir, `${label}-before.png`), first.png);
  console.log(`\n### ${label} before: ${JSON.stringify(first.blocks)}`);
  // A DOM repaint request (resize) — if the block is a stale canvas frame, this
  // makes it go away; if it is an element, it stays.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(1_200);
  const after = await blocksOf(page);
  writeFileSync(join(dir, `${label}-after.png`), after.png);
  console.log(`\n### ${label} after resize: ${JSON.stringify(after.blocks)}`);
  for (const block of [...first.blocks, ...after.blocks].slice(0, 3)) {
    await report(page, `${label} ${block.colour}`, block.x + Math.round(block.width / 2), block.y + Math.round(block.height / 2));
  }
}

for (const theme of ["day", "night"] as const) {
  test(`probe Explore block (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await setTheme(page, theme);
    await page.goto("/explore");
    await expect(page.getByTestId("explore-map")).toBeVisible();
    await page.getByTestId("explore-map").scrollIntoViewIfNeeded();
    await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
    await page.waitForTimeout(4_000);
    await findAndReport(page, `explore-${theme}`, join("test-results", "probe-blocks"));
  });

  test(`probe ride Menu block (${theme})`, async ({ page }) => {
    test.setTimeout(180_000);
    await setTheme(page, theme);
    await startRide(page);
    await openRideSheet(page);
    await page.waitForTimeout(3_000);
    await findAndReport(page, `ride-${theme}`, join("test-results", "probe-blocks"));
  });
}
