// Night terrain proof: local build (with the public Mapbox token) at Rothrock and
// State College, desktop + phone, dark theme, wide and close.
//   PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node .fable/night-shots.mjs BASE OUTDIR
import { chromium } from "@playwright/test";

const [base, out] = process.argv.slice(2);
const PLACES = { rothrock: { latitude: 40.72, longitude: -77.78 }, statecollege: { latitude: 40.7934, longitude: -77.86 } };
const b = await chromium.launch();
for (const [name, pos] of Object.entries(PLACES)) for (const device of ["desktop", "phone"]) {
  const phone = device === "phone";
  const c = await b.newContext({
    viewport: phone ? { width: 440, height: 956 } : { width: 1440, height: 900 }, deviceScaleFactor: phone ? 2 : 1,
    isMobile: phone, hasTouch: phone, colorScheme: "dark", geolocation: pos, permissions: ["geolocation"],
    locale: "en-US", timezoneId: "America/New_York",
    extraHTTPHeaders: { Referer: "https://opengravel.henning.rodeo/" },
  });
  await c.addInitScript(() => { try { localStorage.setItem("og.theme", "night"); } catch {} });
  const p = await c.newPage();
  p.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 160)); });
  await p.goto(base + "/");
  await p.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(6000);
  const theme = await p.evaluate(() => document.documentElement.dataset.theme);
  const map = p.locator("canvas").first(); const box = await map.boundingBox();
  const cx = box.x + box.width * 0.6, cy = box.y + box.height * 0.4;
  await p.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 300); await p.waitForTimeout(300); }
  await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(4000);
  await p.screenshot({ path: `${out}/${name}-${device}-wide.png` });
  for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(300); }
  await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(4000);
  await p.screenshot({ path: `${out}/${name}-${device}-close.png` });
  console.log(name, device, "theme=", theme);
  await c.close();
}
await b.close();
