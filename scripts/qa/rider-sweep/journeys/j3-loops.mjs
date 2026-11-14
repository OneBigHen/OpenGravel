import { session, open, shot, timed, audit, visibleTestIds, finish, PLACES, txt } from "../lib.mjs";
export default async function () {
  for (const [place, vp, theme] of [["hatboro", "phone", "light"], ["lancaster", "phone", "light"], ["lancaster", "small", "light"]]) {
    const s = await session({ vp, theme, geo: PLACES[place], journey: "j3-loops", tag: place });
    const p = s.page;
    await open(s, "/", 4000);
    await p.getByTestId("loop-near-me").click();
    const r = await timed(s, "first loop (default)", async () => { await p.getByTestId("start-ride").waitFor({ timeout: 60000 }); });
    await p.waitForTimeout(2500);
    await shot(s, "loop-default");
    console.log("SUMMARY", place, JSON.stringify(await txt(p, "route-summary")));
    console.log("IDS", (await visibleTestIds(p)).join(" "));
    console.log(JSON.stringify(await audit(p)));
    // open ride style to choose time / twisty
    await p.getByTestId("summary-style").click().catch(() => {});
    await p.waitForTimeout(1500);
    await shot(s, "style-sheet");
    console.log("IDS-style", (await visibleTestIds(p)).join(" "));
    console.log("STYLE", JSON.stringify((await p.locator('[data-testid="planner-sheet"]').innerText({ timeout: 2000 }).catch(() => "")).slice(0, 700)));
    for (const [name, id] of [["twisty2h", "twisty-loop-quick"], ["3h", "loop-time-180"], ["6h", "loop-time-360"]]) {
      const el = p.getByTestId(id).first();
      if (!(await el.count())) { console.log("NOCONTROL", id); continue; }
      await el.click({ force: true, timeout: 5000 }).catch((e) => console.log("clickfail", id, String(e).slice(0, 80)));
      await p.waitForTimeout(500);
      const btn = p.getByTestId("compose-create").first();
      if (await btn.count()) await btn.click({ timeout: 5000 }).catch(() => {});
      await timed(s, name + " replan", async () => { await p.getByTestId("route-summary").first().waitFor({ timeout: 90000 }); await p.waitForTimeout(6000); });
      await shot(s, name);
      console.log("SUMMARY", name, JSON.stringify(await txt(p, "route-summary")));
      if (await p.getByTestId("planner-error").count()) console.log("ERR", await txt(p, "planner-error"));
    }
    await finish(s);
  }
}
