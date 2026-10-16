/**
 * Recompute call-cost confounding in the legacy 2026-10-04 Ride Formula JSON.
 * Historical diagnostics only. No inferential conclusions or reruns.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function summarizeLegacyBenchmark(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError("expected nonempty legacy benchmark array");
  }
  for (const [i, row] of rows.entries()) {
    for (const key of ["productionCalls", "formulaCalls", "productionMs", "formulaMs"]) {
      if (!Number.isFinite(row?.[key]) || row[key] < 0) {
        throw new TypeError("row " + i + " missing nonnegative " + key);
      }
    }
  }
  const total = key => rows.reduce((sum, row) => sum + row[key], 0);
  const count = test => rows.filter(test).length;
  const controlCalls = total("productionCalls");
  const treatmentCalls = total("formulaCalls");
  const controlMs = total("productionMs");
  const treatmentMs = total("formulaMs");
  return {
    source: "docs/vnext/research/ride-formula-benchmark-2026-10-04.json",
    scenarioModePairs: rows.length,
    distinctTripIds: new Set(rows.map(row => row.trip?.id)).size,
    equalActualCallPairs: count(row => row.productionCalls === row.formulaCalls),
    treatmentMoreCallPairs: count(row => row.formulaCalls > row.productionCalls),
    treatmentFewerCallPairs: count(row => row.formulaCalls < row.productionCalls),
    totalControlCalls: controlCalls,
    totalTreatmentCalls: treatmentCalls,
    additionalTreatmentCalls: treatmentCalls - controlCalls,
    meanAdditionalCalls: (treatmentCalls - controlCalls) / rows.length,
    totalControlMs: controlMs,
    totalTreatmentMs: treatmentMs,
    meanAdditionalElapsedMs: (treatmentMs - controlMs) / rows.length,
    totalElapsedRatio: controlMs > 0 ? treatmentMs / controlMs : null,
    conclusion: "All treatment comparisons must be treated as unequal-cost, exploratory historical diagnostics; no controlled claim about efficiency or rider enjoyment.",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filename = process.argv[2] ?? new URL("../../docs/vnext/research/ride-formula-benchmark-2026-10-04.json", import.meta.url);
  const rows = JSON.parse(readFileSync(filename, "utf8"));
  console.log(JSON.stringify(summarizeLegacyBenchmark(rows), null, 2));
}
