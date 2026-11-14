import { session, open, shot, finish, PLACES, planTo, txt } from "../lib.mjs";
export default async function () {
  const s = await session({ vp: "phone", theme: "light", geo: PLACES.doylestown, journey: "j4b-idle" });
  const p = s.page;
  await open(s, "/", 4000);
  await planTo(s, "Jim Thorpe PA", "Carbon County, PA");
  await p.waitForTimeout(8000);
  const sum0 = await txt(p, "route-summary");
  const count = () => s.reqs.filter((r) => /route-plan/.test(r.url)).length;
  const c0 = count(), all0 = s.reqs.length;
  // phase 1: wheel zoom only, 30 s
  const box = await p.getByTestId("planner-map").boundingBox();
  await p.mouse.move(box.x + box.width - 40, box.y + 120);
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -250); await p.waitForTimeout(2500); await p.mouse.wheel(0, 250); await p.waitForTimeout(2500); }
  const c1 = count();
  console.log("PHASE1 zoom-only 30s: route-plan calls", c1 - c0, "all api", s.reqs.length - all0);
  // phase 2: drag from the empty bottom-right corner of the map (away from route)
  await shot(s, "mid");
  const sx = box.x + box.width - 30, sy = box.y + box.height - 60;
  for (let i = 0; i < 6; i++) { await p.mouse.move(sx, sy); await p.mouse.down(); await p.mouse.move(sx - 40, sy - 30, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(2500); await p.mouse.move(sx - 40, sy - 30); await p.mouse.down(); await p.mouse.move(sx, sy, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(2500); }
  const c2 = count();
  console.log("PHASE2 drag-pan 30s: route-plan calls", c2 - c1, "all api", s.reqs.length - all0);
  const sum1 = await txt(p, "route-summary");
  console.log("SUM-before", JSON.stringify(sum0 && sum0.slice(0, 90)));
  console.log("SUM-after ", JSON.stringify(sum1 && sum1.slice(0, 90)));
  const byUrl = {}; for (const r of s.reqs.slice(all0)) { const k = r.m + " " + r.url.replace(/https?:\/\/[^/]+/, "").split("?")[0]; byUrl[k] = (byUrl[k] || 0) + 1; }
  console.log("BYURL", JSON.stringify(byUrl));
  await shot(s, "end");
  await finish(s);
}
