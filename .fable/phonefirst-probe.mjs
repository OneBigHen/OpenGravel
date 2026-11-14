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
  const m = window.__map; if (!m) return { err: "no map captured" };
  const layers = m.getStyle().layers;
  const idx = (id) => layers.findIndex((l) => l.id === id);
  const first = layers.findIndex((l) => l.id.startsWith("ogv-route"));
  const sel = idx("ogv-route-selected");
  const above = layers.slice(sel + 1).filter((l) => !l.id.startsWith("ogv-")).map((l) => `${l.id}(${l.type})`);
  const ours = layers.filter((l) => l.id.startsWith("ogv-")).map((l) => l.id);
  // what is rendered at the middle of the selected line?
  const feats = m.queryRenderedFeatures(undefined, { layers: ["ogv-route-selected"] });
  let at = null;
  if (feats.length) {
    let mid = feats[0].geometry.coordinates; while (Array.isArray(mid) && Array.isArray(mid[0])) mid = mid[Math.floor(mid.length / 2)];
    const px = m.project(mid);
    at = m.queryRenderedFeatures([[px.x - 3, px.y - 3], [px.x + 3, px.y + 3]]).map((f) => `${f.layer.id}:${f.layer.type}:${JSON.stringify(f.layer.paint?.["line-color"] ?? "").slice(0, 60)}:${f.properties?.class ?? f.properties?.state ?? ""}`);
  }
  return { zoom: m.getZoom().toFixed(2), total: layers.length, firstOurs: first, selectedIndex: sel, basemapLayersAboveSelected: above.slice(0, 60), ours, renderedAtLineMiddle: at };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
