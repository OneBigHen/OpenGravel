import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const root = path.resolve(__dirname, "../../src");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    return statSync(f).isDirectory() ? files(f) : /\.tsx?$/.test(f) ? [f] : [];
  });
}
describe("Jev frontier has no routing authority or browser transport", () => {
  const sources = files(root).map((f) => ({
    file: path.relative(root, f),
    text: readFileSync(f, "utf8"),
  }));
  it("allows the SDK only inside the three infrastructure adapters", () => {
    expect(
      sources
        .filter((s) => s.text.includes('from "@typesafe-ai/sdk"'))
        .map((s) => s.file)
        .sort(),
    ).toEqual([
      "infrastructure/routing/jev-frontier-judge.ts",
      "infrastructure/routing/jev-fun-character.ts",
      "infrastructure/routing/jev-fun-judge.ts",
    ]);
  });
  it("FUN JUDGE: the Jev adapter is reached only from the server plan service", () => {
    expect(
      sources
        .filter((s) => /from\s+["'][^"']*jev-fun-judge["']/.test(s.text))
        .map((s) => s.file),
    ).toEqual(["server/planning/plan-service.ts"]);
  });
  it("FUN JUDGE: the application port and policy stay provider-neutral", () => {
    const neutral = sources.filter((s) =>
      [
        "application/planner/ports/fun-judge.ts",
        "application/planner/fun-judge.ts",
        "application/planner/fun-judge-selection.ts",
      ].includes(s.file),
    );
    expect(neutral).toHaveLength(3);
    for (const s of neutral) {
      expect(s.text).not.toMatch(/from\s+["']@\/infrastructure|typesafe|JEV_API_KEY|process\.env/i);
    }
  });
  it("FUN JUDGE: domain, UI and Free Ride never import it", () => {
    expect(
      sources
        .filter(
          (s) =>
            (s.file.startsWith("domain/") ||
              s.file.startsWith("ui/") ||
              s.file.startsWith("application/free-ride/") ||
              /^\s*["']use client["']/m.test(s.text)) &&
            /fun-judge/.test(s.text),
        )
        .map((s) => s.file),
    ).toEqual([]);
  });
  it("frontier adapter is explicitly server-only and has no production importer", () => {
    const adapter = sources.find(
      (s) => s.file === "infrastructure/routing/jev-frontier-judge.ts",
    )!;
    expect(adapter.text).toContain('import "server-only"');
    expect(
      sources
        .filter(
          (s) =>
            s.file !== adapter.file &&
            /from\s+["'][^"']*jev-frontier-judge["']/.test(s.text),
        )
        .map((s) => s.file),
    ).toEqual([]);
  });
  it("keeps frontier experiment out of production planning, domain, UI and Free Ride", () => {
    const authority = sources.filter(
      (s) =>
        s.file.startsWith("domain/") ||
        s.file.startsWith("ui/") ||
        s.file.startsWith("application/free-ride/") ||
        s.file === "application/planner/pipeline.ts" ||
        s.file === "server/planning/plan-service.ts",
    );
    expect(
      authority
        .filter((s) =>
          /jev-frontier-(?:judge|replay|evaluation|shadow|corpus)/.test(s.text),
        )
        .map((s) => s.file),
    ).toEqual([]);
    expect(
      sources
        .filter(
          (s) =>
            s.text.includes("NEXT_PUBLIC_OPENROUTER_API_KEY") ||
            s.text.includes("NEXT_PUBLIC_JEV_API_KEY"),
        )
        .map((s) => s.file),
    ).toEqual([]);
  });
});
