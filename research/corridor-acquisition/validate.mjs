/**
 * Publication-audit contract for paired, capped black-box routing experiments.
 * No third-party dependencies; no production imports, network, or GPS output.
 * This is an integrity checker, NOT statistical evidence of improvement.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STAGES = new Set(["synthetic", "pilot", "confirmatory"]);
const SPLITS = new Set(["pilot", "train", "validation", "test"]);
const PROBE_STATUSES = new Set([
  "eligible", "ineligible", "duplicate", "no-route", "timeout", "error", "skipped",
]);
const ACCESS = new Set(["verified-open", "unknown", "known-prohibited"]);
const CHOICES = new Set(["control", "treatment", "tie", "not-rated"]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identifier(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 180;
}
function finite(value, minimum = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}
function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}
function unitOrNull(value) {
  return value === null || (finite(value) && value <= 1);
}
function numberOrNull(value, minimum = 0) {
  return value === null || finite(value, minimum);
}
function mean(numbers) {
  return numbers.length === 0 ? null : numbers.reduce((sum, x) => sum + x, 0) / numbers.length;
}
function issue(errors, path, message) {
  errors.push(path + ": " + message);
}

/** Throws on malformed JSON; blank lines are ignored. */
export function parseNdjson(content) {
  const records = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error("NDJSON line " + (index + 1) + ": " + error.message);
    }
  }
  return records;
}

export function validateManifest(manifest) {
  const errors = [];
  if (!isObject(manifest)) return ["manifest: expected object"];
  if (manifest.schemaVersion !== 1) issue(errors, "manifest.schemaVersion", "expected 1");
  if (!identifier(manifest.studyId)) issue(errors, "manifest.studyId", "required identifier");
  if (!identifier(manifest.protocolVersion)) issue(errors, "manifest.protocolVersion", "required identifier");
  if (!STAGES.has(manifest.stage)) issue(errors, "manifest.stage", "invalid study stage");
  if (!COMMIT.test(manifest.codeCommit ?? "")) issue(errors, "manifest.codeCommit", "expected exact 40-character commit SHA");
  for (const key of ["graphFingerprint", "roadEvidenceFingerprint", "corridorSourceFingerprint", "routerConfigFingerprint"]) {
    if (!SHA256.test(manifest[key] ?? "")) issue(errors, "manifest." + key, "expected sha256:<64 lowercase hex>");
    if (manifest.stage !== "synthetic" && /^sha256:0{64}$/.test(manifest[key] ?? "")) {
      issue(errors, "manifest." + key, "placeholder digest forbidden outside synthetic stage");
    }
  }
  if (manifest.stage !== "synthetic" && /^0{40}$/.test(manifest.codeCommit ?? "")) {
    issue(errors, "manifest.codeCommit", "placeholder commit forbidden outside synthetic stage");
  }
  if (!integer(manifest.callBudget, 1) || manifest.callBudget > 32) issue(errors, "manifest.callBudget", "expected integer 1..32");
  if (!isObject(manifest.policies) ||
      !identifier(manifest.policies.control) ||
      !identifier(manifest.policies.treatment) ||
      manifest.policies.control === manifest.policies.treatment) {
    issue(errors, "manifest.policies", "distinct control and treatment policy identifiers required");
  }
  if (manifest.stage === "confirmatory" && !identifier(manifest.preregistrationUri)) {
    issue(errors, "manifest.preregistrationUri", "confirmatory stage must specify a preregistration URI or archived record identifier");
  }
  return errors;
}

