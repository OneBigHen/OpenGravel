// Does home centre on the rider? Shoots home at 8 s and 25 s, then after tapping locate.
//   node .fable/phonefirst-homecheck.mjs BASE OUTDIR TAG
import { chromium } from "playwright";
const [base, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, geolocation: { latitude: 40.1746, longitude: -74.9227, accuracy: 5 }, permissions: ["geolocation"], timezoneId: "America/New_York" });
await ctx.addInitScript(() => { try { localStorage.setItem("og-appearance", "day"); } catch {}
  Object.defineProperty(Object.prototype, "painter", { configurable: true, set(v) { Object.defineProperty(this, "painter", { value: v, writable: true, configurable: true, enumerable: true }); if (typeof this.getStyle === "function") window.__map = this; } }); });
const p = await ctx.newPage();
await p.goto(base + "/", { waitUntil: "load", timeout: 90000 }).catch(() => {});
const cam = () => p.evaluate(() => { const m = window.__map; return m ? { z: +m.getZoom().toFixed(2), c: m.getCenter().toArray().map((v) => +v.toFixed(3)) } : null; });
await p.waitForTimeout(8000); console.log("8s", JSON.stringify(await cam()));
await p.waitForTimeout(17000); console.log("25s", JSON.stringify(await cam())); await p.screenshot({ path: `${out}/${tag}-home-25s.png` });
await p.getByTestId("map-locate-me").click().catch(() => {}); await p.waitForTimeout(5000); console.log("after locate", JSON.stringify(await cam())); await p.screenshot({ path: `${out}/${tag}-home-located.png` });
await b.close();
