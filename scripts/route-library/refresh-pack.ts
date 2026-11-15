/**
 * The scheduled library refresh, and the same command a person runs for a
 * same-day takedown:
 *
 *   node --import tsx scripts/route-library/refresh-pack.ts \
 *     --library <library dir> --out <built packs dir> [--publish]
 *
 * It rebuilds the pack, stops on a failed quality gate, compares the new
 * version with the newest pack already in `--out`, and does nothing when the
 * library has not changed. With `--publish` a changed pack is handed to
 * `infra/route-library/publish-pack.sh`; without it the command only builds and
 * prints the publish command. `OGV_ROUTE_LIBRARY_PUBLISH=0` is a kill switch
 * that keeps a scheduled run to a build.
 *
 * Exit codes: 0 built / unchanged / published, 1 failed, 75 another run holds
 * the lock (not a failure; see SuccessExitStatus in the systemd unit).
 */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

import { buildPack } from "./pack-builder";

const PACK_NAME = /^route-library-[0-9a-f]{12}\.sqlite$/;
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

export type RefreshStatus = "unchanged" | "built" | "published" | "failed" | "locked";

export interface RefreshOptions {
  readonly libraryDir: string;
  readonly outDir: string;
  readonly policyPath?: string | undefined;
  readonly catalogPath?: string | undefined;
  readonly packName?: string | undefined;
  readonly allowDrop?: boolean | undefined;
  /** Hand a changed pack to the publisher. Without it the pack is only built. */
  readonly publish?: boolean | undefined;
  /** Test seam: the publisher. Defaults to `infra/route-library/publish-pack.sh`. */
  readonly publisher?: ((packPath: string, version: string) => Promise<void>) | undefined;
  /** Built packs to keep in `--out` (the newest is always kept). */
  readonly keepPacks?: number | undefined;
  readonly lockPath?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

export interface RefreshResult {
  readonly status: RefreshStatus;
  readonly exitCode: number;
  readonly version: string | null;
  readonly previousVersion: string | null;
  readonly packPath: string | null;
  readonly reportPath: string | null;
  readonly failures: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

interface PackSummary {
  readonly path: string;
  readonly version: string | null;
  readonly rides: number | null;
  readonly removed: number;
  readonly ids: readonly string[];
}

/** The newest pack in a folder, matching a fixed fixture name when one is given. */
export function newestPack(dir: string, packName?: string): string | null {
  try {
    const newest = readdirSync(dir)
      .filter((name) => PACK_NAME.test(name) || name === packName)
      .map((name) => ({ name, time: statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)[0];
    return newest === undefined ? null : path.join(dir, newest.name);
  } catch {
    return null;
  }
}

/** What is in a pack, read without holding it open. */
export function packSummary(packPath: string): PackSummary | null {
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(packPath, { readOnly: true });
    const meta = database.prepare("SELECT value FROM meta WHERE key = ?");
    const value = (key: string): string | null => (meta.get(key) as { value: string } | undefined)?.value ?? null;
    const rides = value("rides");
    let removed = 0;
    try {
      removed = Number((database.prepare("SELECT COUNT(*) AS n FROM tombstone").get() as { n: number } | undefined)?.n ?? 0);
    } catch {
      removed = 0;
    }
    let ids: readonly string[] = [];
    const asset = database.prepare("SELECT body FROM asset WHERE key = 'index'").get() as { body: Uint8Array } | undefined;
    if (asset !== undefined) {
      const index = JSON.parse(gunzipSync(asset.body).toString("utf8")) as { rows?: unknown };
      if (Array.isArray(index.rows)) {
        ids = index.rows
          .map((row) => (typeof row === "object" && row !== null ? (row as { id?: unknown }).id : null))
          .filter((id): id is string => typeof id === "string");
      }
    }
    return { path: packPath, version: value("version"), rides: rides === null ? null : Number(rides), removed, ids };
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

/** Ids that no longer have their own card but answer through `alias`. */
function packAliasIds(packPath: string): readonly string[] {
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(packPath, { readOnly: true });
    return (database.prepare("SELECT id FROM alias").all() as { id: string }[]).map((row) => row.id);
  } catch {
    return [];
  } finally {
    database?.close();
  }
}

/**
 * One run at a time. A lock older than two hours is treated as a run that died
 * rather than a reason to stop refreshing forever. Returns null when locked.
 */
export function acquireRefreshLock(lockPath: string, now: Date): (() => void) | null {
  const take = (): boolean => {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, `${process.pid} ${now.toISOString()}\n`);
      closeSync(fd);
      return true;
    } catch {
      return false;
    }
  };
  if (!take()) {
    try {
      if (now.getTime() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) rmSync(lockPath, { force: true });
    } catch {
      // Another run removed it first; the retry below decides.
    }
    if (!take()) return null;
  }
  return () => {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // The folder is gone; there is nothing left to unlock.
    }
  };
}

/** Keeps the newest `keep` packs, and anything named in `protect`. */
export function prunePacks(dir: string, keep: number, protect: readonly string[] = []): readonly string[] {
  const protectedNames = new Set(protect.map((file) => path.basename(file)));
  let packs: { name: string; time: number }[];
  try {
    packs = readdirSync(dir)
      .filter((name) => PACK_NAME.test(name) && !protectedNames.has(name))
      .map((name) => ({ name, time: statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
  const deleted: string[] = [];
  for (const pack of packs.slice(Math.max(1, keep))) {
    try {
      rmSync(path.join(dir, pack.name), { force: true });
      deleted.push(pack.name);
    } catch {
      // Disk hygiene must never fail a refresh that already built a good pack.
    }
  }
  return deleted;
}

function publishDisabled(): boolean {
  const value = (process.env["OGV_ROUTE_LIBRARY_PUBLISH"] ?? "").trim().toLowerCase();
  return value === "0" || value === "false" || value === "no";
}

function defaultPublisher(): (packPath: string, version: string) => Promise<void> {
  const script = path.resolve(import.meta.dirname, "../../infra/route-library/publish-pack.sh");
  return (packPath) =>
    new Promise((resolve, reject) => {
      const child = spawn("bash", [script, packPath], { stdio: "inherit", env: process.env });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`publish-pack.sh exited ${code ?? "without a status"}`))));
    });
}

function difference(left: readonly string[], right: readonly string[]): readonly string[] {
  const inRight = new Set(right);
  return left.filter((id) => !inRight.has(id)).sort((a, b) => a.localeCompare(b));
}

export async function runRefresh(options: RefreshOptions): Promise<RefreshResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());
  const outDir = path.resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });
  const lockPath = options.lockPath ?? path.join(outDir, ".refresh.lock");
  const release = acquireRefreshLock(lockPath, now());
  const result = (status: RefreshStatus, rest: Partial<RefreshResult> = {}): RefreshResult => ({
    status,
    exitCode: status === "failed" ? 1 : status === "locked" ? 75 : 0,
    version: null,
    previousVersion: null,
    packPath: null,
    reportPath: null,
    failures: [],
    added: [],
    removed: [],
    ...rest,
  });
  if (release === null) {
    log(`Another refresh holds ${lockPath}; leaving this run to it.`);
    return result("locked");
  }

  try {
    const previousPath = newestPack(outDir, options.packName);
    const previous = previousPath === null ? null : packSummary(previousPath);
    log(`Library: ${path.resolve(options.libraryDir)}`);
    log(`Built packs: ${outDir}`);
    log(previous === null ? "Previous pack: none (first build in this folder)" : `Previous pack: ${previous.path} (version ${previous.version ?? "unknown"}, ${previous.rides ?? "?"} rides)`);

    let built: ReturnType<typeof buildPack>;
    try {
      built = buildPack({
        libraryDir: path.resolve(options.libraryDir),
        outDir,
        policyPath: options.policyPath ?? path.join(import.meta.dirname, "sources-policy.json"),
        catalogPath: options.catalogPath ?? path.resolve(import.meta.dirname, "../../data/catalog", "routes.json.gz"),
        ...(options.packName === undefined ? {} : { packName: options.packName }),
        ...(options.allowDrop === undefined ? {} : { allowDrop: options.allowDrop }),
        log,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Build failed: ${message}`);
      return result("failed", { failures: [message] });
    }
    log(`Build ${built.ok ? "passed" : "FAILED"}: version ${built.version}, ${built.counts.rides} rides. Report: ${built.reportPath}`);
    if (!built.ok) {
      for (const failure of built.failures) log(`GATE: ${failure}`);
      return result("failed", {
        version: built.version,
        previousVersion: previous?.version ?? null,
        packPath: built.packPath,
        reportPath: built.reportPath,
        failures: built.failures,
      });
    }

    const current = packSummary(built.packPath);
    const currentIds = current?.ids ?? [];
    const previousIds = previous?.ids ?? [];
    const added = difference(currentIds, previousIds);
    // A card merged into another (L2a) still answers through `alias`; only a card with no answer left is "removed".
    const stillAnswers = new Set(current === null ? [] : packAliasIds(built.packPath));
    const removed = difference(previousIds, currentIds).filter((id) => !stillAnswers.has(id));
    for (const id of removed) log(`Removed since the previous pack: ${id}`);
    log(`Changes: ${added.length} new, ${removed.length} removed, ${built.counts.rides} cards.`);
    const deleted = prunePacks(outDir, options.keepPacks ?? 3, [built.packPath, ...(previousPath === null ? [] : [previousPath])]);
    for (const name of deleted) log(`Pruned older pack ${name}`);

    if (previous !== null && previous.version === built.version) {
      log(`No change: version ${built.version} is already the newest build. Nothing to publish.`);
      return result("unchanged", {
        version: built.version,
        previousVersion: previous.version,
        packPath: built.packPath,
        reportPath: built.reportPath,
      });
    }

    if (options.publish !== true) {
      log("Publishing was not requested. To publish this pack:");
      log(`  infra/route-library/publish-pack.sh ${built.packPath}`);
      return result("built", {
        version: built.version,
        previousVersion: previous?.version ?? null,
        packPath: built.packPath,
        reportPath: built.reportPath,
        added,
        removed,
      });
    }
    if (publishDisabled()) {
      log("Publishing is switched off by OGV_ROUTE_LIBRARY_PUBLISH; only the build was kept.");
      return result("built", {
        version: built.version,
        previousVersion: previous?.version ?? null,
        packPath: built.packPath,
        reportPath: built.reportPath,
        added,
        removed,
      });
    }

    log(`Publishing ${built.packPath} ...`);
    try {
      await (options.publisher ?? defaultPublisher())(built.packPath, built.version);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Publish failed: ${message}`);
      return result("failed", {
        version: built.version,
        previousVersion: previous?.version ?? null,
        packPath: built.packPath,
        reportPath: built.reportPath,
        failures: [message],
        added,
        removed,
      });
    }
    log(`Published version ${built.version}. Old links to removed rides now answer "this ride was removed".`);
    return result("published", {
      version: built.version,
      previousVersion: previous?.version ?? null,
      packPath: built.packPath,
      reportPath: built.reportPath,
      added,
      removed,
    });
  } finally {
    release();
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const libraryDir = argument("library");
  const outDir = argument("out");
  if (libraryDir === undefined || outDir === undefined) {
    console.error("Usage: refresh-pack.ts --library <dir> --out <dir> [--publish] [--policy <file>] [--catalog <file>] [--name <file.sqlite>] [--allow-drop] [--keep <n>] [--log <file>]");
    process.exitCode = 2;
    return;
  }
  const logFile = argument("log");
  if (logFile !== undefined) mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });
  const log = (line: string): void => {
    console.log(line);
    if (logFile !== undefined) writeFileSync(logFile, `${new Date().toISOString()} ${line}\n`, { flag: "a" });
  };
  const keep = argument("keep");
  const result = await runRefresh({
    libraryDir,
    outDir,
    ...(argument("policy") === undefined ? {} : { policyPath: path.resolve(argument("policy") as string) }),
    ...(argument("catalog") === undefined ? {} : { catalogPath: path.resolve(argument("catalog") as string) }),
    ...(argument("name") === undefined ? {} : { packName: argument("name") }),
    ...(keep === undefined ? {} : { keepPacks: Number(keep) }),
    publish: process.argv.includes("--publish"),
    allowDrop: process.argv.includes("--allow-drop"),
    log,
  });
  log(`Refresh: ${result.status}.`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  void main();
}
