import { session, open, shot, finish, PLACES, planTo, txt, audit, visibleTestIds } from "../lib.mjs";
export default async function () {
  // desktop plan + resize + back button
  const s = await session({ vp: "desk", theme: "light", geo: PLACES.doylestown, journey: "j11-misc", tag: "desk" });
  const p = s.page;
  await open(s, "/", 5000);
  await shot(s, "desk-home");
  const f = p.getByTestId("finish-search").first();
  await f.click(); await f.fill("Jim Thorpe PA"); await p.waitForTimeout(2500); await shot(s, "desk-suggest");
  await p.getByText("Carbon County, PA").first().click().catch(() => {});
  await p.waitForTimeout(1500);
  const st = p.getByTestId("start-search").first();
  console.log("START VAL", await txt(p, "start-value"), "| FINISH VAL", await txt(p, "finish-value"));
  await shot(s, "desk-picked");
  await p.getByTestId("compose-create").first().click().catch((e) => console.log("create fail", String(e).slice(0, 100)));
  await p.getByTestId("start-ride").waitFor({ timeout: 60000 }).catch(() => console.log("no route on desktop"));
  await p.waitForTimeout(3000);
  await shot(s, "desk-route");
  console.log("DESK SUM", JSON.stringify(await txt(p, "route-summary")));
  console.log(JSON.stringify(await audit(p)));
  // resize to phone mid plan
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(2500); await shot(s, "resized-to-phone");
  await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(2500); await shot(s, "landscape");
  console.log("LAND", JSON.stringify(await audit(p)));
  await p.setViewportSize({ width: 390, height: 844 });
  // back button
  await p.goBack().catch(() => {}); await p.waitForTimeout(2500); await shot(s, "after-back"); console.log("URL-back", p.url());
  await finish(s);
}
