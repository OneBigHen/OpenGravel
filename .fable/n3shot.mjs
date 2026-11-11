import { chromium } from "playwright";
const [out, base, theme = "light", width = "440", height = "956"] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: +width, height: +height }, colorScheme: theme, geolocation: { latitude: 40.72, longitude: -77.89 }, permissions: ["geolocation"], hasTouch: +width < 800, isMobile: +width < 800 });
const p = await ctx.newPage();
p.on("pageerror", e => console.log("PAGEERROR", e.message.slice(0, 200)));
await p.goto(base + "/", { waitUntil: "load", timeout: 90000 });
await p.waitForTimeout(5000);
const loop = p.getByRole("button", { name: /^Loop/ }).first();
if (+width < 800) await loop.click({ timeout: 15000 }).catch(e => console.log("no loop pill", e.message.slice(0, 80)));
else { await p.getByRole("radio", { name: "Loop from start" }).check({ force: true }).catch(() => {}); await p.getByTestId("compose-create").click({ timeout: 10000 }).catch(e => console.log("no plan btn", e.message.slice(0, 80))); }
await p.waitForTimeout(14000);
await p.screenshot({ path: `${out}-planned.png` });
const truth = await p.locator('[data-testid="ride-truth"], [data-testid="selected-route-truth"]').first().innerText().catch(() => "NO TRUTH BLOCK");
console.log("truth:", JSON.stringify(truth));
const strip = p.getByTestId("phone-surface-strip");
if (await strip.count()) {
  const box = await strip.boundingBox(); const sheet = await p.getByTestId("phone-ride-summary").boundingBox();
  console.log("strip width", box?.width, "summary width", sheet?.width, "tag", await strip.evaluate(e => e.tagName));
  if (await strip.evaluate(e => e.tagName) === "BUTTON") { await strip.click(); await p.waitForTimeout(2500); await p.screenshot({ path: `${out}-strip-tap.png` }); }
}
await b.close();
