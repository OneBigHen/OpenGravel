// Rider-sweep harness: real prod, real router, real browser. No mocks.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.QA_BASE || "https://opengravel.henning.rodeo";
export const OUT = process.env.QA_OUT || "qa-out";
export const VPS = {
  phone: { width: 390, height: 844, mobile: true, dsf: 2 },
  small: { width: 320, height: 568, mobile: true, dsf: 2 },
  desk: { width: 1440, height: 900, mobile: false, dsf: 1 },
};
export const PLACES = {
  doylestown: { latitude: 40.3101, longitude: -75.1299 },
  hatboro: { latitude: 40.1746, longitude: -75.1066 },
  lancaster: { latitude: 40.0379, longitude: -76.3055 },
  asheville: { latitude: 35.5951, longitude: -82.5515 },
  denver: { latitude: 39.7392, longitude: -104.9903 },
};

export async function session({ vp = "phone", theme = "light", geo = null, journey = "j", tag = "", extra = {} } = {}) {
  const v = VPS[vp];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: v.width, height: v.height }, isMobile: v.mobile, hasTouch: v.mobile, deviceScaleFactor: v.dsf,
    colorScheme: theme === "night" ? "dark" : "light", timezoneId: "America/New_York",
    ...(geo ? { geolocation: { ...geo, accuracy: 5 }, permissions: ["geolocation"] } : {}), ...extra,
  });
  const dir = path.join(OUT, journey, `${vp}-${theme}${tag ? "-" + tag : ""}`);
  fs.mkdirSync(dir, { recursive: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  const s = { browser, ctx, page, dir, n: 0, log: [], consoleErrors: [], failed: [], reqs: [], t0: Date.now() };
  page.on("console", (m) => { if (m.type() === "error") s.consoleErrors.push({ t: Date.now() - s.t0, text: m.text().slice(0, 300) }); });
  page.on("pageerror", (e) => s.consoleErrors.push({ t: Date.now() - s.t0, text: "PAGEERROR " + String(e).slice(0, 300) }));
  page.on("response", (r) => { const u = r.url(); if (r.status() >= 400) s.failed.push({ t: Date.now() - s.t0, status: r.status(), url: u.slice(0, 160) }); });
  page.on("requestfailed", (r) => { s.failed.push({ t: Date.now() - s.t0, status: "FAIL", url: r.url().slice(0, 160), err: r.failure()?.errorText }); });
  page.on("request", (r) => { const u = r.url(); if (/\/api\//.test(u)) s.reqs.push({ t: Date.now() - s.t0, m: r.method(), url: u.slice(0, 120) }); });
  return s;
}

export async function shot(s, name, note = "") {
  s.n++;
  const f = `${String(s.n).padStart(2, "0")}-${name}.png`;
  await s.page.screenshot({ path: path.join(s.dir, f) }).catch(() => {});
  const rec = { f, note, t: Date.now() - s.t0, errs: s.consoleErrors.length, failed: s.failed.length };
  s.log.push(rec);
  console.log(`[${path.basename(s.dir)}] ${f} ${note}`);
  return f;
}

export async function timed(s, label, fn) {
  const t = Date.now();
  let ok = true, err = "";
  try { await fn(); } catch (e) { ok = false; err = String(e).split("\n")[0].slice(0, 200); }
  const ms = Date.now() - t;
  s.log.push({ timed: label, ms, ok, err });
  console.log(`[${path.basename(s.dir)}] TIMED ${label}: ${ms}ms ${ok ? "ok" : "FAIL " + err}`);
  return { ok, ms, err };
}

export async function open(s, urlPath = "/", settle = 5000) {
  await timed(s, "goto " + urlPath, () => s.page.goto(BASE + urlPath, { waitUntil: "load", timeout: 60000 }));
  await s.page.waitForTimeout(settle);
}

export async function visibleTestIds(page) {
  return page.evaluate(() => [...document.querySelectorAll("[data-testid]")].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden"; }).map((e) => e.getAttribute("data-testid")));
}

// small tap targets + horizontal overflow + clipped text audit
export async function audit(page) {
  return page.evaluate(() => {
    const vw = innerWidth;
    const small = [], clipped = [];
    for (const e of document.querySelectorAll("button, a, [role=button], input, select, [role=tab], [role=switch]")) {
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      if (r.width < 40 || r.height < 40) small.push(`${e.getAttribute("data-testid") || e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const e of document.querySelectorAll("body *")) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 && r.left < vw) clipped.push(`${e.getAttribute("data-testid") || e.tagName + "." + String(e.className).slice(0, 30)} right=${Math.round(r.right)}`);
    }
    return { vw, scrollW: document.documentElement.scrollWidth, small: small.slice(0, 30), overflow: clipped.slice(0, 15) };
  });
}

export function finish(s) {
  fs.writeFileSync(path.join(s.dir, "log.json"), JSON.stringify({ log: s.log, consoleErrors: s.consoleErrors, failed: s.failed, apiReqCount: s.reqs.length, reqs: s.reqs.slice(0, 200) }, null, 1));
  return s.browser.close();
}
