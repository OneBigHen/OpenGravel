// Probe: which basemap layers are drawn ABOVE the ride line, and what paints the pale stripe inside it.
//   PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node .fable/phonefirst-probe.mjs BASE day|night map|satellite
import { chromium } from "playwright";
const [base, theme = "day", look = "map"] = process.argv.slice(2);
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
await p.waitForTimeout(15000);
const out = await p.evaluate(() => {
  const m = window.__map; const layers = m.getStyle().layers;
  const idx = (id) => layers.findIndex((l) => l.id === id);
  const puck = idx("ogv-rider-heading"), sel = idx("ogv-route-selected");
  return { total: layers.length, puck, sel, afterPuck: layers.slice(puck + 1).map((l) => l.id), symbolsAfterSel: layers.slice(sel + 1).filter((l) => l.type === "symbol").map((l) => l.id + ":" + (l.layout?.["symbol-z-order"] ?? "")) };
});
console.log(JSON.stringify(out));
await b.close();
