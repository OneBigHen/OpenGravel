import { session, open, shot, finish, PLACES, planTo, txt, timed } from "../lib.mjs";
export default async function () {
  const s = await session({ vp: "phone", theme: "light", geo: PLACES.doylestown, journey: "j12-reload" });
  const p = s.page;
  await open(s, "/", 4000);
  await planTo(s, "Jim Thorpe PA", "Carbon County, PA");
  await p.reload({ waitUntil: "load" });
  const t0 = Date.now();
  for (const sec of [3, 8, 15, 30]) {
    await p.waitForTimeout(Math.max(0, sec * 1000 - (Date.now() - t0)));
    await shot(s, "reload-" + sec + "s", JSON.stringify((await p.locator("body").innerText()).slice(0, 200)));
  }
  console.log("RELOAD has route after 30s:", !!(await txt(p, "route-summary")), "start-ride visible:", await p.getByTestId("start-ride").isVisible().catch(() => false));
  // back-button: from route -> settings -> back
  await open(s, "/settings", 2000); await p.goBack(); await p.waitForTimeout(4000); await shot(s, "back-from-settings");
  console.log("after back:", p.url(), JSON.stringify((await p.locator("body").innerText()).slice(0, 300)));
  await finish(s);
}
