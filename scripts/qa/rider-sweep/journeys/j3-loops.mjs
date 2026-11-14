import { session, open, shot, timed, audit, visibleTestIds, finish, PLACES } from "../lib.mjs";
export default async function () {
  for (const [place, vp, theme] of [["hatboro", "phone", "light"], ["lancaster", "phone", "night"], ["hatboro", "small", "light"]]) {
    const s = await session({ vp, theme, geo: PLACES[place], journey: "j3-loops", tag: place });
    const p = s.page;
    await open(s, "/", 4000);
    await p.getByTestId("loop-near-me").click();
    await p.waitForTimeout(1200);
    await shot(s, "loop-composer");
    console.log("IDS", (await visibleTestIds(p)).join(" "));
    const labels = await p.locator('[data-testid="loop-time"] label').allInnerTexts().catch(() => []);
    console.log("TIMES", JSON.stringify(labels));
    console.log(JSON.stringify(await audit(p)));
    const runs = [["twisty", async () => { await p.getByTestId("twisty-loop-quick").click(); }]];
    const ids = await p.locator('[data-testid^="loop-time-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    const longest = ids.filter((i) => /\d+$/.test(i)).pop();
    if (longest) runs.push(["longest-" + longest, async () => { await p.getByTestId(longest).check({ force: true }).catch(async () => p.getByTestId(longest).click({ force: true })); }]);
    for (const [name, setup] of runs) {
      await setup();
      await p.waitForTimeout(500);
      await shot(s, name + "-set");
      const r = await timed(s, name + " loop plan", async () => { await p.getByTestId("compose-create").click(); await p.getByTestId("start-ride").waitFor({ timeout: 90000 }); });
      await p.waitForTimeout(3000);
      await shot(s, name + "-result");
      const t = await p.getByTestId("route-summary").first().innerText({ timeout: 1500 }).catch(() => null);
      console.log("SUMMARY", name, JSON.stringify(t));
      const err = await p.getByTestId("planner-error").first().innerText({ timeout: 500 }).catch(() => null);
      if (err) console.log("ERR", err);
      // reset for next
      await p.getByTestId("trip-close").click({ timeout: 2000 }).catch(() => {});
      await p.waitForTimeout(1500);
      if (await p.getByTestId("loop-near-me").count()) await p.getByTestId("loop-near-me").click().catch(() => {});
      await p.waitForTimeout(1000);
    }
    await finish(s);
  }
}
