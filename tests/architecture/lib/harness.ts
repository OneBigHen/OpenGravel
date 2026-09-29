import path from "node:path";

import { buildBoundaryRules } from "./rules";
import { checkBoundaryRules, walkSourceFiles, type Violation } from "./scan";

export const ARCHITECTURE_DIR = path.resolve(import.meta.dirname, "..");
export const REPO_ROOT = path.resolve(ARCHITECTURE_DIR, "..", "..");
export const SRC_ROOT = path.join(REPO_ROOT, "src");
export const FIXTURES_ROOT = path.join(ARCHITECTURE_DIR, "fixtures");

/** Fixture roots mirror a `src/`-shaped tree, one directory per rule category. */
export function fixtureRoot(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

/**
 * Runs every boundary rule (or the requested subset) over one source root.
 * Commented-out and template-literal import lookalikes never reach the rules.
 */
export function scanRoot(
  sourceRoot: string,
  ruleIds?: readonly string[],
): Violation[] {
  const rules = buildBoundaryRules(sourceRoot);
  const selected =
    ruleIds === undefined
      ? rules
      : rules.filter((rule) => ruleIds.includes(rule.id));
  return checkBoundaryRules(walkSourceFiles(sourceRoot), selected);
}

/** Violation counts per rule id; exact-count assertions keep the scanner honest. */
export function countByRule(
  violations: readonly Violation[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const violation of violations) {
    counts[violation.ruleId] = (counts[violation.ruleId] ?? 0) + 1;
  }
  return counts;
}

export function violationsForRule(
  violations: readonly Violation[],
  ruleId: string,
): Violation[] {
  return violations.filter((violation) => violation.ruleId === ruleId);
}
