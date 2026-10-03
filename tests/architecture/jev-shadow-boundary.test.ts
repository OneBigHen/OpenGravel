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
  it("allows the SDK only inside the two infrastructure adapters", () => {
    expect(
      sources
        .filter((s) => s.text.includes('from "@typesafe-ai/sdk"'))
        .map((s) => s.file)
        .sort(),
    ).toEqual([
      "infrastructure/routing/jev-frontier-judge.ts",
      "infrastructure/routing/jev-fun-character.ts",
    ]);
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
