// Ride screen with a moving GPS fix (the plain shot script only gets "No GPS fix").
//   PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node .fable/phonefirst-ride.mjs BASE OUTDIR TAG WIDTH HEIGHT day|night
import { chromium } from "playwright";
const [base, out, tag, w = "440", h = "956", theme = "day"] = process.argv.slice(2);
const b = await chromium.launch();
const start = { latitude: 40.1746, longitude: -74.9227, accuracy: 5 };
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: theme === "night" ? "dark" : "light",
  geolocation: start, permissions: ["geolocation"], timezoneId: "America/New_York" });
await ctx.addInitScript(([t]) => {
  try { localStorage.setItem("og-appearance", t); } catch {}
  Object.defineProperty(Object.prototype, "painter", { configurable: true, set(v) { Object.defineProperty(this, "painter", { value: v, writable: true, configurable: true, enumerable: true }); if (typeof this.getStyle === "function") (window.__maps ??= []).push(this); } });
}, [theme]);
const p = await ctx.newPage();
await p.goto(base + "/", { waitUntil: "load", timeout: 90000 }).catch(() => {});
await p.waitForTimeout(7000);
const f = p.getByTestId("top-place-search"); await f.fill("Reading Terminal Market"); await f.press("Enter");
await p.getByTestId("place-sheet").waitFor({ timeout: 30000 });
await p.getByTestId("place-directions").click();
await p.getByTestId("start-ride").waitFor({ timeout: 60000 });
await p.waitForTimeout(12000);
const line = await p.evaluate(() => {
  for (const m of window.__maps ?? []) {
    try { const feats = m.querySourceFeatures("ogv-routes").filter((f) => f.properties?.state === "selected" && f.geometry.type === "LineString"); if (feats.length) return feats.sort((a, b) => b.geometry.coordinates.length - a.geometry.coordinates.length)[0].geometry.coordinates; } catch {}
  }
  return null;
});
console.log("line points", line?.length ?? 0);
await p.getByTestId("start-ride").click();
await p.waitForTimeout(4000);
// walk the line: densify to ~15 m steps, one fix per 700 ms
const pts = [];
if (line) for (let i = 0; i + 1 < line.length && pts.length < 400; i++) { const [x1, y1] = line[i], [x2, y2] = line[i + 1]; const d = Math.hypot((x2 - x1) * 85000, (y2 - y1) * 111000); const n = Math.max(1, Math.round(d / 15)); for (let k = 0; k < n; k++) pts.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]); }
const shots = { 20: "a", 60: "b", 110: "c" };
for (let i = 0; i < Math.min(pts.length, 115); i++) {
  await ctx.setGeolocation({ longitude: pts[i][0], latitude: pts[i][1], accuracy: 5 });
  await p.waitForTimeout(700);
  if (shots[i]) { await p.screenshot({ path: `${out}/${tag}-ride-${shots[i]}.png` }); console.log("shot", shots[i], await p.getByTestId("ride-maneuver").innerText().catch(() => "?")); }
}
const diag = await p.evaluate(() => { const m = (window.__maps ?? []).at(-1); const L = m.getStyle().layers; const puck = L.findIndex((l) => l.id === "ogv-rider-heading"); const c = m.getCenter(); const px = m.project(c);
  const hit = m.queryRenderedFeatures([[px.x - 20, px.y - 20], [px.x + 20, px.y + 20]]).map((f) => f.layer.id);
  return { puck, total: L.length, afterPuck: L.slice(puck + 1).map((l) => l.id), puckLayout: L[puck]?.layout, centerPx: [px.x, px.y], hit: [...new Set(hit)] }; });
console.log(JSON.stringify(diag));
await b.close();
