import { session, open, shot, timed, audit, visibleTestIds, finish, PLACES, txt } from "../lib.mjs";
export default async function () {
  for (const [vp, theme] of [["phone", "light"], ["small", "night"], ["desk", "light"]]) {
    const s = await session({ vp, theme, geo: PLACES.hatboro, journey: "j7-explore" });
    const p = s.page;
    await open(s, "/explore", 6000);
    await shot(s, "explore-home");
    console.log("IDS", (await visibleTestIds(p)).join(" "));
    console.log("TXT", JSON.stringify((await p.locator("main, body").first().innerText()).slice(0, 900)));
    console.log(JSON.stringify(await audit(p)));
    await p.mouse.wheel(0, 900); await p.waitForTimeout(1000); await shot(s, "scrolled");
    // open first card
    const card = p.locator('[data-testid="explore-card"], [data-testid="curated-ride-card"], article, [data-testid^="explore-card"]').first();
    await timed(s, "open first card", async () => { await card.click(); await p.waitForTimeout(3000); });
    await shot(s, "card-open");
    console.log("URL", p.url());
    console.log("IDS-card", (await visibleTestIds(p)).join(" "));
    console.log("TXT-card", JSON.stringify((await p.locator("body").innerText()).slice(0, 900)));
    const rt = p.getByTestId("ride-this").first();
    if (await rt.count()) { await timed(s, "ride this", async () => { await rt.click(); await p.waitForTimeout(6000); }); await shot(s, "ride-this"); console.log("URL2", p.url()); console.log("IDS-rt", (await visibleTestIds(p)).join(" ")); }
    await finish(s);
  }
}
