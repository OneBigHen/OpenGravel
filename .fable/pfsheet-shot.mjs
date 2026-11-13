// PF-2 / PF-4 proof: peek, half, compare and drag-to-peek on a phone, with sheet numbers and
// where the ride's two ends land on screen.
//   PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node .fable/pfsheet-shot.mjs BASE OUTDIR TAG WIDTH HEIGHT day|night map|satellite
// Writes OUTDIR/TAG-<w>-<theme>-<look>-{half,peek,compare,dragged}.png and prints one JSON line per shot:
//   sheet box, Start box, sliced rows, clear-map band, and for the ride's first/last coordinate
//   (and every alternative's box) the distance to the top chrome, the sheet, the left edge and the button column.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const [base, out, tag, w = "390", h = "844", theme = "day", look = "map"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const W = +w, H = +h;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  colorScheme: theme === "night" ? "dark" : "light",
  geolocation: { latitude: 40.1746, longitude: -74.9227 }, permissions: ["geolocation"], locale: "en-US", timezoneId: "America/New_York" });
await ctx.addInitScript(([t, l]) => {
  try { localStorage.setItem("og-appearance", t); localStorage.setItem("opengravel-basemap-look", l); localStorage.setItem("opengravel-vnext-satellite", l === "satellite" ? "1" : "0"); } catch {}
  Object.defineProperty(Object.prototype, "painter", { configurable: true, set(v) { Object.defineProperty(this, "painter", { value: v, writable: true, configurable: true, enumerable: true }); if (typeof this.getStyle === "function") window.__map = this; } });
}, [theme, look]);
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 160)));

async function measure() {
  return p.evaluate(() => {
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); if (!b.width || !b.height) return null; const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return null; return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) }; };
    const q = (id) => document.querySelector(`[data-testid="${id}"]`);
    const sheet = q("planner-sheet");
    const sb = r(sheet);
    const inside = (e) => { const x = r(e); return !!x && !!sb && x.top >= sb.top - 1 && x.bottom <= sb.bottom + 1; };
    const start = q("start-ride");
    const rows = [...document.querySelectorAll('[data-testid="phone-alternatives"] > *')];
    const sliced = [];
    if (sb) for (const e of sheet.querySelectorAll(".og-sheet__body *")) {
      const x = r(e); if (!x) continue;
      if (!e.textContent?.trim() || e.children.length > 0) continue;
      if (x.top < sb.bottom - 1 && x.bottom > sb.bottom + 1) sliced.push(e.textContent.trim().slice(0, 30));
    }
    // Top chrome: the lowest bottom edge of the wide things in the top half.
    let chromeBottom = 0;
    for (const id of ["top-search", "trip-card", "route-context-row", "places-control"]) { const x = r(q(id)); if (x && x.top < innerHeight / 2) chromeBottom = Math.max(chromeBottom, x.bottom); }
    // Button column: the leftmost edge of the map's own buttons on the right.
    let column = innerWidth;
    for (const e of document.querySelectorAll('[data-testid="map-layers"] button, [data-testid="map-layers-toggle"], [data-testid="map-dimension"], [data-testid="map-locate-me"], [data-testid="show-whole-ride"], [data-testid="map-satellite-toggle"]')) { const x = r(e); if (x && x.left > innerWidth / 2 && x.top < (sb?.top ?? innerHeight)) column = Math.min(column, x.left); }
    const sheetTop = sb?.top ?? innerHeight;
    const m = window.__map;
    let ends = null, alts = null;
    if (m) {
      const flat = (c) => (Array.isArray(c[0]) ? c.flatMap(flat) : [c]);
      const data = m.getStyle().sources["ogv-routes"]?.data;
      const lines = new Map();
      for (const feature of data?.features ?? []) {
        const st = feature.properties?.state; if (st !== "selected" && st !== "alternative") continue;
        if (feature.geometry?.type !== "LineString" || lines.has(feature.properties.id)) continue;
        lines.set(feature.properties.id, { id: feature.properties.id, state: st, geometry: feature.geometry.coordinates.map(([lon, lat]) => ({ lon, lat })) });
      }
      const routes = [...lines.values()];
      const gap = (pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y), fromTop: Math.round(pt.y - chromeBottom), fromSheet: Math.round(sheetTop - pt.y), fromLeft: Math.round(pt.x), fromColumn: Math.round(column - pt.x) });
      const selected = routes.find((route) => route.state === "selected");
      if (selected && selected.geometry?.length >= 2) {
        const a = selected.geometry[0], z = selected.geometry.at(-1);
        ends = { first: gap(m.project([a.lon, a.lat])), last: gap(m.project([z.lon, z.lat])) };
      }
      alts = routes.filter((route) => route.geometry?.length >= 2).map((route) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of route.geometry) { const pt = m.project([c.lon, c.lat]); minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x); minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y); }
        return { id: String(route.id).slice(-6), state: route.state, inBand: minY >= chromeBottom && maxY <= sheetTop && minX >= 0 && maxX <= column, box: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)] };
      });
    }
    return { detent: sheet?.dataset.detent, comparing: !!document.querySelector('.og-phone-summary[data-comparing="true"]'), vh: innerHeight, sheet: sb, sheetTopPct: sb ? Math.round((sb.top / innerHeight) * 100) : null,
      chromeBottom, column, clearMapPct: Math.round(((sheetTop - chromeBottom) / innerHeight) * 100),
      start: r(start), startInside: inside(start), handle: r(q("sheet-handle")), compareBtn: r(q("compare-rides")),
      rows: rows.length, rowsInside: rows.filter(inside).length, sliced: sliced.slice(0, 8), legendShown: !!q("map-legend"), ends, alts };
  });
}
async function shot(name) {
  const m = await measure().catch((e) => ({ err: e.message.slice(0, 120) }));
  await p.screenshot({ path: `${out}/${tag}-${W}-${theme}-${look}-${name}.png` });
  console.log(JSON.stringify({ shot: `${tag}-${W}-${theme}-${look}-${name}`, ...m }));
}

