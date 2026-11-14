import fs from "node:fs";
import path from "node:path";
import { session, open, shot, timed, audit, visibleTestIds, finish, PLACES, OUT } from "../lib.mjs";
function gpx(name, a, b, n = 40) {
  let pts = "";
  for (let i = 0; i <= n; i++) { const t = i / n; pts += `<trkpt lat="${(a[0] + (b[0] - a[0]) * t + Math.sin(t * 9) * 0.002).toFixed(6)}" lon="${(a[1] + (b[1] - a[1]) * t).toFixed(6)}"><ele>${200 + i}</ele></trkpt>`; }
  return `<?xml version="1.0"?><gpx version="1.1" creator="qa" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${pts}</trkseg></trk></gpx>`;
}
export default async function () {
  fs.mkdirSync(OUT, { recursive: true });
  const files = { pa: path.resolve(OUT, "palmerton-bowmanstown.gpx"), co: path.resolve(OUT, "golden-idaho-springs.gpx") };
  fs.writeFileSync(files.pa, gpx("Palmerton to Bowmanstown", [40.8043, -75.6149], [40.8118, -75.6663]));
  fs.writeFileSync(files.co, gpx("Golden to Idaho Springs", [39.7555, -105.2211], [39.7425, -105.5130]));
  for (const [key, geo] of [["pa", PLACES.hatboro], ["co", PLACES.hatboro]]) {
    const s = await session({ vp: "phone", theme: "light", geo, journey: "j6-gpx", tag: key });
    const p = s.page;
    await open(s, "/rides", 3000);
    await shot(s, "rides-empty");
    console.log("IDS", (await visibleTestIds(p)).join(" "));
    console.log("TXT", JSON.stringify((await p.locator("main").innerText()).slice(0, 600)));
    await p.locator('input[type="file"]').first().setInputFiles(files[key]);
    await p.waitForTimeout(4000);
    await shot(s, "imported");
    console.log("IDS-imp", (await visibleTestIds(p)).join(" "));
    console.log("TXT-imp", JSON.stringify((await p.locator("main").innerText()).slice(0, 900)));
    await finish(s);
  }
}
