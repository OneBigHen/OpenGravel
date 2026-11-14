// Lists proposed merges from a pack build's dedupe-groups.json as a table to judge by eye.
// node scripts/route-library/dedupe-sample.mjs <dedupe-groups.json> [count]
// Every merge when there are fewer than `count` (default 40); otherwise an even spread.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const count = Number(process.argv[3] ?? 40);
if (file === undefined) {
  console.error("Usage: dedupe-sample.mjs <dedupe-groups.json> [count]");
  process.exit(2);
}
const data = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map();
for (const group of data.groups) for (const member of [group.primary, ...group.members]) byId.set(member.id, member);
const pairs = data.groups.flatMap((group) => group.pairs.map((pair) => ({ pair, group })));
const step = Math.max(1, pairs.length / count);
const chosen = pairs.length <= count ? pairs : Array.from({ length: count }, (_, index) => pairs[Math.floor(index * step)]);
const cell = (member) => `${member.name.replace(/\|/g, "/")} (${member.source}, ${member.states.join("/")}${member.miles === null ? "" : `, ${member.miles} mi`})`;
console.log(`${chosen.length} of ${pairs.length} proposed merges (${data.groups.length} groups, ${data.before} records, ${data.cards} cards).\n`);
console.log("| # | Ride A | Ride B | Method | Score | Evidence |\n|---|---|---|---|---|---|");
chosen.forEach(({ pair }, index) => {
  console.log(`| ${index + 1} | ${cell(byId.get(pair.a))} | ${cell(byId.get(pair.b))} | ${pair.method} | ${pair.score} | ${pair.detail} |`);
});
