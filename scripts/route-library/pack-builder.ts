/**
 * The national ride library pack builder (plan section 5.1, stages 1 to 6 and 9).
 * Reads `<library>/routes/<ST>/<id>.json` (+ its GPX), one file at a time, and
 * writes one SQLite pack. Dedupe and locate are package L2: `alias` stays empty.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";

import { buildIndexRow } from "@/application/route-library/index-row";
import { buildGeometry, MAX_RIDE_POINTS } from "@/application/route-library/geometry";
import { hasFactRow, phraseFor, saysNothing, type FactName, type RideFacts } from "@/application/route-library/facts";
import { parseSourcesPolicy, policyForSource, type SourcesPolicy } from "@/application/route-library/policy";
import { checkLibraryRecord } from "@/application/route-library/record";
import { deriveRide } from "@/application/route-library/ride-detail";
import type { IndexRow, LibraryRecord, RideDetail } from "@/application/route-library/types";
import { parseGpx } from "@/infrastructure/import/gpx-parser";
import type { Coordinate } from "@/domain/ride/types";

export const PACK_SCHEMA = 1;
export const BUDGETS = {
  indexGzipBytes: 400 * 1024,
  stateLinesGzipBytes: 200 * 1024,
  packBytes: 60 * 1024 * 1024,
  ridePoints: MAX_RIDE_POINTS,
  dropFraction: 0.02,
} as const;

/** Every quality gate plan section 5.2 asks for, plus the id collision from stage 1 and the pack size from L1a. */
export interface GateResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly problems: readonly string[];
}

export interface BuildOptions {
  readonly libraryDir: string;
  readonly outDir: string;
  readonly policyPath: string;
  /** Curated catalog (`data/catalog/routes.json.gz`); library ids may not collide with it. */
  readonly catalogPath?: string | undefined;
  /** Exact file name for the pack (the fixture uses `pack.sqlite`); default `route-library-<version>.sqlite`. */
  readonly packName?: string | undefined;
  readonly allowDrop?: boolean | undefined;
  /** Tests lower a budget to prove the gate fires; production never passes this. */
  readonly budgets?: Partial<Record<keyof typeof BUDGETS, number>> | undefined;
  /**
   * Where the phrase snapshot is written (plan 5.2, the `null` fact check).
   * Omitted: no snapshot is written, so a unit test cannot change the repo.
   */
  readonly snapshotPath?: string | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

export interface BuildResult {
  readonly ok: boolean;
  readonly version: string;
  readonly packPath: string;
  readonly reportPath: string;
  readonly report: string;
  readonly failures: readonly string[];
  readonly gates: readonly GateResult[];
  readonly counts: { readonly rides: number; readonly located: number; readonly withLine: number };
}

interface Skipped { readonly id: string; readonly reasons: readonly string[] }

function memoryAvailableMb(): number | null {
  try {
    const match = /MemAvailable:\s+(\d+) kB/.exec(readFileSync("/proc/meminfo", "utf8"));
    return match === null ? null : Number(match[1]) / 1024;
  } catch {
    return null;
  }
}

function gzipJson(value: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 });
}

function catalogIds(catalogPath: string | undefined): ReadonlySet<string> {
  if (catalogPath === undefined || !existsSync(catalogPath)) return new Set();
  const raw = readFileSync(catalogPath);
  const text = catalogPath.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  const parsed: unknown = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : [];
  return new Set(list.map((entry) => (typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined)).filter((id): id is string => typeof id === "string"));
}

/**
 * Last resort for a huge bundle the app's importer refuses (more than 50
 * tracks, or one very long text field): read just the track points.
 */
