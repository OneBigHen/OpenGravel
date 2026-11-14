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
  // Rows of one flat colour at least 120 device px wide.
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
  // Group consecutive rows with the same colour and overlapping x-range.
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
      // The day and night page backgrounds are the whole screen; ignore them.
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
      readonly text: string;
    }
    const entries: Entry[] = [];
    for (const element of document.elementsFromPoint(x, y).slice(0, 12)) {
      const node = element as HTMLElement;
      const rect = node.getBoundingClientRect();
      entries.push({
        at: `${node.tagName.toLowerCase()}${node.id === "" ? "" : `#${node.id}`}${node.className === "" ? "" : `.${String(node.className).trim().replace(/\s+/g, ".")}`}`,
        data: Object.fromEntries(
          [...node.attributes]
            .filter((attribute) => attribute.name.startsWith("data-") || attribute.name === "style")
            .map((attribute) => [attribute.name, attribute.value.slice(0, 120)]),
        ),
        background: getComputedStyle(node).backgroundColor,
        rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        text: (node.textContent ?? "").trim().slice(0, 60),
      });
    }
    const canvases = [...document.querySelectorAll("canvas")].map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return {
        class: canvas.className,
        width: canvas.width,
        height: canvas.height,
        rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        parent: (canvas.parentElement?.className ?? "").slice(0, 80),
      };
    });
    const gl = document.createElement("canvas").getContext("webgl");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl === null || gl === undefined || debug === null || debug === undefined
      ? "no webgl"
      : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
    const map = document.querySelector("[data-testid=planner-map]");
    return {
      chain: entries,
      canvases,
      renderer,
      dpr: window.devicePixelRatio,
      map: map === null ? null : {
        load: map.getAttribute("data-map-load"),
        painted: map.getAttribute("data-map-painted"),
        basemap: map.getAttribute("data-basemap"),
        rect: (() => { const r = map.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; })(),
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

for (const theme of ["day", "night"] as const) {
  test(`probe Explore block (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await setTheme(page, theme);
    await page.goto("/explore");
    await expect(page.getByTestId("explore-map")).toBeVisible();
    await expect(plannerMap(page)).toHaveAttribute("data-map-load", "ready", { timeout: 30_000 });
    await page.waitForTimeout(4_000);
    const dir = join("test-results", "probe-blocks", `explore-${theme}`);
    mkdirSync(dir, { recursive: true });
    const { blocks, png } = await blocksOf(page);
    writeFileSync(join(dir, "explore.png"), png);
    console.log(`\n### Explore ${theme} blocks: ${JSON.stringify(blocks)}`);
    for (const block of blocks.slice(0, 4)) {
      await report(page, `Explore ${theme} block ${block.colour}`, block.x + Math.round(block.width / 2), block.y + Math.round(block.height / 2));
    }
  });

  test(`probe ride Menu block (${theme})`, async ({ page }) => {
    test.setTimeout(180_000);
    await setTheme(page, theme);
    await startRide(page);
    await openRideSheet(page);
    await page.waitForTimeout(3_000);
    const dir = join("test-results", "probe-blocks", `ride-${theme}`);
    mkdirSync(dir, { recursive: true });
    const { blocks, png } = await blocksOf(page);
    writeFileSync(join(dir, "ride.png"), png);
    console.log(`\n### Ride ${theme} blocks: ${JSON.stringify(blocks)}`);
    for (const block of blocks.slice(0, 4)) {
      await report(page, `Ride ${theme} block ${block.colour}`, block.x + Math.round(block.width / 2), block.y + Math.round(block.height / 2));
    }
  });
}
