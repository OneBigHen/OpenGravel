import { session, open, shot, timed, finish, visibleTestIds, PLACES, txt } from "../lib.mjs";
export default async function () {
  for (const [name, q, geo] of [["asheville", "Blue Ridge Parkway Asheville NC", PLACES.asheville], ["colorado", "Idaho Springs CO", PLACES.denver]]) {
    const s = await session({ vp: "phone", theme: "light", geo, journey: "j10-outside", tag: name });
    const p = s.page;
    await open(s, "/", 4000);
    await shot(s, "home-outside");
    const f = p.getByTestId("top-place-search");
    await f.click(); await f.fill(q); await p.waitForTimeout(3000); await shot(s, "suggest");
    await p.locator('[role=listbox] [role=option], [role=listbox] li').first().click().catch(() => {});
    await p.getByTestId("place-sheet").waitFor({ timeout: 15000 }).catch(() => {});
    await shot(s, "place");
    await p.getByTestId("place-directions").click().catch(() => {});
    const r = await timed(s, "route outside", async () => { await p.getByTestId("start-ride").waitFor({ timeout: 45000 }); });
    await p.waitForTimeout(3000);
    await shot(s, "route-outside");
    console.log("SUMMARY", JSON.stringify(await txt(p, "route-summary")));
    console.log("BODY", JSON.stringify((await p.locator("body").innerText()).slice(0, 700)));
    await finish(s);
  }
}
