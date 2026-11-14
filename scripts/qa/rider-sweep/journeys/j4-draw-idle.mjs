import { session, open, shot, timed, audit, visibleTestIds, finish, PLACES, planTo, txt } from "../lib.mjs";
export default async function () {
  const s = await session({ vp: "phone", theme: "light", geo: PLACES.doylestown, journey: "j4-draw-idle" });
  const p = s.page;
  await open(s, "/", 4000);
  await planTo(s, "Jim Thorpe PA", "Carbon County, PA");
  await shot(s, "planned");
  // idle: pan/zoom 60 s and count /api requests
  const before = s.reqs.length;
  const t0 = Date.now();
  const box = await p.getByTestId("planner-map").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 3;
  while (Date.now() - t0 < 60000) {
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + 60, cy + 40, { steps: 8 }); await p.mouse.up();
    await p.mouse.wheel(0, -200); await p.waitForTimeout(2500);
    await p.mouse.wheel(0, 200); await p.waitForTimeout(2500);
  }
  const during = s.reqs.slice(before);
  console.log("IDLE-60s api requests:", during.length, JSON.stringify(during.map((r) => r.m + " " + r.url.replace(/https?:\/\/[^/]+/, "")).reduce((a, u) => (a[u.split("?")[0]] = (a[u.split("?")[0]] || 0) + 1, a), {})));
  await shot(s, "after-idle-pan");
  console.log("SUMMARY-after", JSON.stringify(await txt(p, "route-summary")));
  // edit route
  console.log("IDS", (await visibleTestIds(p)).join(" "));
  await timed(s, "open edit", async () => { await p.getByTestId("trip-edit").click(); await p.waitForTimeout(1500); });
  await shot(s, "edit-open");
  console.log("IDS-edit", (await visibleTestIds(p)).join(" "));
  for (const id of ["edit-route", "map-edit-open", "sheet-edit-tools", "phone-edit-tools"]) { if (await p.getByTestId(id).first().isVisible().catch(() => false)) { await p.getByTestId(id).first().click(); await p.waitForTimeout(1500); await shot(s, "edit-" + id); console.log("IDS-" + id, (await visibleTestIds(p)).join(" ")); break; } }
  // drag the line mid-way
  const b2 = await p.getByTestId("planner-map").boundingBox();
  const x = b2.x + b2.width * 0.5, y = b2.y + b2.height * 0.5;
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 70, y + 20, { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(6000); await shot(s, "after-drag");
  console.log("SUMMARY-drag", JSON.stringify(await txt(p, "route-summary")));
  for (const id of ["map-edit-undo", "undo"]) { if (await p.getByTestId(id).first().isVisible().catch(() => false)) { await p.getByTestId(id).first().click(); await p.waitForTimeout(5000); await shot(s, "after-undo"); console.log("SUMMARY-undo", JSON.stringify(await txt(p, "route-summary"))); break; } }
  console.log("FAILED", JSON.stringify(s.failed.slice(0, 10)));
  await finish(s);
}
