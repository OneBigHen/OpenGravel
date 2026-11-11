import { chromium } from "playwright";
const out = process.argv[2];
const base = "https://opengravel.henning.rodeo";
const b = await chromium.launch();
const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 440, height: 956, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const pages = ["/", "/explore", "/settings", "/?plan=loop"];
for (const [dev, vp] of Object.entries(sizes)) for (const theme of ["light", "dark"]) {
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor ?? 1, colorScheme: theme, geolocation: { latitude: 40.79, longitude: -77.86 }, permissions: ["geolocation"] });
  const p = await ctx.newPage();
  for (const path of pages) {
    try { await p.goto(base + path, { waitUntil: "networkidle", timeout: 45000 }); } catch {}
    await p.waitForTimeout(4000);
    const name = `${dev}-${theme}-${path.replace(/[^a-z]/g, "") || "home"}.png`;
    await p.screenshot({ path: `${out}/${name}` }); console.log(name);
  }
  // open layers panel if present
  try { const btn = p.getByRole("button", { name: /layers/i }).first(); await p.goto(base + "/", { waitUntil: "networkidle", timeout: 45000 }); await p.waitForTimeout(3000); await btn.click({ timeout: 5000 }); await p.waitForTimeout(2000); await p.screenshot({ path: `${out}/${dev}-${theme}-layers.png` }); console.log("layers"); } catch (e) { console.log("no layers btn", e.message.slice(0,80)); }
  await ctx.close();
}
await b.close();
