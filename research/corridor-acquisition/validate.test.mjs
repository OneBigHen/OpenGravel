import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseNdjson, validateRun } from "./validate.mjs";

const fixture = new URL("./fixtures/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("synthetic-manifest.json", fixture), "utf8"));
const trials = parseNdjson(readFileSync(new URL("synthetic-trials.ndjson", fixture), "utf8"));

function clone(value) { return structuredClone(value); }
function hasIssue(result, expected) { return result.errors.some((issue) => issue.includes(expected)); }

test("synthetic pilot fixture validates and retains unequal actual call count", () => {
  const result = validateRun(manifest, trials);
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.scenarioCount, 2);
  assert.ok(result.summary.meanAttemptsUsed.control > result.summary.meanAttemptsUsed.treatment);
  assert.equal(result.summary.riderChoiceCounts["not-rated"], 2);
});

test("all provider attempts including retries must be accounted for", () => {
  const changed = clone(trials);
  changed[0].arms.treatment.attemptsUsed += 1;
  assert.ok(hasIssue(validateRun(manifest, changed), "sum of all probe attempts"));
});

test("cannot select known-prohibited roads", () => {
  const changed = clone(trials);
  changed[0].arms.treatment.selected.accessStatus = "known-prohibited";
  assert.ok(hasIssue(validateRun(manifest, changed), "known-prohibited candidate cannot be selected"));
});

test("test and train cannot share a geographic cluster", () => {
  const changed = clone(trials);
  changed[1].split = "test";
  changed[1].clusterId = changed[0].clusterId;
  assert.ok(hasIssue(validateRun(manifest, changed), "possible leakage"));
});

test("test and train cannot share a GPX source family", () => {
  const changed = clone(trials);
  changed[1].split = "test";
  changed[1].sourceFamilyId = changed[0].sourceFamilyId;
  assert.ok(hasIssue(validateRun(manifest, changed), "possible leakage"));
});

test("duplicate scenario IDs are rejected", () => {
  const changed = clone(trials);
  changed[1].scenarioId = changed[0].scenarioId;
  assert.ok(hasIssue(validateRun(manifest, changed), "duplicate scenario"));
});

test("a skipped probe cannot consume calls and a failed probe must be retained", () => {
  const changed = clone(trials);
  changed[0].arms.control.probes[0].status = "skipped";
  assert.ok(hasIssue(validateRun(manifest, changed), "skipped probe must consume zero"));
});

test("real study cannot use placeholder hashes", () => {
  const changed = clone(manifest);
  changed.stage = "pilot";
  assert.ok(hasIssue(validateRun(changed, trials), "placeholder digest forbidden"));
});

test("confirmatory study requires registration and frozen test records", () => {
  const changed = clone(manifest);
  changed.stage = "confirmatory";
  assert.ok(hasIssue(validateRun(changed, trials), "preregistrationUri"));
  assert.ok(hasIssue(validateRun(changed, trials), "frozen test split"));
});

test("missing confidence or proxy facts must be explicit null, not omitted", () => {
  const changed = clone(trials);
  delete changed[0].arms.control.selected.bendShare;
  assert.ok(hasIssue(validateRun(manifest, changed), "bendShare"));
});

test("malformed NDJSON names its line", () => {
  assert.throws(() => parseNdjson('{"ok":true}\n{bad'), /NDJSON line 2/);
});
