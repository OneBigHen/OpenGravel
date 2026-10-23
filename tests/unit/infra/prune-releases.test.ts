import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve("infra/deploy/prune.sh");

interface Host {
  readonly root: string;
  readonly releases: string;
  readonly release: (name: string, ageMinutes: number) => string;
  readonly prune: (env?: Record<string, string>, args?: readonly string[]) => string;
}

const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function host(live: string | null, previous: string | null): Host {
  const root = mkdtempSync(join(tmpdir(), "og-prune-"));
  roots.push(root);
  const releases = join(root, "wt");
  mkdirSync(releases);
  const dropin = join(root, "opengravel.conf");
  writeFileSync(dropin, live === null ? "" : `[Service]\nWorkingDirectory=${join(releases, live)}\n`);
  const state = join(root, "state");
  mkdirSync(state);
  if (previous !== null) writeFileSync(join(state, "previous-release"), `${join(releases, previous)}\n`);
  return {
    root,
    releases,
    release(name, ageMinutes) {
      const dir = join(releases, name);
      mkdirSync(dir);
      const at = new Date(Date.now() - ageMinutes * 60_000);
      utimesSync(dir, at, at);
      return dir;
    },
    prune(env = {}, args = []) {
      return execFileSync("bash", [SCRIPT, ...args], {
        encoding: "utf8",
        env: { ...process.env, SOURCE_REPO: join(root, "no-repo"), RELEASE_ROOT: releases, DROPIN: dropin, STATE_DIR: state, ...env },
      });
    },
  };
}

describe("infra/deploy/prune.sh", () => {
  it("keeps live, rollback and the newest extra release; removes the rest", () => {
    const h = host("og-release-live", "og-release-prev");
    const live = h.release("og-release-live", 1);
    const prev = h.release("og-release-prev", 50);
    const recent = h.release("og-release-recent", 10);
    const old1 = h.release("og-release-old1", 100);
    const old2 = h.release("og-release-old2", 200);

    h.prune();

    expect([live, prev, recent].every(existsSync)).toBe(true);
    expect([old1, old2].some(existsSync)).toBe(false);
  });

  it("keeps every directory named on the command line and honours KEEP_EXTRA_RELEASES=0", () => {
    const h = host("og-release-live", null);
    const live = h.release("og-release-live", 1);
    const building = h.release("og-release-building", 300);
    const other = h.release("og-release-other", 5);

    h.prune({ KEEP_EXTRA_RELEASES: "0" }, [building]);

    expect(existsSync(live)).toBe(true);
    expect(existsSync(building)).toBe(true);
    expect(existsSync(other)).toBe(false);
  });

  it("never removes a release a running process works in (a QA candidate)", async () => {
    const h = host("og-release-live", null);
    h.release("og-release-live", 1);
    const candidate = h.release("og-release-candidate", 400);
    const child = spawn("sleep", ["30"], { cwd: candidate, stdio: "ignore" });
    children.push(child);
    await new Promise((settle) => child.once("spawn", settle));

    const output = h.prune({ KEEP_EXTRA_RELEASES: "0" });

    expect(existsSync(candidate)).toBe(true);
    expect(output).toContain("(in use)");
  });

  it("only reports what it would remove on a dry run", () => {
    const h = host("og-release-live", null);
    h.release("og-release-live", 1);
    const old = h.release("og-release-old", 100);

    const output = h.prune({ KEEP_EXTRA_RELEASES: "0", DRY_RUN: "1" });

    expect(existsSync(old)).toBe(true);
    expect(output).toContain(`would remove ${old}`);
  });

  it("does nothing when there are no releases", () => {
    const h = host(null, null);
    expect(() => h.prune()).not.toThrow();
  });
});
