// node .fable/mapfirst-shot.mjs BASE OUTDIR  — iPhone 16 Pro Max-size shots of a Langhorne → Philadelphia ride, map + satellite
import { chromium } from "playwright";
const [base, out] = process.argv.slice(2);
const b = await chromium.launch();
for (const look of ["map", "satellite"]) {
  const ctx = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: "light",
    geolocation: { latitude: 40.1746, longitude: -74.9227 }, permissions: ["geolocation"] });
  await ctx.addInitScript((l) => { try { localStorage.setItem("og-appearance", "day"); localStorage.setItem("opengravel-basemap-look", l); localStorage.setItem("opengravel-vnext-satellite", l === "satellite" ? "1" : "0"); } catch {} }, look);
  const p = await ctx.newPage();
  await p.goto(base + "/", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const f = p.getByTestId("top-place-search"); await f.fill("Reading Terminal Market"); await f.press("Enter");
  await p.getByTestId("place-sheet").waitFor({ timeout: 30000 });
  await p.getByTestId("place-directions").click();
  await p.waitForTimeout(25000);
  if (look === "satellite") {
    // pick Satellite in the layers sheet if the stored key did not take
    {}
  }
  await p.screenshot({ path: `${out}/phone-${look}.png` }); console.log(`${out}/phone-${look}.png`);
  await ctx.close();
}
await b.close();
