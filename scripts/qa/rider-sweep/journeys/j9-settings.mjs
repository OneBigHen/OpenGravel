import { session, open, shot, timed, audit, visibleTestIds, finish, PLACES } from "../lib.mjs";
export default async function () {
  for (const [vp, theme] of [["phone", "light"], ["small", "light"]]) {
    const s = await session({ vp, theme, geo: PLACES.hatboro, journey: "j9-settings" });
    const p = s.page;
    await open(s, "/", 4000);
    await shot(s, "home-auto");
    await p.getByTestId("app-menu").click(); await p.waitForTimeout(800);
    await shot(s, "menu");
    console.log("MENU", JSON.stringify(await p.locator(".og-appmenu__panel").innerText().catch(() => null)));
    console.log(JSON.stringify(await audit(p)));
    for (const m of ["day", "night"]) { await p.getByTestId(`app-menu-theme-${m}`).click(); await p.waitForTimeout(1500); await shot(s, "theme-" + m); }
    await p.getByTestId("app-menu").click().catch(() => {}); 
    // layers
    await p.getByTestId("app-menu").isVisible();
    await p.getByTestId("map-layers-toggle").click(); await p.waitForTimeout(1200); await shot(s, "layers");
    console.log("IDS-layers", (await visibleTestIds(p)).join(" "));
    console.log("LAYERS", JSON.stringify((await p.locator("body").innerText()).slice(0, 700)));
    await p.keyboard.press("Escape");
    await open(s, "/settings", 3000);
    await shot(s, "settings-top");
    console.log("SETTINGS", JSON.stringify((await p.locator("main").innerText()).slice(0, 2500)));
    console.log(JSON.stringify(await audit(p)));
    await p.mouse.wheel(0, 1200); await p.waitForTimeout(500); await shot(s, "settings-mid");
    await p.mouse.wheel(0, 1500); await p.waitForTimeout(500); await shot(s, "settings-bottom");
    const unit = p.getByTestId("settings-units").first();
    if (await unit.count()) { console.log("UNITS", JSON.stringify(await unit.innerText())); }
    await finish(s);
  }
}
