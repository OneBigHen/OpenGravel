import type { EvidenceValue } from "./types";

/** True for a finite number inside the closed unit interval. */
export function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Issue text for one bounded metric, or `null` when the value is valid. */
export function unitIntervalIssue(field: string, value: number): string | null {
  return isUnitInterval(value)
    ? null
    : `${field} ${value} must be a finite number in [0, 1]`;
}

/**
 * Confidence/coverage issues for one evidence value (03-DOMAIN-MODEL §18,
 * 07-ROAD-INTELLIGENCE §2). An empty list means both bounded metrics are either
 * absent or a finite number in `[0, 1]`; status and provenance are not checked
 * here, so this stays usable at any ingestion boundary without a cycle back
 * into the constructors.
 */
export function validateEvidenceValue<T>(
  evidence: Pick<EvidenceValue<T>, "confidence" | "coverage">,
): string[] {
  const issues: string[] = [];
  if (evidence.confidence !== null) {
    const issue = unitIntervalIssue("confidence", evidence.confidence);
    if (issue !== null) issues.push(issue);
  }
  if (evidence.coverage !== undefined) {
    const issue = unitIntervalIssue("coverage", evidence.coverage);
    if (issue !== null) issues.push(issue);
  }
  return issues;
}
