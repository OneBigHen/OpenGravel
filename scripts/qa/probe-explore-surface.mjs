/**
 * TEMPORARY probe 3 (QA lane B, QA-15/17): is the black block in the page surface?
 *
 * Same Explore page, four captures of the map panel:
 *  A. an ordinary Playwright screenshot (the compositor surface),
 *  B. a CDP screenshot with fromSurface:false (the renderer's own frame),
 *  C. after scrolling the panel fully into view,
 *  D. two seconds later, untouched.
 * If B shows the map and A does not, the block is a screenshot-surface artefact,
 * not something the page draws.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

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
const dir = path.join(OUT, "explore-surface");
fs.mkdirSync(dir, { recursive: true });
await page.goto(BASE + "/explore", { waitUntil: "load", timeout: 60_000 });
await page.waitForTimeout(9000);

const panel = await page.evaluate(() => {
  const element = document.querySelector(".og-explore-map");
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
});
console.log(`### panel: ${JSON.stringify(panel)}`);

async function blackShare(buffer, clip) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let black = 0;
  let total = 0;
  for (let y = clip.y; y < Math.min(clip.y + clip.height, info.height); y += 2) {
    for (let x = clip.x; x < Math.min(clip.x + clip.width, info.width); x += 2) {
      const at = (y * info.width + x) * info.channels;
      total += 1;
      if (data[at] === 0 && data[at + 1] === 0 && data[at + 2] === 0) black += 1;
    }
  }
  return total === 0 ? "0%" : `${Math.round((black / total) * 100)}% black`;
}

const clipDevice = panel === null ? { x: 0, y: 0, width: 1, height: 1 } : { x: panel.x * 2, y: panel.y * 2, width: panel.width * 2, height: panel.height * 2 };

const shotA = await page.screenshot();
fs.writeFileSync(path.join(dir, "A-playwright.png"), shotA);
console.log(`### A playwright screenshot: ${await blackShare(shotA, clipDevice)}`);

const cdp = await context.newCDPSession(page);
const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: false });
const shotB = Buffer.from(data, "base64");
fs.writeFileSync(path.join(dir, "B-fromsurface-false.png"), shotB);
console.log(`### B fromSurface:false: ${await blackShare(shotB, clipDevice)}`);

await page.evaluate(() => document.querySelector(".og-explore-map")?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(1500);
const shotC = await page.screenshot();
fs.writeFileSync(path.join(dir, "C-scrolled.png"), shotC);
const panelC = await page.evaluate(() => {
  const element = document.querySelector(".og-explore-map");
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
});
console.log(`### C scrolled, panel ${JSON.stringify(panelC)}: ${panelC === null ? "n/a" : await blackShare(shotC, { x: panelC.x * 2, y: panelC.y * 2, width: panelC.width * 2, height: panelC.height * 2 })}`);

await page.waitForTimeout(2000);
const shotD = await page.screenshot();
fs.writeFileSync(path.join(dir, "D-later.png"), shotD);
console.log(`### D two seconds later: ${panelC === null ? "n/a" : await blackShare(shotD, { x: panelC.x * 2, y: panelC.y * 2, width: panelC.width * 2, height: panelC.height * 2 })}`);

await browser.close();
process.exit(0);
