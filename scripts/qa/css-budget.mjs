#!/usr/bin/env node
// CSS bloat ratchet. Counts the things that quietly make the app uglier and
// fails if any count rises above the checked-in budget. Contains no
// dependencies so it runs in CI before anything is installed beyond Node.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src";
const BUDGET_PATH = "scripts/qa/css-budget.json";
const TOKENS_PATH = "src/app/tokens.css";
const NEW_FILE_LIMIT = 400;
const METRICS = ["totalLines", "maxFileLines", "backdropFilter", "mediaQueries", "literalRadius", "literalShadow", "hexLiterals"];

const normalize = (file) => file.split(path.sep).join("/");

/** Count CSS bloat for `[{ path, text }]`. Paths are repo-relative and sorted. */
export function countCss(files) {
  const media = new Set();
  const totals = {
    totalLines: 0,
    maxFileLines: 0,
    backdropFilter: 0,
    mediaQueries: 0,
    literalRadius: 0,
    literalShadow: 0,
    hexLiterals: 0,
  };
  const perFile = {};

  for (const file of files) {
    const name = normalize(file.path);
    const lines = file.text.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();

    perFile[name] = lines.length;
    totals.totalLines += lines.length;
    totals.maxFileLines = Math.max(totals.maxFileLines, lines.length);

    for (const line of lines) {
      totals.backdropFilter += (line.match(/(?:-webkit-)?backdrop-filter\s*:/g) || []).length;

      for (const match of line.matchAll(/@media([^{]*)/g)) {
        media.add(`@media ${match[1].replace(/\s+/g, " ").trim()}`);
      }

      for (const match of line.matchAll(/\bborder-radius\s*:\s*([^;{}]+)/g)) {
        const value = match[1];
        if (!value.includes("var(") && /\d*\.?\d+(?:px|rem|%)/i.test(value)) totals.literalRadius++;
      }

      for (const match of line.matchAll(/\bbox-shadow\s*:\s*([^;{}]+)/g)) {
        const value = match[1].replace(/!important/gi, "").trim().toLowerCase();
        if (value && value !== "none" && !value.includes("var(")) totals.literalShadow++;
      }

      if (name !== TOKENS_PATH) {
        totals.hexLiterals += (line.match(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g) || []).length;
      }
    }
  }

  totals.mediaQueries = media.size;
  const sorted = Object.fromEntries(Object.entries(perFile).sort(([a], [b]) => a.localeCompare(b)));
  return { ...totals, files: sorted };
}

function scan() {
  return countCss(
    readdirSync(SRC, { recursive: true })
      .filter((entry) => entry.endsWith(".css"))
      .sort()
      .map((entry) => ({ path: path.join(SRC, entry), text: readFileSync(path.join(SRC, entry), "utf8") })),
  );
}

function readBudget() {
  return existsSync(BUDGET_PATH) ? JSON.parse(readFileSync(BUDGET_PATH, "utf8")) : null;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function signed(delta) {
  return delta > 0 ? `+${delta}` : String(delta);
}

function report(budget, now) {
  console.log(`${pad("metric", 18)}${pad("budget", 9)}${pad("now", 9)}delta`);
  console.log("-".repeat(45));
  const over = [];
  for (const metric of METRICS) {
    const before = budget[metric];
    const delta = now[metric] - before;
    if (delta > 0) over.push(`${metric} is ${delta} over budget`);
    console.log(`${pad(metric, 18)}${pad(before, 9)}${pad(now[metric], 9)}${signed(delta)}`);
  }

  for (const [file, lines] of Object.entries(now.files)) {
    const before = budget.files?.[file];
    if (before === undefined && lines > NEW_FILE_LIMIT) over.push(`${file} is a new file with ${lines} lines (limit ${NEW_FILE_LIMIT})`);
    else if (before !== undefined && lines > before) over.push(`${file} is ${lines - before} lines over budget (${lines} > ${before})`);
  }

  if (over.length === 0) {
    console.log("\nCSS budget ok.");
    return 0;
  }
  console.log("\nCSS budget exceeded:");
  for (const line of over) console.log(`  - ${line}`);
  console.log("\nShrink the CSS, or lower the counts in scripts/qa/css-budget.json.");
  return 1;
}

function writeBudget(now, allowRaise) {
  const previous = readBudget();
  const raises = [];
  if (previous) {
    for (const metric of METRICS) {
      if (now[metric] > previous[metric]) raises.push(`${metric}: ${previous[metric]} -> ${now[metric]}`);
    }
    for (const [file, lines] of Object.entries(now.files)) {
      const before = previous.files?.[file];
      if (before === undefined ? lines > NEW_FILE_LIMIT : lines > before) raises.push(`${file}: ${before ?? "new"} -> ${lines}`);
    }
  }

  if (raises.length > 0 && !allowRaise) {
    console.log("Refusing to raise the CSS budget without --allow-raise:");
    for (const line of raises) console.log(`  - ${line}`);
    return 1;
  }
  if (raises.length > 0) {
    console.log("WARNING: raising the CSS budget:");
    for (const line of raises) console.log(`  - ${line}`);
  }

  writeFileSync(BUDGET_PATH, `${JSON.stringify(now, null, 2)}\n`);
  console.log(`Wrote ${BUDGET_PATH}.`);
  return 0;
}

function main(argv) {
  const now = scan();
  if (argv.includes("--write")) return writeBudget(now, argv.includes("--allow-raise"));
  const budget = readBudget();
  if (!budget) {
    console.log(`No budget at ${BUDGET_PATH}. Run: node scripts/qa/css-budget.mjs --write`);
    return 1;
  }
  return report(budget, now);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
