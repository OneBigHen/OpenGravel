import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface CompositionBudget {
  readonly path: string;
  readonly maxLines: number;
  readonly maxStaticImports: number;
}

const COMPOSITION_BUDGETS: readonly CompositionBudget[] = [
  {
    path: "src/ui/planner/PlannerWorkspace.tsx",
    // Ratcheted down after extracting Refine, status, authoring, camera, dock, frame, and map-intent modules (M9).
    // Lower both ceilings whenever extraction removes more composition debt.
    maxLines: 942,
    maxStaticImports: 25,
  },
];

function sourceFor(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
}

function lineCount(source: string): number {
  return source.split("\n").length;
}

function staticImportCount(source: string): number {
  return source.match(/^import\b/gm)?.length ?? 0;
}

describe("planner composition budget", () => {
  for (const budget of COMPOSITION_BUDGETS) {
    it(`${budget.path} does not grow past the recovery baseline`, () => {
      const source = sourceFor(budget.path);
      const lines = lineCount(source);
      const staticImports = staticImportCount(source);

      expect(
        lines,
        `${budget.path} grew to ${lines} lines; extract responsibility instead of expanding the composition root`,
      ).toBeLessThanOrEqual(budget.maxLines);

      expect(
        staticImports,
        `${budget.path} grew to ${staticImports} static imports; move dependencies behind a controller/view-model seam`,
      ).toBeLessThanOrEqual(budget.maxStaticImports);
    });
  }

  it("keeps provider/infrastructure adapters out of PlannerWorkspace", () => {
    const source = sourceFor("src/ui/planner/PlannerWorkspace.tsx");

    expect(source).not.toMatch(/from\s+["']@\/infrastructure\//);
  });
});
