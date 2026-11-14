// Proof for PF-1: the ride line is drawn UNDER the basemap's roads today. This lifts the ogv-route line layers
// above the last basemap road layer in the live page (no source change) and shoots before/after.
//   PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node .fable/phonefirst-linefix.mjs BASE OUTDIR day|night map|satellite
import { chromium } from "playwright";
const [base, out, theme = "day", look = "map"] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: theme === "night" ? "dark" : "light",
  geolocation: { latitude: 40.1746, longitude: -74.9227 }, permissions: ["geolocation"], timezoneId: "America/New_York" });
await ctx.addInitScript(([t, l]) => {
  try { localStorage.setItem("og-appearance", t); localStorage.setItem("opengravel-basemap-look", l); localStorage.setItem("opengravel-vnext-satellite", l === "satellite" ? "1" : "0"); } catch {}
  Object.defineProperty(Object.prototype, "painter", { configurable: true, set(v) { Object.defineProperty(this, "painter", { value: v, writable: true, configurable: true, enumerable: true }); if (typeof this.getStyle === "function") window.__map = this; } });
}, [theme, look]);
const p = await ctx.newPage();
await p.goto(base + "/", { waitUntil: "load", timeout: 90000 }).catch(() => {});
await p.waitForTimeout(7000);
const f = p.getByTestId("top-place-search"); await f.fill("Reading Terminal Market"); await f.press("Enter");
await p.getByTestId("place-sheet").waitFor({ timeout: 30000 });
await p.getByTestId("place-directions").click();
await p.getByTestId("start-ride").waitFor({ timeout: 60000 });
await p.waitForTimeout(16000);
await p.screenshot({ path: `${out}/linefix-${theme}-${look}-before.png` });
const info = await p.evaluate(() => {
  const m = window.__map; if (!m) return "no map";
  const layers = m.getStyle().layers;
  let lastRoad = -1;
  layers.forEach((l, i) => { if (!l.id.startsWith("ogv-") && l.type === "line" && /^(road|bridge|tunnel)-/.test(l.id)) lastRoad = i; });
  const anchor = layers.slice(lastRoad + 1).find((l) => l.type === "symbol" && !l.id.startsWith("ogv-"))?.id;
  const ours = layers.filter((l) => /^ogv-route-/.test(l.id) && l.type === "line").map((l) => l.id);
  for (const id of ours) m.moveLayer(id, anchor);
  return { lastRoad: layers[lastRoad]?.id, anchor, moved: ours.length };
});
console.log(JSON.stringify(info));
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/linefix-${theme}-${look}-after.png` });
await b.close();
