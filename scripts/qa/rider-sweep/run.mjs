import fs from "node:fs";
const names = process.argv.slice(2);
const dir = new URL("./journeys/", import.meta.url);
const all = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();
const LIMIT = Number(process.env.QA_JOURNEY_LIMIT_MS || 240000);
for (const f of all) {
  if (names.length && !names.some((n) => f.startsWith(n))) continue;
  console.log("=== " + f);
  let timer;
  const wd = new Promise((r) => { timer = setTimeout(() => r("WATCHDOG"), LIMIT); });
  try { const r = await Promise.race([(await import(new URL(f, dir))).default(), wd]); if (r === "WATCHDOG") console.log("JOURNEY HUNG (watchdog)", f); } catch (e) { console.log("JOURNEY CRASH", f, String(e).slice(0, 400)); }
  clearTimeout(timer);
}
process.exit(0);
