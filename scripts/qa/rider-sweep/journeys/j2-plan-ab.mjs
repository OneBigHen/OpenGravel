import { session, open, shot, timed, audit, visibleTestIds, finish, PLACES } from "../lib.mjs";
export default async function () {
  for (const [vp, theme] of [["phone", "light"], ["small", "night"]]) {
    const s = await session({ vp, theme, geo: PLACES.doylestown, journey: "j2-plan-ab" });
    const p = s.page;
    await open(s, "/", 4000);
    const f = p.getByTestId("top-place-search");
    await timed(s, "search jim thorpe", async () => { await f.click(); await f.fill("Jim Thorpe PA"); await shot(s, "typed"); await p.waitForTimeout(2500); await shot(s, "suggestions"); await f.press("Enter"); await p.getByTestId("place-sheet").waitFor({ timeout: 20000 }); });
    await shot(s, "place-sheet");
    console.log((await visibleTestIds(p)).join(" "));
    await timed(s, "directions -> route", async () => { await p.getByTestId("place-directions").click(); await p.getByTestId("start-ride").waitFor({ timeout: 60000 }); });
    await p.waitForTimeout(2500);
    await shot(s, "route");
    console.log("IDS", (await visibleTestIds(p)).join(" "));
    console.log(JSON.stringify(await audit(p)));
    for (const id of ["route-distance", "route-duration", "route-summary", "route-facts", "route-options", "phone-alternatives"]) {
      const t = await p.getByTestId(id).first().innerText({ timeout: 1000 }).catch(() => null);
      if (t) console.log("TXT", id, JSON.stringify(t));
    }
    // ride style
    const styleTog = p.getByTestId("phone-ride-style").first();
    if (await styleTog.count()) { await styleTog.click().catch(() => {}); await p.waitForTimeout(1500); await shot(s, "style-open"); console.log("IDS-style", (await visibleTestIds(p)).join(" ")); }
    await finish(s);
  }
}
