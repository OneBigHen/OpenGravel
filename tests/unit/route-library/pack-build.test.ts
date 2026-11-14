import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { buildPack } from "../../../scripts/route-library/pack-builder";
import type { IndexRow, RideDetail } from "@/application/route-library/types";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SOURCE = path.join(ROOT, "tests/fixtures/route-library/source");
const POLICY = path.join(ROOT, "scripts/route-library/sources-policy.json");
const work = mkdtempSync(path.join(tmpdir(), "route-library-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function build(name: string, policyPath = POLICY, libraryDir = SOURCE) {
  return buildPack({ libraryDir, outDir: path.join(work, name), policyPath, packName: "pack.sqlite" });
}

function open(packPath: string) {
  const database = new DatabaseSync(packPath, { readOnly: true });
  const asset = (key: string): unknown => {
    const stored = database.prepare("SELECT body FROM asset WHERE key = ?").get(key) as { body: Uint8Array } | undefined;
    return stored === undefined ? null : JSON.parse(gunzipSync(stored.body).toString("utf8"));
  };
  const detail = (id: string): RideDetail => JSON.parse(gunzipSync((database.prepare("SELECT detail FROM ride WHERE id = ?").get(id) as { detail: Uint8Array }).detail).toString("utf8")) as RideDetail;
  return { database, asset, detail };
}

describe("the pack builder on the fixture library", () => {
  const first = build("a");

  it("passes its gates and packs all 14 records", () => {
    expect(first.failures).toEqual([]);
    expect(first.ok).toBe(true);
    expect(first.counts).toEqual({ rides: 14, located: 12, withLine: 11 });
  });

  it("gives the same version when rebuilt", () => {
    const second = build("b");
    expect(second.version).toBe(first.version);
    expect(readFileSync(first.packPath).length).toBeGreaterThan(0);
  });

  it("matches the committed fixture pack", () => {
    const committed = open(path.join(ROOT, "tests/fixtures/route-library/pack.sqlite"));
    const version = (committed.database.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string }).value;
    expect(version).toBe(first.version);
  });

  const { asset, detail, database } = open(first.packPath);
  const index = asset("index") as { version: string; sources: string[]; stateCounts: Record<string, number>; rows: IndexRow[] };
  const row = (id: string): IndexRow => index.rows.find((candidate) => candidate.id === id)!;

  it("writes the index with every row and source", () => {
    expect(index.version).toBe(first.version);
    expect(index.rows).toHaveLength(14);
    expect(index.stateCounts["PA"]).toBe(4);
    expect(index.stateCounts["NY"]).toBe(1);
    expect(index.stateCounts["TN"]).toBe(2);
    expect(new Set(index.rows.map((entry) => index.sources[entry.s])).size).toBe(index.sources.length);
  });

  it("gives the no-coordinate record no pin", () => {
    const area = row("ok-white-water-orv-area");
    expect(area.p).toBeNull();
    expect(area.pp).toBeNull();
    expect(area.bb).toBeNull();
    expect(area.k).toBe("area");
    expect(area.f).toBe(0);
  });

  it("covers the ride shapes the fixture exists for", () => {
    expect(row("nc-diamondback-loop")).toMatchObject({ q: 5, st: ["NC", "TN"], t: "twisty", k: "road", pp: "start" });
    expect(row("nc-cherohala-skyway").t).toBe("scenic");
    expect(row("tx-lovelady-loop").f & 64).toBe(64);
    expect(row("ny-us-6-bear-mountain-bridge-road-peekskill").f & 32).toBe(32);
    expect(row("pa-lancaster-county-loop-tour-ephrata-parkesburg-holtwood-marietta").f & 2).toBe(2);
    expect(row("mi-orv-route-slc")).toMatchObject({ k: "area", t: "trail", mi: null, pp: "area" });
    expect(row("ca-fort-bragg-to-medford").k).toBe("trip");
    expect(row("pa-us-220-pennsdale-athens").f & 8).toBe(8);
    expect(row("al-the-heart-run").f & 16).toBe(16);
    expect(row("nc-cherohala-skyway").f & (8 | 16)).toBe(0);
  });

  it("splits the trail bundle into its three segments", () => {
    const stored = database.prepare("SELECT line FROM ride WHERE id = 'mi-orv-route-slc'").get() as { line: string };
    expect(stored.line.split(";")).toHaveLength(3);
    expect(detail("mi-orv-route-slc")).toMatchObject({ segmentCount: 3, miles: null });
    expect(detail("mi-orv-route-slc").trailMiles).toBeGreaterThan(0);
  });

  it("serves no line for a link source, in the ride or in its state file", () => {
    const bdr = detail("az-arizona-bdr");
    expect(bdr).toMatchObject({ kind: "trip", track: { availability: "link", gpxAllowed: false } });
    expect(row("az-arizona-bdr").f & (1 | 4)).toBe(0);
    const stateFile = asset("lines/AZ");
    expect(stateFile).toBeNull();
  });

  it("never turns a null season, permit, difficulty or surface into a value", () => {
    for (const entry of index.rows) {
      const facts = detail(entry.id).facts;
      for (const fact of Object.values(facts)) {
        if (fact.value === null) continue;
        expect(String(fact.value).toLowerCase()).not.toMatch(/^(unknown|none stated|)$/);
        expect(fact.quote).not.toBeNull();
        expect(fact.source).not.toBeNull();
      }
    }
    const unknownSurface = detail("tx-lovelady-loop").facts.surface;
    expect(unknownSurface.value).toBeNull();
    expect(row("tx-lovelady-loop").sf).toBeNull();
  });

  it("carries a credit line and a source address on every ride", () => {
    for (const entry of index.rows) {
      const credit = detail(entry.id).credit;
      expect(credit.creditLine.length).toBeGreaterThan(5);
      expect(credit.sourceUrl).toMatch(/^https?:\/\//);
    }
  });

  it("keeps every ride at or under 20,000 points", () => {
    const worst = database.prepare("SELECT MAX(points) AS most FROM ride").get() as { most: number };
    expect(worst.most).toBeLessThanOrEqual(20_000);
  });

  it("writes state line files with a line only for hosted rides, once per state", () => {
    const pa = asset("lines/PA") as { state: string; lines: [string, string][] };
    expect(pa.state).toBe("PA");
    expect(pa.lines).toHaveLength(4);
    const nc = asset("lines/NC") as { lines: [string, string][] };
    const tn = asset("lines/TN") as { lines: [string, string][] };
    expect(nc.lines.map(([id]) => id)).toContain("nc-diamondback-loop");
    expect(tn.lines.map(([id]) => id)).toContain("nc-diamondback-loop");
    expect((asset("lines/NE") ?? null)).toBeNull();
  });
});

const first = build("policy-base");

describe("source policy", () => {
  it("lets a hide entry remove a source", () => {
    const policyPath = path.join(work, "hide.json");
    writeFileSync(
      policyPath,
      JSON.stringify({
        default: { mode: "host", basis: "test" },
        sources: { BestBikingRoads: { mode: "hide", basis: "takedown test" } },
      }),
    );
    const result = build("hide", policyPath);
    const before = open(first.packPath).asset("index") as { sources: string[]; rows: IndexRow[] };
    const bikingRoads = before.rows.filter((entry) => before.sources[entry.s] === "BestBikingRoads").length;
    expect(bikingRoads).toBeGreaterThan(3);
    expect(result.counts.rides).toBe(14 - bikingRoads);
    const index = open(result.packPath).asset("index") as { sources: string[]; rows: IndexRow[] };
    expect(index.sources).not.toContain("BestBikingRoads");
    expect(result.report).toContain(`hidden by policy: ${bikingRoads}`);
  });

  it("drops the line and the file of a hosted source set to link", () => {
    const policyPath = path.join(work, "link.json");
    writeFileSync(
      policyPath,
      JSON.stringify({
        default: { mode: "host", basis: "test" },
        sources: { motocurve: { mode: "link", basis: "test", note: "pending" } },
      }),
    );
    const result = build("link", policyPath);
    const { asset, detail } = open(result.packPath);
    const index = asset("index") as { rows: IndexRow[] };
    const skyway = index.rows.find((row) => row.id === "nc-cherohala-skyway")!;
    expect(skyway.f & (1 | 4)).toBe(0);
    expect(detail("nc-cherohala-skyway").track).toMatchObject({ availability: "link", gpxAllowed: false });
    expect(asset("lines/NC") as { lines: [string, string][] }).toMatchObject({ lines: expect.not.arrayContaining([["nc-cherohala-skyway", expect.anything()]]) });
  });

  it("refuses a policy line with no basis", () => {
    const policyPath = path.join(work, "bad.json");
    writeFileSync(policyPath, JSON.stringify({ default: { mode: "host" }, sources: {} }));
    expect(() => build("bad", policyPath)).toThrow(/basis/);
  });
});

describe("the gates", () => {
  function library(name: string, mutate: (record: Record<string, unknown>) => void): string {
    const dir = path.join(work, name);
    mkdirSync(path.join(dir, "routes/PA"), { recursive: true });
    const record = JSON.parse(readFileSync(path.join(SOURCE, "routes/PA/pa-pa-151-south-heights-hookstown.json"), "utf8")) as Record<string, unknown>;
    mutate(record);
    writeFileSync(path.join(dir, "routes/PA/pa-pa-151-south-heights-hookstown.json"), JSON.stringify(record));
    writeFileSync(path.join(dir, "routes/PA/pa-pa-151-south-heights-hookstown.gpx"), readFileSync(path.join(SOURCE, "routes/PA/pa-pa-151-south-heights-hookstown.gpx")));
    return dir;
  }

  it("skips and lists a record that fails the schema gate", () => {
    const dir = library("badrecord", (record) => {
      record["value_score"] = 9;
    });
    const result = buildPack({ libraryDir: dir, outDir: path.join(work, "badrecord-out"), policyPath: POLICY });
    expect(result.counts.rides).toBe(0);
    expect(result.report).toContain("value_score must be a whole number from 1 to 5");
  });

  it("fails the build when an id collides with a curated catalog id", () => {
    const dir = library("collide", () => undefined);
    const catalog = path.join(work, "catalog.json");
    writeFileSync(catalog, JSON.stringify([{ id: "pa-pa-151-south-heights-hookstown" }]));
    const result = buildPack({ libraryDir: dir, outDir: path.join(work, "collide-out"), policyPath: POLICY, catalogPath: catalog });
    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("collides with a curated catalog id");
  });

  it("writes a credit line from the author and site when the source gave none", () => {
    const dir = library("nocredit", (record) => {
      (record["author_credit"] as Record<string, unknown>) = { author: "unknown" };
    });
    const result = buildPack({ libraryDir: dir, outDir: path.join(work, "nocredit-out"), policyPath: POLICY });
    const detail = open(result.packPath).detail("pa-pa-151-south-heights-hookstown");
    expect(detail.credit.author).toBeNull();
    expect(detail.credit.creditLine).toBe("Route from BestBikingRoads · author unknown");
  });

  it("fails when the ride count drops more than 2 percent without --allow-drop", () => {
    const out = path.join(work, "drop-out");
    buildPack({ libraryDir: SOURCE, outDir: out, policyPath: POLICY });
    const smaller = library("smaller", () => undefined);
    const dropped = buildPack({ libraryDir: smaller, outDir: out, policyPath: POLICY });
    expect(dropped.ok).toBe(false);
    expect(dropped.failures.join(" ")).toContain("ride count fell");
    expect(buildPack({ libraryDir: smaller, outDir: out, policyPath: POLICY, allowDrop: true }).ok).toBe(true);
  });
});
