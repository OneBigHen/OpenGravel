import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { buildPack } from "../../../scripts/route-library/pack-builder";
import { FLAG, type IndexRow, type RideDetail } from "@/application/route-library/types";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SOURCE = path.join(ROOT, "tests/fixtures/route-library/dedupe-source");
const POLICY = path.join(ROOT, "scripts/route-library/sources-policy.json");
const work = mkdtempSync(path.join(tmpdir(), "route-library-dedupe-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("one road listed by three sites becomes one card", () => {
  const built = buildPack({ libraryDir: SOURCE, outDir: path.join(work, "a"), policyPath: POLICY, packName: "pack.sqlite" });
  const database = new DatabaseSync(built.packPath, { readOnly: true });
  const detail = (id: string): RideDetail =>
    JSON.parse(gunzipSync((database.prepare("SELECT detail FROM ride WHERE id = ?").get(id) as { detail: Uint8Array }).detail).toString("utf8")) as RideDetail;
  const index = JSON.parse(gunzipSync((database.prepare("SELECT body FROM asset WHERE key = 'index'").get() as { body: Uint8Array }).body).toString("utf8")) as {
    sources: string[];
    rows: IndexRow[];
  };

  it("passes the gates with three records, one card, two aliases", () => {
    expect(built.failures).toEqual([]);
    expect(built.dedupe).toMatchObject({ before: 3, groups: 1, aliases: 2 });
    expect(built.counts.rides).toBe(1);
    expect(index.rows).toHaveLength(1);
  });

  it("keeps the hosted track as the card and credits the other two sites", () => {
    const card = detail("pa-pa-231-prosperity-avella");
    expect(card.track.availability).toBe("hosted");
    expect(card.credit.sourceName).toBe("BestBikingRoads");
    expect(card.alsoOn.map((credit) => credit.sourceName).sort()).toEqual(["MotorcycleRoads.com", "OzarkRides.com"]);
    const mcr = card.alsoOn.find((credit) => credit.sourceName === "MotorcycleRoads.com")!;
    expect(mcr.sourceUrl).toBe("https://www.motorcycleroads.com/motorcycle-roads/pennsylvania/pa-231-prosperity-avella");
    expect(mcr.creditLine).toBe("Route by usagiyo11 via MotorcycleRoads.com (Sep 30, 2012)");
    expect(card.alsoOn.find((credit) => credit.sourceName === "OzarkRides.com")!.author).toBeNull();
  });

  it("flags the row as merged and lists the other sites", () => {
    const row = index.rows[0]!;
    expect(row.id).toBe("pa-pa-231-prosperity-avella");
    expect(row.f & FLAG.merged).toBe(FLAG.merged);
    expect(row.o!.map((source) => index.sources[source]).sort()).toEqual(["MotorcycleRoads.com", "OzarkRides.com"]);
  });

  it("answers the old ids through alias and no longer has them as cards", () => {
    const alias = database.prepare("SELECT id, primary_id FROM alias ORDER BY id").all() as { id: string; primary_id: string }[];
    expect(alias).toEqual([
      { id: "pa-231-prosperity-avella-mcr", primary_id: "pa-pa-231-prosperity-avella" },
      { id: "pa-231-prosperity-avella-ozark", primary_id: "pa-pa-231-prosperity-avella" },
    ]);
    expect(database.prepare("SELECT count(*) AS n FROM ride").get()).toEqual({ n: 1 });
  });

  it("matches the committed browser-test pack", () => {
    const committed = new DatabaseSync(path.join(ROOT, "tests/fixtures/route-library/dedupe-pack.sqlite"), { readOnly: true });
    const version = (committed.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string }).value;
    expect(version).toBe(built.version);
  });
});