function validateSelected(value, path, errors) {
  if (value === null) return;
  if (!isObject(value)) {
    issue(errors, path, "expected selected candidate or null");
    return;
  }
  if (!identifier(value.candidateId)) issue(errors, path + ".candidateId", "required identifier");
  if (!identifier(value.routeFingerprint)) issue(errors, path + ".routeFingerprint", "hash/fingerprint required; do not log raw GPS");
  if (value.eligible !== true) issue(errors, path + ".eligible", "selected candidate must pass canonical eligibility");
  if (!ACCESS.has(value.accessStatus)) issue(errors, path + ".accessStatus", "unknown / verified-open / known-prohibited required");
  if (value.accessStatus === "known-prohibited") issue(errors, path + ".accessStatus", "a known-prohibited candidate cannot be selected");
  if (!finite(value.durationSeconds, 1)) issue(errors, path + ".durationSeconds", "positive duration required");
  if (!unitOrNull(value.bendShare)) issue(errors, path + ".bendShare", "expected [0,1] or null");
  if (!numberOrNull(value.unpavedMeters)) issue(errors, path + ".unpavedMeters", "expected nonnegative metres or null");
  if (!unitOrNull(value.roadEvidenceCoverage)) issue(errors, path + ".roadEvidenceCoverage", "expected [0,1] or null");
}

function validateArm(arm, label, policy, budget, errors) {
  if (!isObject(arm)) {
    issue(errors, label, "expected arm object");
    return;
  }
  if (arm.policy !== policy) issue(errors, label + ".policy", "does not match frozen manifest policy");
  if (!integer(arm.attemptsUsed) || arm.attemptsUsed > budget) {
    issue(errors, label + ".attemptsUsed", "must be integer between 0 and common budget");
  }
  if (!finite(arm.elapsedMs)) issue(errors, label + ".elapsedMs", "nonnegative wall-clock time required");
  if (!Array.isArray(arm.probes)) {
    issue(errors, label + ".probes", "all attempts, including failures, must be listed");
  } else {
    const ids = new Set();
    let total = 0;
    for (const [index, probe] of arm.probes.entries()) {
      const path = label + ".probes[" + index + "]";
      if (!isObject(probe)) {
        issue(errors, path, "expected object");
        continue;
      }
      if (!identifier(probe.probeId) || ids.has(probe.probeId)) {
        issue(errors, path + ".probeId", "required unique probe id within arm");
      }
      ids.add(probe.probeId);
      if (!PROBE_STATUSES.has(probe.status)) issue(errors, path + ".status", "invalid probe outcome");
      if (!integer(probe.attempts)) issue(errors, path + ".attempts", "nonnegative attempts required");
      else {
        total += probe.attempts;
        if (probe.status === "skipped" && probe.attempts !== 0) {
          issue(errors, path + ".attempts", "skipped probe must consume zero attempts");
        }
        if (probe.status !== "skipped" && probe.attempts < 1) {
          issue(errors, path + ".attempts", "executed probe must consume at least one attempt");
        }
      }
    }
    if (total !== arm.attemptsUsed) {
      issue(errors, label + ".attemptsUsed", "must equal the sum of all probe attempts; include retries");
    }
  }
  validateSelected(arm.selected, label + ".selected", errors);
}

