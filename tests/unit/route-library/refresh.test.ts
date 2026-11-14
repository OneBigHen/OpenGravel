import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { packSummary, prunePacks, runRefresh } from "../../../scripts/route-library/refresh-pack";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SOURCE = path.join(ROOT, "tests/fixtures/route-library/source");
const POLICY = path.join(ROOT, "scripts/route-library/sources-policy.json");
const work = mkdtempSync(path.join(tmpdir(), "route-library-refresh-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

afterEach(() => {
  delete process.env["OGV_ROUTE_LIBRARY_PUBLISH"];
});

function library(name: string): string {
  const dir = path.join(work, name);
  cpSync(SOURCE, dir, { recursive: true });
  return dir;
}

function out(name: string): string {
  const dir = path.join(work, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function refresh(libraryDir: string, outDir: string, extra: Partial<Parameters<typeof runRefresh>[0]> = {}) {
  return runRefresh({ libraryDir, outDir, policyPath: POLICY, log: () => undefined, ...extra });
}

function takedown(libraryDir: string, id: string): void {
  writeFileSync(
    path.join(libraryDir, "tombstones.json"),
    JSON.stringify([{ id, removedAt: "2026-11-14T08:00:00Z", reason: "The listing was wrong." }]),
  );
}

describe("the scheduled refresh", () => {
  it("builds once, then does nothing when the library has not changed", async () => {
    const dir = library("steady");
    const output = out("steady-out");
    const publisher = vi.fn(async () => undefined);

    const first = await refresh(dir, output, { publish: true, publisher });
    expect(first.status).toBe("published");
    expect(first.exitCode).toBe(0);
    expect(first.version).toMatch(/^[0-9a-f]{12}$/);
    expect(first.added).toHaveLength(14);
    expect(first.removed).toEqual([]);
    expect(publisher).toHaveBeenCalledTimes(1);

    const second = await refresh(dir, output, { publish: true, publisher });
    expect(second.status).toBe("unchanged");
    expect(second.version).toBe(first.version);
    expect(second.previousVersion).toBe(first.version);
    expect(publisher).toHaveBeenCalledTimes(1);
    expect(packSummary(first.packPath!)).toMatchObject({ version: first.version, rides: 14, removed: 1 });
  });

  it("builds and publishes a new version after a same-day takedown", async () => {
    const dir = library("takedown");
    const output = out("takedown-out");
    const first = await refresh(dir, output);
    expect(first.status).toBe("built");

    takedown(dir, "nc-cherohala-skyway");
    const published: { packPath: string; version: string }[] = [];
    const second = await refresh(dir, output, {
      publish: true,
      publisher: async (packPath, version) => {
        published.push({ packPath, version });
      },
    });

    expect(second.status).toBe("published");
    expect(second.version).not.toBe(first.version);
    expect(second.removed).toEqual(["nc-cherohala-skyway"]);
    expect(second.added).toEqual([]);
    expect(published).toEqual([{ packPath: second.packPath, version: second.version }]);
    expect(packSummary(second.packPath!)).toMatchObject({ rides: 13 });
  });

  it("only builds when publishing was not requested, and prints the publish command", async () => {
    const lines: string[] = [];
    const dir = library("build-only");
    const output = out("build-only-out");
    const publisher = vi.fn(async () => undefined);
    const result = await refresh(dir, output, { publisher, log: (line) => lines.push(line) });

    expect(result.status).toBe("built");
    expect(publisher).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Publishing was not requested");
    expect(lines.join("\n")).toContain("publish-pack.sh");
  });

  it("keeps a scheduled run to a build when the kill switch is set", async () => {
    const dir = library("killed");
    const output = out("killed-out");
    const publisher = vi.fn(async () => undefined);
    process.env["OGV_ROUTE_LIBRARY_PUBLISH"] = "0";
    const result = await refresh(dir, output, { publish: true, publisher });

    expect(result.status).toBe("built");
    expect(publisher).not.toHaveBeenCalled();
  });

  it("reports a failed publish and does not claim the refresh is done", async () => {
    const dir = library("publish-fail");
    const output = out("publish-fail-out");
    const result = await refresh(dir, output, {
      publish: true,
      publisher: async () => {
        throw new Error("checksum mismatch");
      },
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.failures.join(" ")).toContain("checksum mismatch");
  });

  it("does not publish a pack that failed a quality gate", async () => {
    const dir = library("gate-fail");
    const output = out("gate-fail-out");
    const catalog = path.join(work, "colliding-catalog.json");
    writeFileSync(catalog, JSON.stringify([{ id: "nc-cherohala-skyway" }]));
    const publisher = vi.fn(async () => undefined);

    const result = await refresh(dir, output, { publish: true, publisher, catalogPath: catalog });

    expect(result.status).toBe("failed");
    expect(result.failures.join(" ")).toContain("collides with a curated catalog id");
    expect(publisher).not.toHaveBeenCalled();
  });

  it("leaves a run to the one already holding the lock", async () => {
    const dir = library("locked");
    const output = out("locked-out");
    writeFileSync(path.join(output, ".refresh.lock"), `${process.pid} ${new Date().toISOString()}\n`);
    const result = await refresh(dir, output);

    expect(result.status).toBe("locked");
    expect(result.exitCode).toBe(75);
    expect(result.version).toBeNull();
  });

  it("takes over a lock older than two hours, so a dead run does not freeze the library", async () => {
    const dir = library("stale");
    const output = out("stale-out");
    const lock = path.join(output, ".refresh.lock");
    writeFileSync(lock, "999999 2026-11-14T00:00:00Z\n");
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(lock, old, old);

    const result = await refresh(dir, output);
    expect(result.status).toBe("built");
    expect(statSync(lock, { throwIfNoEntry: false })).toBeUndefined();
  });
});

describe("pruning built packs", () => {
  it("keeps the newest packs and anything protected", () => {
    const dir = out("prune");
    const names = ["route-library-000000000001.sqlite", "route-library-000000000002.sqlite", "route-library-000000000003.sqlite", "route-library-000000000004.sqlite"];
    for (const [index, name] of names.entries()) {
      const file = path.join(dir, name);
      writeFileSync(file, "pack");
      const time = new Date(2026, 0, index + 1);
      utimesSync(file, time, time);
    }
    const deleted = prunePacks(dir, 2, [path.join(dir, names[0]!)]);
    expect(deleted).toEqual([names[1]]);
    expect(statSync(path.join(dir, names[0]!)).isFile()).toBe(true);
    expect(statSync(path.join(dir, names[2]!)).isFile()).toBe(true);
    expect(statSync(path.join(dir, names[3]!)).isFile()).toBe(true);
    expect(statSync(path.join(dir, names[1]!), { throwIfNoEntry: false })).toBeUndefined();
  });
});
