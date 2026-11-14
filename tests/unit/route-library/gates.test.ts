import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { buildPack, nonAnswerProblems, phraseSnapshot, type BuildOptions, type BuildResult, type PhraseSnapshot } from "../../../scripts/route-library/pack-builder";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SOURCE = path.join(ROOT, "tests/fixtures/route-library/source");
const POLICY = path.join(ROOT, "scripts/route-library/sources-policy.json");
const RECORD = "routes/PA/pa-pa-151-south-heights-hookstown";
const RECORD_ID = "pa-pa-151-south-heights-hookstown";
const GATES = ["id-collision", "duplicate-id", "validator-errors", "credit", "ride-points", "index-size", "state-line-size", "pack-size", "null-facts", "ride-count-drop"];

const work = mkdtempSync(path.join(tmpdir(), "route-library-gates-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function build(name: string, options: Partial<BuildOptions> = {}): BuildResult {
  return buildPack({ libraryDir: SOURCE, outDir: path.join(work, name), policyPath: POLICY, packName: "pack.sqlite", ...options });
}

function readRecord(): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(ROOT, "tests/fixtures/route-library/source", `${RECORD}.json`), "utf8")) as Record<string, unknown>;
}

/** A one-record library in its own folder, modified the way a bad input would be. */
function library(name: string, mutate: (record: Record<string, unknown>) => void, files = 1): string {
  const dir = path.join(work, name);
  mkdirSync(path.join(dir, "routes/PA"), { recursive: true });
  for (let index = 0; index < files; index += 1) {
    const record = readRecord();
    mutate(record);
    const base = path.join(dir, RECORD.slice(0, RECORD.lastIndexOf("/") + 1));
    writeFileSync(path.join(base, `${RECORD.slice(RECORD.lastIndexOf("/") + 1)}${index === 0 ? "" : `-${index}`}.json`), JSON.stringify(record));
  }
  writeFileSync(path.join(dir, `${RECORD}.gpx`), readFileSync(path.join(ROOT, "tests/fixtures/route-library/source", `${RECORD}.gpx`)));
  return dir;
}

