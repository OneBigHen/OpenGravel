// #221 ship check: half and Compare shots on a phone, with sheet numbers and a ride-line pixel test.
//   PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node .fable/pf221-shot.mjs BASE OUTDIR TAG WIDTH HEIGHT map|satellite
// Writes OUTDIR/TAG-<w>-<look>-{half,compare}.png and prints one JSON line per shot:
//   sheet box, peek/half heights, whether Start and every Compare row fit inside the sheet,
//   rows sliced by the sheet's bottom edge, and the colour at the middle of the ride line.
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
const [base, out, tag, w = "390", h = "844", look = "map"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const W = +w, H = +h, DPR = 2;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: DPR, colorScheme: "light",
  geolocation: { latitude: 40.1746, longitude: -74.9227 }, permissions: ["geolocation"], locale: "en-US", timezoneId: "America/New_York" });
await ctx.addInitScript((l) => {
  try { localStorage.setItem("og-appearance", "day"); localStorage.setItem("opengravel-basemap-look", l); localStorage.setItem("opengravel-vnext-satellite", l === "satellite" ? "1" : "0"); } catch {}
  Object.defineProperty(Object.prototype, "painter", { configurable: true, set(v) { Object.defineProperty(this, "painter", { value: v, writable: true, configurable: true, enumerable: true }); if (typeof this.getStyle === "function") window.__map = this; } });
}, look);
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 160)));

async function measure() {
  return p.evaluate(() => {
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); if (!b.width || !b.height) return null; return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    const sheet = document.querySelector('[data-testid="planner-sheet"]');
    const sb = r(sheet);
    const inside = (e) => { const x = r(e); return !!x && !!sb && x.top >= sb.top - 1 && x.bottom <= sb.bottom + 1; };
    const start = document.querySelector('[data-testid="start-ride"]');
    const rows = [...document.querySelectorAll('[data-testid="phone-alternatives"] > *')];
    // Every visible leaf-ish block in the sheet body whose box crosses the sheet's bottom edge.
    const sliced = [];
    if (sb) for (const e of sheet.querySelectorAll(".og-sheet__body *")) {
      const x = r(e); if (!x) continue; const cs = getComputedStyle(e); if (cs.visibility === "hidden") continue;
      if (!e.textContent?.trim() || e.children.length > 0) continue;
      if (x.top < sb.bottom - 1 && x.bottom > sb.bottom + 1) sliced.push(e.textContent.trim().slice(0, 30));
    }
    const tc = r(document.querySelector('[data-testid="trip-card"]')); const bx = (id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    const inp = r(document.querySelector('[data-testid="top-place-search"]')); const bar = r(document.querySelector('.og-top-search__bar'));
    const clear = sb && tc ? Math.round(100 * (sb.top - tc.bottom) / innerHeight) : null;
    const legend = document.querySelector('[data-testid="map-legend"]');
    const cmp = document.querySelector('[data-testid="compare-rides"]');
    const bars = rows.map((row) => { const bar = row.querySelector(".og-phone-choice__swatch"); return bar ? getComputedStyle(bar).backgroundColor : null; });
    const m = window.__map; let mid = null;
    if (m) {
      const f = m.queryRenderedFeatures(undefined, { layers: ["ogv-route-selected"] });
      // A vertex of the drawn line in the clear map band (under no chrome), nearest the band's middle.
      const lo = 320, hi = (sb?.top ?? innerHeight) - 40, want = (lo + hi) / 2;
      const flat = (c) => (Array.isArray(c[0]) ? c.flatMap(flat) : [c]);
      let best = Infinity;
      for (const feature of f) for (const c of flat(feature.geometry.coordinates)) {
        const px = m.project(c); if (px.y < lo || px.y > hi || px.x < 40 || px.x > innerWidth - 90) continue;
        const d = Math.abs(px.y - want); if (d < best) { best = d; mid = [px.x, px.y]; }
      }
    }
    let above = null;
    if (m) { const L = m.getStyle().layers; const i = L.findIndex((l) => l.id === "ogv-route-selected"); above = L.slice(i + 1).filter((l) => !l.id.startsWith("ogv-") && (l.type === "line" || l.type === "fill")).map((l) => l.id); }
    return { detent: sheet?.dataset.detent, view: sheet?.dataset.sheetView, sheet: sb, vh: innerHeight,
      start: r(start), startInside: inside(start), compareBtn: r(cmp), rows: rows.length, rowsInside: rows.filter(inside).length, rowBars: bars,
      sliced: sliced.slice(0, 8), tripCard: tc, clearMapPct: clear, swap: bx("trip-swap"), close: bx("trip-close"), ctxRow: !!r(document.querySelector('[data-testid="route-context-row"]')), chip: document.querySelector('[data-testid="route-context"]')?.textContent, searchInput: inp, searchBar: bar, tags: (window.__map ? window.__map.querySourceFeatures?.("ogv-routes")?.filter((f)=>f.properties.label).map((f)=>f.properties.label) : null), legendShown: !!r(legend), linesAboveRide: above, lineMid: mid };
  });
}
async function pixel(buf, at) {
  if (!at) return null;
  const x = Math.round(at[0] * DPR) - 2, y = Math.round(at[1] * DPR) - 2;
  const { data } = await sharp(buf).extract({ left: Math.max(0, x), top: Math.max(0, y), width: 5, height: 5 }).raw().toBuffer({ resolveWithObject: true });
  const ch = data.length / 25; let rr = 0, gg = 0, bb = 0; for (let i = 0; i < 25; i++) { rr += data[i * ch]; gg += data[i * ch + 1]; bb += data[i * ch + 2]; }
  return "#" + [rr, gg, bb].map((v) => Math.round(v / 25).toString(16).padStart(2, "0")).join("");
}
async function shot(name) {
  const m = await measure().catch((e) => ({ err: e.message.slice(0, 80) }));
  const path = `${out}/${tag}-${W}-${look}-${name}.png`;
  const buf = await p.screenshot({ path });
  console.log(JSON.stringify({ shot: `${tag}-${W}-${look}-${name}`, lineMidColour: await pixel(buf, m.lineMid).catch(() => null), ...m }));
}

await p.goto(base + "/", { waitUntil: "load", timeout: 90000 }).catch(() => {});
await p.waitForTimeout(7000);
await shot("home");
const f = p.getByTestId("top-place-search"); // A long weather alert can squeeze the field to 0px at 320 wide; type into it anyway.
await f.fill("Reading Terminal Market", { force: true }); await f.press("Enter");
await p.getByTestId("place-sheet").waitFor({ timeout: 30000 });
await p.waitForTimeout(1500);
await p.getByTestId("place-directions").click();
await p.getByTestId("start-ride").waitFor({ timeout: 60000 });
await p.waitForTimeout(18000);
await shot("half");
await p.getByTestId("compare-rides").click({ timeout: 8000 }).catch((e) => console.log("no compare", e.message.slice(0, 60)));
await p.waitForTimeout(2500);
await shot("compare");
await b.close();
