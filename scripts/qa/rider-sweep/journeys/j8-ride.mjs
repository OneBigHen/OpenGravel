import fs from "node:fs";
import path from "node:path";
import { session, open, shot, timed, audit, visibleTestIds, finish, OUT, txt } from "../lib.mjs";
function track(a, b, n = 40) { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (b[0] - a[0]) * t + Math.sin(t * 9) * 0.002, a[1] + (b[1] - a[1]) * t]); } return pts; }
export default async function () {
  const A = [40.8043, -75.6149], B = [40.8118, -75.6663];
  const pts = track(A, B);
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="qa" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Palmerton to Bowmanstown</name><trkseg>${pts.map((q) => `<trkpt lat="${q[0].toFixed(6)}" lon="${q[1].toFixed(6)}"/>`).join("")}</trkseg></trk></gpx>`;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.resolve(OUT, "ride-sim.gpx"); fs.writeFileSync(file, gpx);
  for (const [vp, theme, geoStart, tag] of [["phone", "light", { latitude: 40.8043, longitude: -75.6149 }, "onroute"], ["small", "night", { latitude: 40.1746, longitude: -75.1066 }, "faraway"]]) {
    const s = await session({ vp, theme, geo: geoStart, journey: "j8-ride", tag });
    const p = s.page;
    await open(s, "/rides", 3000);
    await p.locator('input[type="file"]').first().setInputFiles(file);
    await p.getByTestId("start-ride").waitFor({ timeout: 30000 });
    await p.waitForTimeout(2500);
    await shot(s, "planned");
    await timed(s, "start ride", async () => { await p.getByTestId("start-ride").click(); await p.waitForTimeout(3500); });
    await shot(s, "after-start");
    console.log("IDS", (await visibleTestIds(p)).join(" "));
    console.log("URL", p.url());
    console.log("BODY", JSON.stringify((await p.locator("body").innerText()).slice(0, 800)));
    console.log(JSON.stringify(await audit(p)));
    if (tag === "faraway") {
      const h = p.getByTestId("ride-head-to-start").first();
      if (await h.count()) { await shot(s, "head-to-start"); }
      // teleport to start and continue
      await s.ctx.setGeolocation({ latitude: A[0], longitude: A[1], accuracy: 5 });
      await p.waitForTimeout(4000); await shot(s, "teleported-to-start");
      console.log("BODY2", JSON.stringify((await p.locator("body").innerText()).slice(0, 600)));
    }
    // ride along
    for (let i = 0; i < 24; i++) {
      await s.ctx.setGeolocation({ latitude: pts[i][0], longitude: pts[i][1], accuracy: 5 });
      await p.waitForTimeout(900);
      if (i === 3 || i === 12 || i === 22) { await shot(s, "riding-" + i); console.log("MAN", i, JSON.stringify(await txt(p, "ride-maneuver")), JSON.stringify(await txt(p, "ride-metric-strip")), JSON.stringify(await txt(p, "ride-remaining"))); }
    }
    // off-route: jump 600 m north
    await s.ctx.setGeolocation({ latitude: pts[24][0] + 0.006, longitude: pts[24][1], accuracy: 5 });
    await p.waitForTimeout(6000); await shot(s, "off-route");
    console.log("OFF", JSON.stringify((await p.locator("body").innerText()).slice(0, 700)));
    console.log("IDS-off", (await visibleTestIds(p)).join(" "));
    // offline
    await s.ctx.setOffline(true); await p.waitForTimeout(5000); await shot(s, "offline");
    console.log("OFFLINE", JSON.stringify((await p.locator("body").innerText()).slice(0, 500)));
    await s.ctx.setOffline(false); await p.waitForTimeout(3000);
    // menu + end ride
    for (const id of ["ride-menu", "ride-menu-more", "ride-more"]) { if (await p.getByTestId(id).first().isVisible().catch(() => false)) { await p.getByTestId(id).first().click().catch(() => {}); await p.waitForTimeout(800); break; } }
    await shot(s, "menu");
    console.log("MENU", (await visibleTestIds(p)).join(" "));
    for (const id of ["ride-exit", "ride-stop", "ride-finish", "ride-live-finish"]) { if (await p.getByTestId(id).first().isVisible().catch(() => false)) { await p.getByTestId(id).first().click().catch(() => {}); await p.waitForTimeout(1200); await shot(s, "end-" + id); console.log("ENDIDS", id, (await visibleTestIds(p)).join(" ")); break; } }
    await finish(s);
  }
}