function scanSegments(xml: string): readonly (readonly Coordinate[])[] {
  const pointsOf = (block: string, tag: "trkpt" | "rtept"): Coordinate[] => {
    const points: Coordinate[] = [];
    for (const match of block.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))) {
      const lat = Number(/\blat="([^"]+)"/.exec(match[1] ?? "")?.[1]);
      const lon = Number(/\blon="([^"]+)"/.exec(match[1] ?? "")?.[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) points.push({ lat, lon });
    }
    return points;
  };
  const tracks = [...xml.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g)].map((match) => pointsOf(match[1] ?? "", "trkpt")).filter((segment) => segment.length >= 2);
  if (tracks.length > 0) return tracks;
  return [...xml.matchAll(/<rte\b[^>]*>([\s\S]*?)<\/rte>/g)].map((match) => pointsOf(match[1] ?? "", "rtept")).filter((segment) => segment.length >= 2);
}

function readSegments(gpxPath: string, bundle: boolean, onFallback: () => void): readonly (readonly Coordinate[])[] {
  const xml = readFileSync(gpxPath, "utf8");
  let parsed: ReturnType<typeof parseGpx>;
  try {
    parsed = parseGpx(xml, { filename: path.basename(gpxPath), byteLength: Buffer.byteLength(xml) });
  } catch (error) {
    const refused = error instanceof RangeError || (error instanceof Error && error.name === "ImportSecurityError");
    if (!refused) throw error;
    onFallback();
    const scanned = scanSegments(xml);
    return bundle ? scanned : [scanned.flat()];
  }
  const tracks = parsed.tracks.filter((track) => track.sourceKind === "track");
  const chosen = tracks.length > 0 ? tracks : parsed.tracks.filter((track) => track.sourceKind === "route");
  const segments = chosen.flatMap((track) => track.segments);
  return bundle ? segments : [segments.flat()];
}

