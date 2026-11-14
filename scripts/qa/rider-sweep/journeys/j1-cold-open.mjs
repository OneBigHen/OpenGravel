import { session, open, shot, audit, visibleTestIds, finish } from "../lib.mjs";
export default async function () {
  for (const [vp, theme] of [["phone", "light"], ["phone", "night"], ["small", "light"], ["desk", "light"]]) {
    const s = await session({ vp, theme, journey: "j1-cold-open" });
    await open(s, "/", 2000);
    await shot(s, "t2s");
    await s.page.waitForTimeout(6000);
    await shot(s, "t8s");
    console.log(JSON.stringify(await audit(s.page)));
    console.log((await visibleTestIds(s.page)).join(" "));
    console.log("title:", await s.page.title());
    await finish(s);
  }
}
