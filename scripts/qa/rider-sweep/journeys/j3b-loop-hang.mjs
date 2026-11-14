import { session, open, shot, PLACES } from "../lib.mjs";
const race = (pr, ms, label) => Promise.race([pr, new Promise((r) => setTimeout(() => r("HUNG:" + label), ms))]);
export default async function () {
  const s = await session({ vp: "phone", theme: "light", geo: PLACES.hatboro, journey: "j3b-loop-hang" });
  const p = s.page;
  await open(s, "/", 4000);
  await p.getByTestId("loop-near-me").click();
  for (const ms of [500, 1500, 4000, 8000]) {
    await p.waitForTimeout(ms);
    console.log("evaluate @", ms, await race(p.evaluate(() => document.querySelectorAll("*").length), 5000, "evaluate"));
    console.log("shot", await race(shot(s, "t" + ms), 10000, "shot"));
  }
  console.log("labels", await race(p.locator('[data-testid="loop-time"] label').allInnerTexts(), 5000, "labels"));
  console.log("audit-ish", await race(p.evaluate(() => [...document.querySelectorAll("button")].length), 5000, "buttons"));
  process.exit(0);
}