export function validateRun(manifest, trials) {
  const errors = validateManifest(manifest);
  if (!Array.isArray(trials) || trials.length === 0) {
    issue(errors, "trials", "expected at least one paired scenario");
    return { errors, summary: null };
  }
  const seenScenarios = new Set();
  const clusterSplit = new Map();
  const sourceSplit = new Map();
  const validTrials = [];
  for (const [index, trial] of trials.entries()) {
    const path = "trials[" + index + "]";
    const before = errors.length;
    if (!isObject(trial)) {
      issue(errors, path, "expected object");
      continue;
    }
    for (const field of ["scenarioId", "clusterId", "sourceFamilyId", "region"]) {
      if (!identifier(trial[field])) issue(errors, path + "." + field, "required identifier");
    }
    if (!SPLITS.has(trial.split)) issue(errors, path + ".split", "invalid split");
    if (manifest.stage === "confirmatory" && trial.split !== "test") {
      issue(errors, path + ".split", "confirmatory records must come from frozen test split");
    }
    if (!integer(trial.seed)) issue(errors, path + ".seed", "nonnegative integer required");
    if (!CHOICES.has(trial.riderChoice)) issue(errors, path + ".riderChoice", "explicit outcome or not-rated required");
    if (seenScenarios.has(trial.scenarioId)) issue(errors, path + ".scenarioId", "duplicate scenario in same run");
    seenScenarios.add(trial.scenarioId);
    for (const [key, store] of [["clusterId", clusterSplit], ["sourceFamilyId", sourceSplit]]) {
      const group = trial[key];
      if (!identifier(group) || !SPLITS.has(trial.split)) continue;
      if (store.has(group) && store.get(group) !== trial.split) {
        issue(errors, path + "." + key, "group appears across dataset splits (possible leakage)");
      } else store.set(group, trial.split);
    }
    if (!isObject(trial.arms)) {
      issue(errors, path + ".arms", "required paired control and treatment");
    } else {
      validateArm(trial.arms.control, path + ".arms.control", manifest.policies?.control, manifest.callBudget, errors);
      validateArm(trial.arms.treatment, path + ".arms.treatment", manifest.policies?.treatment, manifest.callBudget, errors);
    }
    if (errors.length === before) validTrials.push(trial);
  }
  if (errors.length > 0) return { errors, summary: null };
  const diffTime = [];
  const diffBends = [];
  const diffUnpaved = [];
  const choices = { control: 0, treatment: 0, tie: 0, "not-rated": 0 };
  const unknown = { control: 0, treatment: 0 };
  const selectedCount = { control: 0, treatment: 0 };
  const attempts = { control: [], treatment: [] };
  const latencies = { control: [], treatment: [] };
  for (const t of validTrials) {
    choices[t.riderChoice] += 1;
    for (const side of ["control", "treatment"]) {
      const arm = t.arms[side];
      attempts[side].push(arm.attemptsUsed);
      latencies[side].push(arm.elapsedMs);
      if (arm.selected !== null) {
        selectedCount[side] += 1;
        if (arm.selected.accessStatus === "unknown") unknown[side] += 1;
      }
    }
    const c = t.arms.control.selected;
    const v = t.arms.treatment.selected;
    if (c !== null && v !== null) {
      diffTime.push(v.durationSeconds - c.durationSeconds);
      if (c.bendShare !== null && v.bendShare !== null) diffBends.push(v.bendShare - c.bendShare);
      if (c.unpavedMeters !== null && v.unpavedMeters !== null) diffUnpaved.push(v.unpavedMeters - c.unpavedMeters);
    }
  }
  return {
    errors: [],
    summary: {
      studyId: manifest.studyId,
      stage: manifest.stage,
      callBudget: manifest.callBudget,
      scenarioCount: validTrials.length,
      selectedCount,
      unknownAccessSelectedCount: unknown,
      meanAttemptsUsed: { control: mean(attempts.control), treatment: mean(attempts.treatment) },
      meanWallClockMs: { control: mean(latencies.control), treatment: mean(latencies.treatment) },
      riderChoiceCounts: choices,
      pairedProxyDeltas: {
        count: diffTime.length,
        meanDurationSeconds: mean(diffTime),
        meanBendShare: mean(diffBends),
        meanUnpavedMeters: mean(diffUnpaved),
      },
      interpretation: "DESCRIPTIVE ONLY. Not independent rider utility, a significance test, an access audit, or a causal impact estimate.",
    },
  };
}

const entry = process.argv[1];
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) {
    console.error("Usage: node validate.mjs <manifest.json> <trials.ndjson>");
    process.exitCode = 2;
  } else {
    try {
      const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
      const trials = parseNdjson(readFileSync(process.argv[3], "utf8"));
      const result = validateRun(manifest, trials);
      console.log(JSON.stringify(result, null, 2));
      if (result.errors.length > 0) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
