import fs from "node:fs";
const names = process.argv.slice(2);
const dir = new URL("./journeys/", import.meta.url);
const all = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();
for (const f of all) {
  if (names.length && !names.some((n) => f.startsWith(n))) continue;
  console.log("=== " + f);
  try { await (await import(new URL(f, dir))).default(); } catch (e) { console.log("JOURNEY CRASH", f, String(e).slice(0, 400)); }
}
