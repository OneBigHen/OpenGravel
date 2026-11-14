/**
 * TEMPORARY probe 2 (QA lane B, QA-15/17): the Explore map panel's element stack.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE || "https://opengravel.henning.rodeo";
const OUT = process.env.QA_OUT || "probe-out";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  colorScheme: "dark",
  timezoneId: "America/New_York",
  geolocation: { latitude: 40.1746, longitude: -75.1066, accuracy: 5 },
  permissions: ["geolocation"],
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);
fs.mkdirSync(path.join(OUT, "explore-stack"), { recursive: true });
await page.goto(BASE + "/explore", { waitUntil: "load", timeout: 60_000 });
await page.waitForTimeout(9000);
await page.screenshot({ path: path.join(OUT, "explore-stack", "shot.png") });

const info = await page.evaluate(() => {
  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      at: `${element.tagName.toLowerCase()}${element.id ? "#" + element.id : ""}${typeof element.className === "string" && element.className ? "." + element.className.trim().replace(/\s+/g, ".") : ""}`,
      rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      background: style.backgroundColor,
      backgroundImage: style.backgroundImage.slice(0, 80),
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      position: style.position,
      zIndex: style.zIndex,
      overflow: style.overflow,
    };
  };
  const point = (x, y) => [...document.elementsFromPoint(x, y)].slice(0, 12).map(describe);
  const covering = (x, y) => {
    const out = [];
    for (const element of document.querySelectorAll("*")) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 30 || rect.height < 10) continue;
      if (!(x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) continue;
      const style = getComputedStyle(element);
      if (style.backgroundColor === "rgba(0, 0, 0, 0)" && style.backgroundImage === "none") continue;
      out.push(describe(element));
    }
    return out;
  };
  const panel = document.querySelector(".og-explore-map");
  const host = document.querySelector(".og-map-host");
  const map = document.querySelector(".og-map");
  const canvas = document.querySelector("canvas.maplibregl-canvas");
  const container = document.querySelector(".maplibregl-canvas-container");
  const box = (element) => element === null ? null : (() => {
    const r = element.getBoundingClientRect();
    return { rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`, scrollTop: element.scrollTop, offsetTop: element.offsetTop };
  })();
  return {
    scrollY: window.scrollY,
    documentHeight: document.documentElement.scrollHeight,
    panel: box(panel), host: box(host), map: box(map), container: box(container),
    canvasBuffer: canvas === null ? null : `${canvas.width}x${canvas.height}`,
    mapAttrs: map === null ? null : { load: map.getAttribute("data-map-load"), painted: map.getAttribute("data-map-painted") },
    hit250x700: point(250, 700),
    covering250x700: covering(250, 700),
    hit100x700: point(100, 700),
    hit195x660: point(195, 660),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
process.exit(0);
