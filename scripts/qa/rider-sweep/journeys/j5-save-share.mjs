import { session, open, shot, timed, audit, visibleTestIds, finish, PLACES } from "../lib.mjs";
export default async function () {
  for (const [vp, theme] of [["phone", "light"]]) {
    const s = await session({ vp, theme, geo: PLACES.doylestown, journey: "j5-save-share" });
    const p = s.page;
    await open(s, "/", 4000);
    const f = p.getByTestId("top-place-search");
    await f.click(); await f.fill("Jim Thorpe PA"); await p.waitForTimeout(2500);
    await p.getByText("Carbon County, PA").first().click();
    await p.getByTestId("place-sheet").waitFor({ timeout: 20000 });
    await p.getByTestId("place-directions").click();
    await p.getByTestId("start-ride").waitFor({ timeout: 60000 });
    await p.waitForTimeout(2000);
    await timed(s, "save", async () => { await p.getByTestId("summary-save").click(); await p.waitForTimeout(1500); });
    await shot(s, "after-save");
    console.log("IDS", (await visibleTestIds(p)).join(" "));
    await timed(s, "open share", async () => { await p.getByTestId("open-share").click(); await p.waitForTimeout(1500); });
    await shot(s, "share-sheet");
    console.log("IDS-share", (await visibleTestIds(p)).join(" "));
    console.log("SHARE TXT", JSON.stringify(await p.getByTestId("share-sheet").first().innerText({ timeout: 1500 }).catch(() => null)));
    console.log(JSON.stringify(await audit(p)));
    await p.keyboard.press("Escape");
    // reload mid-plan
    await p.reload({ waitUntil: "load" }); await p.waitForTimeout(5000);
    await shot(s, "after-reload");
    console.log("IDS-reload", (await visibleTestIds(p)).join(" "));
    // My rides
    await open(s, "/rides", 3000);
    await shot(s, "my-rides");
    console.log("IDS-rides", (await visibleTestIds(p)).join(" "));
    console.log("RIDES TXT", JSON.stringify((await p.locator("main").innerText()).slice(0, 800)));
    console.log(JSON.stringify(await audit(p)));
    // open the card
    const card = p.locator('[data-testid="ride-card-panel"], .og-rides__card').first();
    if (await card.count()) { await card.click().catch(() => {}); await p.waitForTimeout(1500); await shot(s, "ride-opened"); console.log("IDS-open", (await visibleTestIds(p)).join(" ")); }
    await finish(s);
  }
}
