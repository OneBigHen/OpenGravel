import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const script = resolve("scripts/qa/audit-env-example.mjs");
function audit(source: string, example: string, rootConfig = ""): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), "og-env-audit-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "config.ts"), source);
    writeFileSync(join(root, ".env.example"), example);
    if (rootConfig) writeFileSync(join(root, "next.config.ts"), rootConfig);
    try { return { status: 0, output: execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string };
      return { status: failure.status, output: `${failure.stdout}${failure.stderr}` };
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("deployment environment audit", () => {
  it("fails for undocumented source keys", () => {
    expect(audit('process.env.OGV_UNDOCUMENTED', '').status).toBe(1);
  });
  it("fails for stale documented keys", () => {
    expect(audit('', 'OGV_REMOVED=\n').status).toBe(1);
  });
  it("includes root configuration and env aliases/destructuring", () => {
    const result = audit('const runtime = process.env; runtime["OGV_ALIAS"]; const { OGV_DESTRUCTURED } = process.env;', '', 'process.env.OGV_ROOT');
    expect(result.status).toBe(1);
    expect(result.output).toContain('OGV_ALIAS');
    expect(result.output).toContain('OGV_DESTRUCTURED');
    expect(result.output).toContain('OGV_ROOT');
  });
  it("does not treat unrelated settings.env objects as deployment reads", () => {
    expect(audit('settings.env.OGV_FAKE;', '').status).toBe(0);
  });
  it("accepts documented fixtures and ignores env-shaped text in comments", () => {
    expect(audit('// process.env.OGV_NOT_READ\nprocess.env.OGV_FIXTURE; process.env.NODE_ENV;', '# OGV_FIXTURE=1\n').status).toBe(0);
  });
});