await p.goto(base + "/", { waitUntil: "load", timeout: 90000 }).catch(() => {});
await p.waitForTimeout(7000);
const f = p.getByTestId("top-place-search");
await f.fill("Reading Terminal Market", { force: true }); await f.press("Enter");
await p.getByTestId("place-sheet").waitFor({ timeout: 30000 });
await p.waitForTimeout(1500);
await p.getByTestId("place-directions").click();
await p.getByTestId("start-ride").waitFor({ timeout: 60000 });
await p.waitForTimeout(16000);
await shot("half");
await p.getByTestId("sheet-handle").press("ArrowDown").catch(() => {});
await p.waitForTimeout(2000);
await shot("peek");
await p.getByTestId("sheet-handle").press("ArrowUp").catch(() => {});
await p.waitForTimeout(2000);
await p.getByTestId("compare-rides").click({ timeout: 8000 }).catch((e) => console.log("no compare", e.message.slice(0, 60)));
await p.waitForTimeout(2500);
await shot("compare");
await p.getByTestId("compare-rides").click({ timeout: 8000 }).catch(() => {});
await p.waitForTimeout(1500);
// Drag the map 80px at half: the sheet should drop to peek (PF-2 check 5).
const mapBox = await p.getByTestId("planner-map").boundingBox();
const sx = mapBox.x + mapBox.width / 2, sy = Math.round(H * 0.3);
const t0 = Date.now();
const cdp = await ctx.newCDPSession(p);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy }] });
for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx, y: sy + i * 10 }] }); await p.waitForTimeout(16); }
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
let detent = null;
for (let i = 0; i < 40; i++) { detent = await p.getByTestId("planner-sheet").getAttribute("data-detent"); if (detent === "peek") break; await p.waitForTimeout(25); }
console.log(JSON.stringify({ drag: { detent, ms: Date.now() - t0 } }));
await p.waitForTimeout(1200);
await shot("dragged");
await b.close();
