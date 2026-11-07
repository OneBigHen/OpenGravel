import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeLegacyBenchmark } from "./audit-legacy.mjs";

const data = JSON.parse(readFileSync(new URL("../../docs/vnext/research/ride-formula-benchmark-2026-10-04.json", import.meta.url), "utf8"));

test("legacy benchmark confounding is fully reproducible from committed evidence", () => {
  const summary = summarizeLegacyBenchmark(data);
  assert.equal(summary.scenarioModePairs, 28);
  assert.equal(summary.distinctTripIds, 14);
  assert.equal(summary.equalActualCallPairs, 0);
  assert.equal(summary.treatmentMoreCallPairs, 28);
  assert.equal(summary.totalControlCalls, 184);
  assert.equal(summary.totalTreatmentCalls, 257);
  assert.equal(summary.additionalTreatmentCalls, 73);
});

test("invalid call accounting cannot silently enter audit", () => {
  assert.throws(() => summarizeLegacyBenchmark([{ productionCalls: -1 }]), /missing nonnegative/);
});
