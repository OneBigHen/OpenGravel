import { chromium } from "playwright";
const out = ".fable/shots/credits";
const b = await chromium.launch();
for (const [n, w, h] of [["390x844", 390, 844], ["320x568", 320, 568]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto("http://localhost:3341/explore/fb-8b03e3e24269f34452b8", { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.getByTestId("ride-credit").first().waitFor({ timeout: 120000 });
  console.log(n, await p.getByTestId("ride-credit").first().innerText(), await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/explore-detail-${n}.png` });
  await p.goto("http://localhost:3341/explore", { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.locator(".og-explore-card__byline").first().waitFor({ timeout: 120000 });
  console.log(n, "card:", await p.locator(".og-explore-card__byline").first().innerText());
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/explore-list-${n}.png` });
  await ctx.close();
}
await b.close();