function tally(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function table(title: string, counts: ReadonlyMap<string, number>): string {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return [`### ${title}`, "", "| Value | Rides |", "|---|---|", ...rows.map(([key, value]) => `| ${key} | ${value} |`), ""].join("\n");
}

const FACT_NAMES: readonly FactName[] = ["surface", "legal", "difficulty", "permits", "season"];

/** One phrase seen, how often, and the value the tables gave it. This is what a reviewer reads. */
interface PhraseRow {
  readonly phrase: string;
  readonly count: number;
  readonly value: string | null;
  readonly tableRow: boolean;
}

export type PhraseSnapshot = Readonly<Record<FactName, readonly PhraseRow[]>>;

/**
 * Every distinct phrase seen for each fact, with its count and mapped value
 * (plan 5.1 stage 6, and the `null` fact gate in 5.2). Season and permits are
 * carried, not normalised, so their `value` is the source's own words.
 */
export function phraseSnapshot(tallies: Readonly<Record<FactName, ReadonlyMap<string, { count: number; value: string | null }>>>): PhraseSnapshot {
  const snapshot = {} as Record<FactName, readonly PhraseRow[]>;
  for (const fact of FACT_NAMES) {
    const rows = [...(tallies[fact] ?? new Map()).entries()].map(([phrase, seen]) => ({
      phrase,
      count: seen.count,
      value: seen.value,
      tableRow: hasFactRow(fact, phrase),
    }));
    rows.sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
    snapshot[fact] = rows;
  }
  return snapshot;
}

/** The gate check on a snapshot: a phrase that is a non-answer must never carry a value. */
export function nonAnswerProblems(snapshot: PhraseSnapshot): readonly string[] {
  const problems: string[] = [];
  for (const fact of FACT_NAMES) {
    for (const row of snapshot[fact]) {
      if (row.value !== null && saysNothing(row.phrase)) problems.push(`${fact} phrase "${row.phrase}" is a non-answer but maps to "${row.value}"`);
    }
  }
  return problems;
}

function factsWithValue(detail: RideDetail): readonly (readonly [FactName, RideFacts[FactName]])[] {
  return FACT_NAMES.map((name) => [name, detail.facts[name]] as const);
}

export function buildPack(options: BuildOptions): BuildResult {
  const log = options.log ?? (() => undefined);
  const started = Date.now();
  const budgets = { ...BUDGETS, ...options.budgets };
  const policy: SourcesPolicy = parseSourcesPolicy(JSON.parse(readFileSync(options.policyPath, "utf8")));
  const curated = catalogIds(options.catalogPath);
  const routesDir = path.join(options.libraryDir, "routes");
  if (!existsSync(routesDir)) throw new Error(`No routes folder in ${options.libraryDir}`);
  mkdirSync(options.outDir, { recursive: true });
  const tmpPath = path.join(options.outDir, `.building-${process.pid}.sqlite`);
  rmSync(tmpPath, { force: true });

  const db = new DatabaseSync(tmpPath);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE ride (id TEXT PRIMARY KEY, detail BLOB NOT NULL, line TEXT NOT NULL, points INTEGER NOT NULL);
    CREATE TABLE asset (key TEXT PRIMARY KEY, body BLOB NOT NULL, content_type TEXT NOT NULL);
    CREATE TABLE alias (id TEXT PRIMARY KEY, primary_id TEXT NOT NULL);
  `);
  const insertRide = db.prepare("INSERT INTO ride (id, detail, line, points) VALUES (?, ?, ?, ?)");

  // Problems are collected per gate, then each gate writes one line in the report.
  const collisions: string[] = [];
  const duplicateIds: string[] = [];
  const creditProblems: string[] = [];
  const pointsProblems: string[] = [];
  const factProblems: string[] = [];
  const skipped: Skipped[] = [];
  const hidden: string[] = [];
  const unreadable: { id: string; why: string }[] = [];
  const fallbackRead: string[] = [];
  const rows: { row: IndexRow; sourceName: string }[] = [];
  const mapLines = new Map<string, { id: string; line: string }[]>();
  const seen = new Set<string>();
  const hash = createHash("sha256");
  const byType = new Map<string, number>();
  const byKind = new Map<string, number>();
  const byMode = new Map<string, number>();
  const byFlag = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byAvailability = new Map<string, number>();
  const phraseTallies: Record<FactName, Map<string, { count: number; value: string | null }>> = {
    surface: new Map(),
    legal: new Map(),
    difficulty: new Map(),
    permits: new Map(),
    season: new Map(),
  };
  const nullFacts: { id: string; fact: FactName; quote: string | null }[] = [];
  let derivedCredit = 0;
  let maxPoints = 0;
  let mismatches = 0;

  const states = readdirSync(routesDir).filter((name) => statSync(path.join(routesDir, name)).isDirectory()).sort();
  db.exec("BEGIN");
  let processed = 0;
  for (const stateDir of states) {
    const folder = path.join(routesDir, stateDir);
    const files = readdirSync(folder).filter((name) => name.endsWith(".json")).sort();
    for (const file of files) {
      processed += 1;
      if (processed % 500 === 0) {
        const available = memoryAvailableMb();
        log(`  ${processed} records, rss ${Math.round(process.memoryUsage().rss / 1048576)} MB, available ${available === null ? "?" : Math.round(available)} MB`);
        if (available !== null && available < 1000) throw new Error(`Stopping: only ${Math.round(available)} MB of memory is free.`);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path.join(folder, file), "utf8"));
      } catch {
        skipped.push({ id: `${stateDir}/${file}`, reasons: ["not valid JSON"] });
        continue;
      }
      const checked = checkLibraryRecord(raw);
      if (!checked.ok) {
        skipped.push({ id: `${stateDir}/${file}`, reasons: checked.reasons });
        continue;
      }
      const record: LibraryRecord = checked.record;
      const rule = policyForSource(policy, record.source.name);
      if (rule.mode === "hide") {
        hidden.push(record.id);
        continue;
      }
      if (curated.has(record.id)) collisions.push(`${record.id} collides with a curated catalog id`);
      if (seen.has(record.id)) {
        duplicateIds.push(`${record.id} appears twice in the library`);
        continue;
      }
      seen.add(record.id);

      let built = null;
      if (rule.mode === "host" && record.gpx.availability === "hosted" && record.gpx.local_file !== undefined) {
        const gpxPath = path.join(folder, record.gpx.local_file);
        try {
          built = buildGeometry(readSegments(gpxPath, record.gpx.is_bundle === true, () => fallbackRead.push(record.id)), { bundle: record.gpx.is_bundle === true });
          if (built === null) unreadable.push({ id: record.id, why: "track has no line of two points" });
        } catch (error) {
          unreadable.push({ id: record.id, why: error instanceof Error ? error.message : "unreadable track" });
        }
      }
      const derived = deriveRide(record, rule, built);
      if (record.author_credit.credit_line === undefined || record.author_credit.credit_line.trim() === "") derivedCredit += 1;
      if (derived.detail.credit.creditLine.trim() === "" || derived.detail.credit.sourceUrl.trim() === "") creditProblems.push(`${record.id} has no credit line or source address`);
      maxPoints = Math.max(maxPoints, derived.detail.points);
      if (derived.detail.points > budgets.ridePoints) pointsProblems.push(`${record.id} has ${derived.detail.points} points (cap ${budgets.ridePoints})`);
      if (derived.detail.track.mismatch) mismatches += 1;
      for (const [fact, value] of factsWithValue(derived.detail)) {
        if (value.value === null) {
          nullFacts.push({ id: record.id, fact, quote: value.quote });
          continue;
        }
        if (value.quote === null) factProblems.push(`${record.id}: ${fact} is "${String(value.value)}" with no quote from the source`);
        else if (value.source === null) factProblems.push(`${record.id}: ${fact} is "${String(value.value)}" with no source named`);
      }
      for (const fact of FACT_NAMES) {
        const raw = phraseFor(record, fact);
        const phrase = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
        if (phrase === "") continue;
        const tally = phraseTallies[fact];
        const seenPhrase = tally.get(phrase);
        const mapped = derived.detail.facts[fact].value;
        if (seenPhrase === undefined) tally.set(phrase, { count: 1, value: typeof mapped === "string" ? mapped : null });
        else seenPhrase.count += 1;
      }

      const detailJson = JSON.stringify(derived.detail);
      insertRide.run(record.id, gzipSync(Buffer.from(detailJson), { level: 9 }), derived.line, derived.detail.points);
      hash.update(`${record.id}\n${detailJson}\n${derived.line}\n`);
      const row = buildIndexRow(derived, -1);
      rows.push({ row, sourceName: record.source.name });
      if (derived.mapLine !== null && derived.mapLine !== "") {
        for (const state of derived.detail.states) {
          const list = mapLines.get(state) ?? [];
          list.push({ id: record.id, line: derived.mapLine });
          mapLines.set(state, list);
        }
      }
      tally(byType, derived.detail.type);
      tally(byKind, derived.detail.kind);
      tally(byMode, rule.mode);
      tally(bySource, record.source.name);
      tally(byAvailability, derived.detail.track.availability);
      for (const [name, bit] of [["line", 1], ["loop", 2], ["gpx", 4], ["old", 8], ["rough", 16], ["notes", 32], ["stops", 64]] as const) {
        if ((row.f & bit) !== 0) tally(byFlag, name);
      }
    }
  }

  // Index: sources list sorted by name; rows ordered by id so the file is stable.
  const sources = [...new Set(rows.map((entry) => entry.sourceName))].sort((a, b) => a.localeCompare(b));
  const sourceIndex = new Map(sources.map((name, index) => [name, index]));
  const indexRows: IndexRow[] = rows
    .map((entry) => ({ ...entry.row, s: sourceIndex.get(entry.sourceName) ?? 0 }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stateCounts: Record<string, number> = {};
  for (const row of indexRows) for (const state of row.st) stateCounts[state] = (stateCounts[state] ?? 0) + 1;
  const sortedStateCounts = Object.fromEntries(Object.entries(stateCounts).sort(([a], [b]) => a.localeCompare(b)));

  const stateFiles = new Map<string, unknown>();
  for (const [state, list] of [...mapLines.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    stateFiles.set(state, { state, precision: 5, lines: list.sort((a, b) => (a.id < b.id ? -1 : 1)).map((entry) => [entry.id, entry.line]) });
  }
  hash.update(JSON.stringify({ rows: indexRows, sources, stateFiles: [...stateFiles.entries()] }));
  const version = hash.digest("hex").slice(0, 12);

  const insertAsset = db.prepare("INSERT INTO asset (key, body, content_type) VALUES (?, ?, ?)");
  const indexBody = gzipJson({ version, precision: 5, sources, stateCounts: sortedStateCounts, rows: indexRows });
  insertAsset.run("index", indexBody, "application/json");
  const stateSizes: { state: string; bytes: number }[] = [];
  const stateProblems: string[] = [];
  for (const [state, value] of stateFiles) {
    const body = gzipJson(value);
    stateSizes.push({ state, bytes: body.length });
    insertAsset.run(`lines/${state}`, body, "application/json");
    if (body.length > budgets.stateLinesGzipBytes) stateProblems.push(`lines/${state} is ${body.length} bytes gzipped (cap ${budgets.stateLinesGzipBytes})`);
  }
  const indexProblems: string[] = [];
  if (indexBody.length > budgets.indexGzipBytes) indexProblems.push(`index is ${indexBody.length} bytes gzipped (cap ${budgets.indexGzipBytes})`);

  const snapshot = phraseSnapshot(phraseTallies);
  if (options.snapshotPath !== undefined) {
    mkdirSync(path.dirname(options.snapshotPath), { recursive: true });
    writeFileSync(options.snapshotPath, `${JSON.stringify({ facts: snapshot }, null, 1)}\n`);
  }

  const located = indexRows.filter((row) => row.p !== null).length;
  const withLine = indexRows.filter((row) => (row.f & 1) !== 0).length;
  const builtAt = new Date().toISOString();
  const manifest = { version, builtAt, rides: indexRows.length, located, withLine, states: sortedStateCounts };
  const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries({
    schema: String(PACK_SCHEMA),
    version,
    built_at: builtAt,
    polyline_precision: "5",
    rides: String(indexRows.length),
    located: String(located),
    with_line: String(withLine),
    manifest: JSON.stringify(manifest),
  })) insertMeta.run(key, value);
  db.exec("COMMIT");
  db.close();

  // Drop against the previous pack in the output folder.
  let previousRides: number | null = null;
  const previous = readdirSync(options.outDir)
    .filter((name) => /^route-library-.*\.sqlite$/.test(name) || name === options.packName)
    .map((name) => ({ name, time: statSync(path.join(options.outDir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0];
  if (previous !== undefined) {
    try {
      const old = new DatabaseSync(path.join(options.outDir, previous.name), { readOnly: true });
      const row = old.prepare("SELECT value FROM meta WHERE key = 'rides'").get() as { value: string } | undefined;
      previousRides = row === undefined ? null : Number(row.value);
      old.close();
    } catch {
      previousRides = null;
    }
  }
  const dropped = previousRides !== null && previousRides > 0 && indexRows.length < previousRides * (1 - budgets.dropFraction);
  const dropDetail =
    previousRides === null
      ? `no earlier pack in ${options.outDir} to compare`
      : `${previousRides} rides in the earlier pack, ${indexRows.length} now${dropped ? `; allowed by --allow-drop` : ""}`;
  const dropProblems = dropped && options.allowDrop !== true ? [`ride count fell from ${previousRides} to ${indexRows.length} (more than ${Math.round(budgets.dropFraction * 100)}%); pass --allow-drop if that is intended`] : [];

  const packName = options.packName ?? `route-library-${version}.sqlite`;
  const packPath = path.join(options.outDir, packName);
  renameSync(tmpPath, packPath);
  const packBytes = statSync(packPath).size;

  const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
  const largest = [...stateSizes].sort((a, b) => b.bytes - a.bytes)[0];

  // The gates: one named check each, one line each in the report, and a non-zero exit on any failure.
  const gates: GateResult[] = [];
  const gate = (name: string, problems: readonly string[], okDetail: string): void => {
    const detail =
      problems.length === 0
        ? okDetail
        : `${problems.length} problem(s): ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? `; and ${problems.length - 5} more (all listed under Gate failures)` : ""}`;
    gates.push({ name, ok: problems.length === 0, detail, problems });
  };
  gate("id-collision", collisions, `no library id collides with a curated catalog id (${curated.size} curated ids checked)`);
  gate("duplicate-id", duplicateIds, "every library id appears once");
  gate("validator-errors", [], `0 validator errors in ${indexRows.length} shipped records (${skipped.length} records skipped and listed below)`);
  gate("credit", creditProblems, `every one of ${indexRows.length} rides has a credit line and a source address`);
  gate("ride-points", pointsProblems, `the longest ride is ${maxPoints} points (cap ${budgets.ridePoints})`);
  gate("index-size", indexProblems, `index ${kb(indexBody.length)} gzipped (cap ${kb(budgets.indexGzipBytes)})`);
  gate(
    "state-line-size",
    stateProblems,
    largest === undefined ? "no state line files" : `${stateSizes.length} state line files; largest is ${largest.state} at ${kb(largest.bytes)} (cap ${kb(budgets.stateLinesGzipBytes)})`,
  );
  gate("pack-size", packBytes > budgets.packBytes ? [`pack is ${packBytes} bytes (cap ${budgets.packBytes})`] : [], `pack ${(packBytes / 1048576).toFixed(2)} MB (cap ${(budgets.packBytes / 1048576).toFixed(0)} MB)`);
  gate(
    "null-facts",
    [...factProblems, ...nonAnswerProblems(snapshot)],
    `no null fact is rendered as a value; ${nullFacts.length} facts are null and say so (listed below)`,
  );
  gate("ride-count-drop", dropProblems, dropDetail);
  const failures = gates.flatMap((entry) => entry.problems.map((problem) => `${entry.name}: ${problem}`));

  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const overrideLine =
    options.allowDrop === true ? "- Build overrides: `--allow-drop` (the ride count may fall more than 2% without failing the build)" : "- Build overrides: none";
  const report = [
    "# Route library pack report",
    "",
    `- Version: \`${version}\``,
    `- Built: ${builtAt} in ${seconds} s from ${options.libraryDir}`,
    `- Result: ${failures.length === 0 ? "PASS" : "FAIL"}`,
    overrideLine,
    `- Rides packed: ${indexRows.length} (located on the map: ${located}, with a line: ${withLine}, list-only: ${indexRows.length - located})`,
    `- Records skipped by the gate: ${skipped.length}; hidden by policy: ${hidden.length}; tracks that could not be read: ${unreadable.length}`,
    `- Tracks the app importer refused (too many tracks or long text) that were read by the point scanner instead: ${fallbackRead.length}`,
    `- Credit lines taken from the source: ${indexRows.length - derivedCredit}; written from author and site name: ${derivedCredit}; missing: 0`,
    `- Length mismatches flagged (measured vs source's stated miles, over 40%): ${mismatches}`,
    `- Duplicate groups: 0 (dedupe is package L2; \`alias\` is empty)`,
    "",
    "## Gates",
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...gates.map((entry) => `| ${entry.name} | ${entry.ok ? "pass" : "FAIL"} | ${entry.detail.replace(/\|/g, "\\|")} |`),
    "",
    "## Sizes against budgets",
    "",
    "| Piece | Size | Budget | |",
    "|---|---|---|---|",
    `| Index (gzipped) | ${kb(indexBody.length)} | ${kb(budgets.indexGzipBytes)} | ${indexBody.length <= budgets.indexGzipBytes ? "ok" : "OVER"} |`,
    `| Largest state line file (gzipped) | ${largest === undefined ? "none" : `${largest.state} ${kb(largest.bytes)}`} | ${kb(budgets.stateLinesGzipBytes)} | ${largest === undefined || largest.bytes <= budgets.stateLinesGzipBytes ? "ok" : "OVER"} |`,
    `| Pack on disk | ${(packBytes / 1048576).toFixed(2)} MB | ${(budgets.packBytes / 1048576).toFixed(0)} MB | ${packBytes <= budgets.packBytes ? "ok" : "OVER"} |`,
    `| Most points in one ride | ${maxPoints} | ${budgets.ridePoints} | ${maxPoints <= budgets.ridePoints ? "ok" : "OVER"} |`,
    "",
    "## Gate failures",
    "",
    failures.length === 0 ? "None." : failures.map((line) => `- ${line}`).join("\n"),
    "",
    "## Facts the source did not state (the ride detail keeps `\"value\": null`)",
    "",
    `Facts left null: ${nullFacts.length} of ${indexRows.length * FACT_NAMES.length}. The quote is kept when the source did say something the tables could not classify.`,
    "",
    ...(nullFacts.length === 0
      ? ["None."]
      : [
          "| Ride | Fact | The source's words |",
          "|---|---|---|",
          ...nullFacts.slice(0, 200).map((entry) => `| ${entry.id} | ${entry.fact} | ${entry.quote === null ? "(nothing)" : entry.quote.replace(/\|/g, "\\|")} |`),
          nullFacts.length > 200 ? `| ... ${nullFacts.length - 200} more | | |` : "",
        ]),
    "",
    "## Phrase snapshot",
    "",
    `Every distinct phrasing this build saw, with its count and mapped value: \`${options.snapshotPath ?? "(not written)"}\`.`,
    "",
    ...FACT_NAMES.map((fact) => `- ${fact}: ${snapshot[fact].length} distinct phrasing(s); ${snapshot[fact].filter((row) => row.value === null).length} map to no value`),
    "",
    "## Counts",
    "",
    table("By type", byType),
    table("By kind", byKind),
    table("By policy mode", byMode),
    table("By track availability", byAvailability),
    table("By flag", byFlag),
    "### By state (a ride in several states counts in each)",
    "",
    "| State | Rides |",
    "|---|---|",
    ...Object.entries(sortedStateCounts).map(([state, count]) => `| ${state} | ${count} |`),
    "",
    `### Sources (${sources.length})`,
    "",
    "| Source | Rides |",
    "|---|---|",
    ...[...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, count]) => `| ${name} | ${count} |`),
    sources.length > 40 ? `| ... and ${sources.length - 40} more | |` : "",
    "",
    "## Skipped records",
    "",
    skipped.length === 0 ? "None." : skipped.slice(0, 200).map((entry) => `- ${entry.id}: ${entry.reasons.join("; ")}`).join("\n"),
    "",
    "## Tracks that could not be read (the ride is packed without a line, with its source link)",
    "",
    unreadable.length === 0 ? "None." : unreadable.slice(0, 200).map((entry) => `- ${entry.id}: ${entry.why}`).join("\n"),
    "",
    "## Hidden by policy",
    "",
    hidden.length === 0 ? "None." : hidden.slice(0, 200).map((id) => `- ${id}`).join("\n"),
    "",
  ].join("\n");
  const reportPath = path.join(options.outDir, "pack-report.md");
  writeFileSync(reportPath, report);
  return { ok: failures.length === 0, version, packPath, reportPath, report, failures, gates, counts: { rides: indexRows.length, located, withLine } };
}
