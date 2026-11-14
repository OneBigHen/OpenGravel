/**
 * TEMPORARY probe (QA lane B, QA-15/17): what paints the flat block over the map?
 *
 * Runs against production, real basemap, phone viewport. Finds flat rectangles in
 * the screenshot, then logs every element that covers the block — including the
 * ones `elementsFromPoint` cannot see (pointer-events:none, below another layer)
 * — and whether the block survives a forced repaint.
 *
 * Not a test. Delete before the PR.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const BASE = process.env.QA_BASE || "https://opengravel.henning.rodeo";
const OUT = process.env.QA_OUT || "probe-out";

async function blocks(page) {
  const png = await page.screenshot();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const dpr = info.width / page.viewportSize().width;
  const pixel = (x, y) => {
    const at = (y * info.width + x) * info.channels;
    return `${data[at]},${data[at + 1]},${data[at + 2]}`;
  };
  const rows = [];
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
  const out = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last !== undefined && last.colour === row.colour && row.y - last.y1 <= 4) {
      last.y1 = row.y;
      continue;
    }
    out.push({ y0: row.y, y1: row.y, colour: row.colour, x0: row.x0, x1: row.x1 });
  }
  return {
    png,
    dpr,
    blocks: out
      .filter((b) => b.y1 - b.y0 >= 30 && b.x1 - b.x0 >= 150)
      .map((b) => ({
        colour: b.colour,
        x: Math.round(b.x0 / dpr),
        y: Math.round(b.y0 / dpr),
        width: Math.round((b.x1 - b.x0) / dpr),
        height: Math.round((b.y1 - b.y0) / dpr),
      })),
  };
}

async function report(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const describe = (element) => {
      const node = element;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        at: `${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}${typeof node.className === "string" && node.className ? "." + node.className.trim().replace(/\s+/g, ".") : ""}`,
        rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        background: style.backgroundColor,
        backgroundImage: style.backgroundImage.slice(0, 90),
        opacity: style.opacity,
        filter: style.filter,
        pointerEvents: style.pointerEvents,
        position: style.position,
        zIndex: style.zIndex,
        transform: style.transform,
        visibility: style.visibility,
        display: style.display,
      };
    };
    const hit = [...document.elementsFromPoint(x, y)].slice(0, 14).map(describe);
    // Everything whose box contains the point, even when it is not hit-testable.
    const covering = [];
    for (const element of document.querySelectorAll("*")) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 30 || rect.height < 10) continue;
      if (!(x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) continue;
      const style = getComputedStyle(element);
      const opaque = style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.backgroundImage !== "none";
      if (!opaque) continue;
      covering.push(describe(element));
    }
    const canvases = [...document.querySelectorAll("canvas")].map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      let gl = null;
      try {
        gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      } catch { /* ignore */ }
      let readback = null;
      let clear = null;
      if (gl !== null && gl !== undefined) {
        try {
          clear = [...gl.getParameter(gl.COLOR_CLEAR_VALUE)];
          const pixels = new Uint8Array(4);
          const dx = Math.round((x - rect.left) * (canvas.width / Math.max(1, rect.width)));
          const dy = Math.round((y - rect.top) * (canvas.height / Math.max(1, rect.height)));
          gl.readPixels(dx, canvas.height - dy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          readback = [...pixels];
        } catch (e) { readback = String(e).slice(0, 60); }
      }
      return {
        class: canvas.className,
        rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        buffer: `${canvas.width}x${canvas.height}`,
        parent: canvas.parentElement === null ? "" : canvas.parentElement.className,
        clear,
        readback,
      };
    });
    const mapHost = document.querySelector(".og-map-host");
    return {
      hit,
      covering,
      canvases,
      dpr: window.devicePixelRatio,
      map: mapHost === null ? null : {
        load: mapHost.querySelector(".og-map")?.getAttribute("data-map-load"),
        painted: mapHost.querySelector(".og-map")?.getAttribute("data-map-painted"),
        rect: (() => { const r = mapHost.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; })(),
      },
    };
  }, { x, y });
}

async function probe(label, urlPath, { geo = null, settle = 7000 } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    colorScheme: "dark",
    timezoneId: "America/New_York",
    ...(geo ? { geolocation: { ...geo, accuracy: 5 }, permissions: ["geolocation"] } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const dir = path.join(OUT, label);
  fs.mkdirSync(dir, { recursive: true });
  try {
    await page.goto(BASE + urlPath, { waitUntil: "load", timeout: 60_000 });
  } catch (e) {
    console.log(`### ${label}: goto failed ${String(e).slice(0, 160)}`);
  }
  await page.waitForTimeout(settle);
  const first = await blocks(page);
  fs.writeFileSync(path.join(dir, "before.png"), first.png);
  console.log(`\n### ${label} blocks before: ${JSON.stringify(first.blocks)}`);
  const seen = new Set();
  for (const block of first.blocks.slice(0, 4)) {
    const key = block.colour;
    if (seen.has(key)) continue;
    seen.add(key);
    const x = block.x + Math.round(block.width / 2);
    const y = block.y + Math.round(block.height / 2);
    const info = await report(page, x, y);
    console.log(`### ${label} block ${block.colour} at ${x},${y}:\n${JSON.stringify(info, null, 1)}`);
  }
  // A repaint request: if the block is a stale canvas frame, it goes away.
  await page.evaluate(() => { window.dispatchEvent(new Event("resize")); window.scrollBy(0, 1); window.scrollBy(0, -1); });
  await page.waitForTimeout(1500);
  const after = await blocks(page);
  fs.writeFileSync(path.join(dir, "after.png"), after.png);
  console.log(`### ${label} blocks after repaint: ${JSON.stringify(after.blocks)}`);
  await browser.close();
}

await probe("explore-night", "/explore", { geo: { latitude: 40.1746, longitude: -75.1066 } });
await probe("planner-night", "/", { geo: { latitude: 40.1746, longitude: -75.1066 } });
process.exit(0);