function gate(result: BuildResult, name: string) {
  const found = result.gates.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no gate named ${name}`);
  return found;
}

describe("the gate table on the fixture library", () => {
  const result = build("clean");

  it("writes one line per named check, and every check passes", () => {
    expect(result.gates.map((entry) => entry.name)).toEqual(GATES);
    expect(result.gates.filter((entry) => !entry.ok)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    for (const name of GATES) expect(result.report).toContain(`| ${name} | pass |`);
  });

  it("prints the only override, or that there is none", () => {
    expect(result.report).toContain("- Build overrides: none");
    const allowed = build("allowed", { allowDrop: true });
    expect(allowed.report).toContain("- Build overrides: `--allow-drop`");
  });

  it("keeps the structural checks at zero and lists what it skipped", () => {
    expect(gate(result, "validator-errors").detail).toContain("0 validator errors in 14 shipped records");
    expect(gate(result, "credit").detail).toContain("every one of 14 rides");
    const bad = build("bad-record", { libraryDir: library("validator", (record) => (record["value_score"] = 9)) });
    expect(gate(bad, "validator-errors").ok).toBe(true);
    expect(bad.report).toContain("1 records skipped and listed below");
    expect(bad.report).toContain("value_score must be a whole number from 1 to 5");
  });
});

describe("each gate fails on a crafted input and names the record", () => {
  it("id-collision names the id that clashes with the curated catalog", () => {
    const catalog = path.join(work, "catalog.json");
    writeFileSync(catalog, JSON.stringify([{ id: RECORD_ID }]));
    const result = build("collide", { libraryDir: library("collide-lib", () => undefined), catalogPath: catalog });
    const check = gate(result, "id-collision");
    expect(result.ok).toBe(false);
    expect(check.ok).toBe(false);
    expect(check.detail).toContain(RECORD_ID);
    expect(result.report).toContain(`| id-collision | FAIL |`);
  });

  it("duplicate-id names the id that appears twice", () => {
    const result = build("duplicate", { libraryDir: library("duplicate-lib", () => undefined, 2) });
    expect(gate(result, "duplicate-id").detail).toContain(`${RECORD_ID} appears twice`);
    expect(result.ok).toBe(false);
  });

  it("ride-points names the ride over the cap", () => {
    const result = build("points", { libraryDir: library("points-lib", () => undefined), budgets: { ridePoints: 10 } });
    expect(gate(result, "ride-points").detail).toMatch(new RegExp(`${RECORD_ID} has \\d+ points \\(cap 10\\)`));
    expect(result.ok).toBe(false);
  });

  it("index-size names the index", () => {
    const result = build("index", { budgets: { indexGzipBytes: 10 } });
    expect(gate(result, "index-size").detail).toMatch(/index is \d+ bytes gzipped \(cap 10\)$/);
    expect(result.ok).toBe(false);
  });

  it("state-line-size names the state file", () => {
    const result = build("state", { libraryDir: library("state-lib", () => undefined), budgets: { stateLinesGzipBytes: 10 } });
    expect(gate(result, "state-line-size").detail).toContain("lines/PA is ");
    expect(gate(result, "state-line-size").detail).toContain("(cap 10)");
    expect(result.ok).toBe(false);
  });

  it("pack-size names the pack's bytes", () => {
    const result = build("pack", { budgets: { packBytes: 10 } });
    expect(gate(result, "pack-size").detail).toMatch(/pack is \d+ bytes \(cap 10\)$/);
    expect(result.ok).toBe(false);
  });

  it("drops a claim the record cannot show a source for, and lists it", () => {
    const dir = library("facts-lib", (record) => {
      const surface = record["surface"] as Record<string, unknown>;
      delete surface["surface_claim_source"];
    });
    const result = build("facts", { libraryDir: dir });
    expect(gate(result, "null-facts").ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.report).toContain("Claims dropped because the record names no source");
    expect(result.report).toContain(`| ${RECORD_ID} | surface | paved | paved |`);
    expect(result.report).toContain(`| ${RECORD_ID} | legal | public-roads | public-roads |`);
    const detail = JSON.parse(
      gunzipSync((new DatabaseSync(path.join(work, "facts/pack.sqlite"), { readOnly: true }).prepare("SELECT detail FROM ride WHERE id = ?").get(RECORD_ID) as { detail: Uint8Array }).detail).toString("utf8"),
    ) as { facts: { surface: { value: string | null; quote: string | null; source: string | null } } };
    expect(detail.facts.surface).toEqual({ value: null, quote: "paved", source: null });
  });

  it("keeps the difficulty's own source and never borrows the surface source", () => {
    const dir = library("difficulty-lib", (record) => {
      const surface = record["surface"] as Record<string, unknown>;
      surface["difficulty"] = "moderate";
      delete surface["difficulty_source"];
    });
    const result = build("difficulty", { libraryDir: dir });
    expect(gate(result, "null-facts").ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.report).toContain(`| ${RECORD_ID} | difficulty | moderate | moderate |`);
  });

  it("ride-count-drop names both counts, and --allow-drop is the only way past it", () => {
    const smaller = library("drop-lib", () => undefined);
    const out = path.join(work, "drop");
    buildPack({ libraryDir: SOURCE, outDir: out, policyPath: POLICY });
    const dropped = buildPack({ libraryDir: smaller, outDir: out, policyPath: POLICY });
    expect(gate(dropped, "ride-count-drop").ok).toBe(false);
    expect(gate(dropped, "ride-count-drop").detail).toContain("ride count fell from 14 to 1 (more than 2%)");
    expect(dropped.report).toContain("| ride-count-drop | FAIL |");
    expect(dropped.ok).toBe(false);

    const allowedOut = path.join(work, "drop-allowed");
    buildPack({ libraryDir: SOURCE, outDir: allowedOut, policyPath: POLICY });
    const allowed = buildPack({ libraryDir: smaller, outDir: allowedOut, policyPath: POLICY, allowDrop: true });
    expect(allowed.ok).toBe(true);
    expect(gate(allowed, "ride-count-drop").detail).toContain("14 rides in the earlier pack, 1 now; allowed by --allow-drop");
    expect(allowed.report).toContain("- Build overrides: `--allow-drop`");
  });
});

describe("the phrase snapshot", () => {
  it("is written where the builder is told, with a count and a value per phrase", () => {
    const snapshotPath = path.join(work, "phrases.json");
    const result = build("snapshot", { snapshotPath });
    const written = JSON.parse(readFileSync(snapshotPath, "utf8")) as { facts: PhraseSnapshot };
    expect(Object.keys(written.facts)).toEqual(["surface", "legal", "difficulty", "permits", "season"]);
    expect(written.facts.surface[0]).toEqual({ phrase: "paved", count: 8, value: "paved", tableRow: true });
    expect(written.facts.legal).toContainEqual({ phrase: "designated-ohv", count: 2, value: "designated-ohv", tableRow: true });
    expect(result.report).toContain(`\`${snapshotPath}\``);
  });

  it("goes into the output folder by default, next to the report, and never edits the repo's copy", () => {
    const repoSnapshot = path.join(ROOT, "scripts/route-library/phrases.snapshot.json");
    const before = readFileSync(repoSnapshot, "utf8");
    const out = path.join(work, "snapshot-default");
    const result = buildPack({ libraryDir: SOURCE, outDir: out, policyPath: POLICY, packName: "pack.sqlite" });
    const written = readFileSync(path.join(out, "phrases.snapshot.json"), "utf8");
    expect(written).toEqual(before);
    expect(readFileSync(repoSnapshot, "utf8")).toEqual(before);
    expect(result.report).toContain(`\`${path.join(out, "phrases.snapshot.json")}\``);
    expect(result.report).toContain("never over the repository's copy");
  });

  it("matches the committed snapshot, so the repo file is always a real build's output", () => {
    const snapshotPath = path.join(work, "committed-snapshot.json");
    build("snapshot-committed", { snapshotPath });
    const written = JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown;
    const committed = JSON.parse(readFileSync(path.join(ROOT, "scripts/route-library/phrases.snapshot.json"), "utf8")) as unknown;
    expect(written).toEqual(committed);
  });

  it("turns a non-answer that carries a value into a null-facts failure", () => {    const crafted: PhraseSnapshot = {
      surface: [{ phrase: "unknown", count: 1, value: "paved", tableRow: true }],
      legal: [{ phrase: "unknown", count: 1, value: null, tableRow: true }],
      difficulty: [{ phrase: "unknown", count: 1, value: null, tableRow: true }],
      permits: [{ phrase: "none stated", count: 1, value: null, tableRow: true }],
      season: [{ phrase: "varies", count: 1, value: null, tableRow: true }],
    };
    expect(nonAnswerProblems(crafted)).toEqual(['surface phrase "unknown" is a non-answer but maps to "paved"']);
    expect(nonAnswerProblems(phraseSnapshot({ surface: new Map(), legal: new Map(), difficulty: new Map(), permits: new Map(), season: new Map() }))).toEqual([]);
  });
});
