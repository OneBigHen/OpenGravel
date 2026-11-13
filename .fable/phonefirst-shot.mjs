// Phone-first audit shots.
//   PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node .fable/phonefirst-shot.mjs BASE OUTDIR TAG WIDTH HEIGHT day|night map|satellite [scenes]
// scenes (comma list): home,place,route,compare,full,layers,loop,explore,ride   (default: all)
// Writes OUTDIR/TAG-<scene>.png and prints one JSON line of layout numbers per shot
// (map share = the tallest band of map not covered by top chrome or the sheet).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const [base, out, tag, w = "440", h = "956", theme = "day", look = "map", only = ""] = process.argv.slice(2);
const want = (s) => !only || only.split(",").includes(s);
mkdirSync(out, { recursive: true });
const W = +w, H = +h;
const b = await chromium.launch();
async function open(where) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    colorScheme: theme === "night" ? "dark" : "light", geolocation: where, permissions: ["geolocation"], locale: "en-US", timezoneId: "America/New_York" });
  await ctx.addInitScript(([t, l]) => { try { localStorage.setItem("og-appearance", t); localStorage.setItem("opengravel-basemap-look", l); localStorage.setItem("opengravel-vnext-satellite", l === "satellite" ? "1" : "0"); } catch {} }, [theme, look]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 160)));
  return { ctx, p };
}
async function settle(p, ms = 3500) { await p.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {}); await p.waitForTimeout(ms); }
async function shot(p, scene) {
  const m = await p.evaluate(() => {
    const vh = innerHeight, vw = innerWidth;
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; const cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none") return null; return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
    const ids = ["top-search", "trip-card", "ride-summary-rides", "planner-sheet", "place-sheet", "map-legend", "map-layers-toggle", "map-dimension", "map-locate-me", "map-compass", "primary-nav", "home-shortcuts", "ride-maneuver", "ride-strip", "ride-rail", "start-ride", "compare-rides", "sheet-handle", "map-layers"];
    const boxes = {}; for (const id of ids) { const v = box(`[data-testid="${id}"]`); if (v) boxes[id] = v; }
    const glance = box(".og-map-glance") || box('[class*="glance"]'); if (glance) boxes.glance = glance;
    // top chrome bottom = lowest bottom edge among things anchored in the top 45% that span > 55% width
    let top = 0, bottom = vh;
    for (const [k, v] of Object.entries(boxes)) { const [x, y, ww, hh] = v; if (ww < vw * 0.55) continue; if (y + hh < vh * 0.5) top = Math.max(top, y + hh); else if (y > vh * 0.25) bottom = Math.min(bottom, y); }
    const small = [...document.querySelectorAll("button, a, [role=button], input, summary")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < vh && r.bottom > 0 && (r.width < 44 || r.height < 44); }).map((e) => `${(e.getAttribute("data-testid") || e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    return { theme: document.documentElement.dataset.theme, detent: document.querySelector('[data-testid="planner-sheet"]')?.dataset.detent, clearMapPct: Math.round(((bottom - top) / vh) * 100), mapAboveSheetPct: Math.round((bottom / vh) * 100), boxes, under44: small.slice(0, 14) };
  }).catch((e) => ({ err: e.message.slice(0, 80) }));
  const path = `${out}/${tag}-${scene}.png`;
  await p.screenshot({ path });
  console.log(JSON.stringify({ shot: `${tag}-${scene}`, ...m }));
}
const LANGHORNE = { latitude: 40.1746, longitude: -74.9227 };
const ROTHROCK = { latitude: 40.72, longitude: -77.89 };

// City scene: home → search → place card → directions → compare → full → layers → ride
if (["home", "place", "route", "compare", "full", "ride"].some(want)) {
  const { ctx, p } = await open(LANGHORNE);
  await p.goto(base + "/", { waitUntil: "load", timeout: 90000 }).catch(() => {});
  await settle(p, 6000);
  if (want("home")) await shot(p, "1-home");
  if (["place", "route", "compare", "full", "ride"].some(want)) {
    const f = p.getByTestId("top-place-search"); await f.fill("Reading Terminal Market"); await p.waitForTimeout(1800);
    if (want("place")) await shot(p, "2-search");
    await f.press("Enter");
    await p.getByTestId("place-sheet").waitFor({ timeout: 30000 }).catch((e) => console.log("no place sheet"));
    await settle(p, 2500);
    if (want("place")) await shot(p, "3-place");
    await p.getByTestId("place-directions").click().catch((e) => console.log("no directions"));
    await p.getByTestId("start-ride").waitFor({ timeout: 60000 }).catch(() => console.log("no start-ride"));
    await p.waitForTimeout(3000);
    if (want("route")) await shot(p, "4-route-early");
    await p.waitForTimeout(20000);
    if (want("route")) await shot(p, "4-route");
    if (want("compare")) {
      await p.getByTestId("compare-rides").click({ timeout: 8000 }).catch((e) => console.log("no compare", e.message.slice(0, 60)));
      await p.waitForTimeout(2500); await shot(p, "5-compare");
      const back = p.getByText("Back to ride").first(); if (await back.isVisible().catch(() => false)) await back.click().catch(() => {});
      await p.waitForTimeout(800);
    }
    if (want("full")) {
      await p.getByTestId("route-options-settings").click({ timeout: 8000 }).catch((e) => console.log("no options", e.message.slice(0, 60)));
      await p.waitForTimeout(2000); await shot(p, "6-full");
      await p.getByTestId("sheet-handle").click().catch(() => {}); await p.waitForTimeout(1000);
      await shot(p, "6-after-handle");
    }
    if (want("ride")) {
      await p.getByTestId("start-ride").click({ timeout: 8000 }).catch((e) => console.log("no start", e.message.slice(0, 60)));
      await p.waitForTimeout(12000); await shot(p, "9-ride");
      await p.getByTestId("ride-more").click({ timeout: 6000 }).catch((e) => console.log("no ride-more", e.message.slice(0, 60)));
      await p.waitForTimeout(1500); await shot(p, "9-ride-menu");
    }
  }
  await ctx.close();
}
// Layers sheet, on its own page so it cannot block the search.
if (want("layers")) {
  const { ctx, p } = await open(LANGHORNE);
  await p.goto(base + "/", { waitUntil: "load", timeout: 90000 }).catch(() => {});
  await settle(p, 6000);
  await p.getByTestId("map-layers-toggle").click({ timeout: 8000 }).catch((e) => console.log("no layers", e.message.slice(0, 60)));
  await p.waitForTimeout(1500); await shot(p, "8-layers");
  await ctx.close();
}
// Country scene: one-tap loop
if (want("loop")) {
  const { ctx, p } = await open(ROTHROCK);
  await p.goto(base + "/", { waitUntil: "load", timeout: 90000 }).catch(() => {});
  await settle(p, 6000);
  await shot(p, "1-home-country");
  await p.getByTestId("loop-near-me").click({ timeout: 10000 }).catch(async () => { await p.getByRole("button", { name: /^Loop/ }).first().click().catch((e) => console.log("no loop pill")); });
  await p.waitForTimeout(2500); await shot(p, "7-loop-setup");
  const create = p.getByTestId("compose-create"); if (await create.isVisible().catch(() => false)) await create.click().catch(() => {});
  await p.getByTestId("start-ride").waitFor({ timeout: 60000 }).catch(() => console.log("no start-ride (loop)"));
  await p.waitForTimeout(22000); await shot(p, "7-loop");
  await p.getByTestId("compare-rides").click({ timeout: 8000 }).catch((e) => console.log("no compare (loop)"));
  await p.waitForTimeout(2500); await shot(p, "7-loop-compare");
  await ctx.close();
}
if (want("explore")) {
  const { ctx, p } = await open(ROTHROCK);
  await p.goto(base + "/explore", { waitUntil: "load", timeout: 90000 }).catch(() => {});
  await settle(p, 5000); await shot(p, "10-explore");
  await ctx.close();
}
await b.close();
