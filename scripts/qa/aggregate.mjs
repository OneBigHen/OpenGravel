#!/usr/bin/env node
/**
 * OpenGravel acceptance aggregation — scripts/qa/aggregate.mjs
 *
 * Dependency-free. Two modes:
 *
 *   1. Validation (no test inputs needed):
 *        node scripts/qa/aggregate.mjs --validate
 *     Parses every acceptance/manifests/*.yaml against the manifest schema,
 *     and checks that each referenced feature file, Playwright spec, and
 *     Maestro flow exists on disk (or is explicitly "planned").
 *     Exits 0 when everything checks out, 1 with a list of problems.
 *
 *   2. Aggregation (after the lanes have run):
 *        node scripts/qa/aggregate.mjs \
 *          --playwright qa-out/playwright-results.json \
 *          --maestro qa-out/maestro-report.xml \
 *          --appium qa-out/appium-results.json \
 *          --hercules qa-out/hercules-report.xml \
 *          --sha "$(git rev-parse HEAD)" \
 *          --out qa-out/
 *
 *   Input contracts:
 *   - Playwright: JSON reporter output.
 *       npx playwright test --reporter=json > playwright-results.json
 *     (Chromium gate, then again with OGV_E2E_WEBKIT=1 for the WebKit lane;
 *     pass each run's JSON with a repeated --playwright flag; the two projects
 *     are distinguished by the reporter's per-project config name:
 *     "critical-chromium" / "critical-webkit".)
 *   - Maestro: JUnit XML from the CLI:
 *       maestro test .maestro/ --format junit --output maestro-report.xml
 *     Flow headers carry `properties: { missionId: "M11" }`, but mapping falls
 *     back to the mission id prefix in the flow filename (M11-*.yaml), so a
 *     missing property never breaks the rollup.
 *   - Appium (optional): JSON of the shape
 *       { "results": [ { "mission": "M13", "executor": "iphone",
 *                        "status": "pass", "evidence": ["path/to/log"] } ] }
 *     Only for the special cases Maestro cannot exercise.
 *   - Hercules (optional): JUnit XML produced by the exploratory lane.
 *     Exploratory findings never flip a deterministic mission's status; they
 *     are recorded under mission.exploratory for triage.
 *
 *   Output: per-mission <MISSION>.result.json plus QA_CAMPAIGN.json in --out.
 *   Statuses: pass | fail | not_run | planned | blocked.
 *   A lane with no input file is "not_run", never green. A mission whose
 *   manifest says flow/spec "planned" is "planned", never green.
 *
 * Run from the repo root.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const REPO = resolve(process.argv[1], "..", "..", "..");
const MANIFEST_DIR = join(REPO, "acceptance", "manifests");

// ---------------------------------------------------------------------------
// Minimal YAML subset parser: nested string->scalar maps only, 2-space indent.
// The manifests use no arrays, no anchors, no multiline scalars by construction.
function parseYaml(text, source) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    const colon = line.indexOf(":");
    if (colon === -1) throw new Error(`${source}:${i + 1}: expected "key: value"`);
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (value === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else if (value === "null" || value === "~") {
        value = null;
      } else if (value === "true") {
        value = true;
      } else if (value === "false") {
        value = false;
      }
      parent[key] = value;
    }
  }
  return root;
}

// ---------------------------------------------------------------------------
// Manifest schema validation
const EXECUTOR_KINDS = { chromium: "playwright", webkit: "playwright", iphone: "maestro", ipad: "maestro" };
const EVIDENCE_KEYS = ["screenshot", "video", "trace", "console", "network_errors"];
const EVIDENCE_VALUES = ["always", "on_failure", "never"];

function validateManifest(m, source, problems) {
  const req = (cond, msg) => { if (!cond) problems.push(`${source}: ${msg}`); };
  req(typeof m.id === "string" && /^M\d{2}$/.test(m.id), "id must look like M01..M99");
  req(typeof m.feature === "string" && m.feature.startsWith(`${m.id}-`) && m.feature.endsWith(".feature"), "feature filename must be <id>-<slug>.feature");
  req(["P0", "P1", "P2"].includes(m.priority), "priority must be P0/P1/P2");
  req(m.executors && typeof m.executors === "object", "executors missing");
  for (const lane of Object.keys(EXECUTOR_KINDS)) {
    const ex = m.executors?.[lane];
    req(ex && typeof ex === "object", `executors.${lane} missing`);
    req(ex?.kind === EXECUTOR_KINDS[lane], `executors.${lane}.kind must be ${EXECUTOR_KINDS[lane]}`);
    const target = lane === "chromium" || lane === "webkit" ? ex?.spec : ex?.flow;
    req(target === "planned" || target === null || typeof target === "string", `executors.${lane} target must be a path, null, or "planned"`);
    if (typeof target === "string" && target !== "planned") {
      req(existsSync(join(REPO, target)), `executors.${lane} references missing file: ${target}`);
    }
  }
  req(m.preflight && typeof m.preflight === "object", "preflight missing");
  for (const k of ["require_matching_sha", "require_real_device_session", "prohibit_desktop_fallback"]) {
    req(m.preflight?.[k] === true, `preflight.${k} must be true`);
  }
  req(m.evidence && typeof m.evidence === "object", "evidence missing");
  for (const k of EVIDENCE_KEYS) {
    req(EVIDENCE_VALUES.includes(m.evidence?.[k]), `evidence.${k} must be one of ${EVIDENCE_VALUES.join("|")}`);
  }
  req(m.exploratory && typeof m.exploratory === "object", "exploratory missing");
  req(typeof m.exploratory?.enabled === "boolean", "exploratory.enabled must be boolean");
  req(m.exploratory?.model_tier === "cheap", "exploratory.model_tier must be cheap");
  const featurePath = join(REPO, "acceptance", "features", m.feature);
  req(existsSync(featurePath), `feature file missing: acceptance/features/${m.feature}`);
}

function loadManifests() {
  const problems = [];
  const manifests = [];
  for (const file of readdirSync(MANIFEST_DIR).filter((f) => f.endsWith(".yaml")).sort()) {
    const source = `acceptance/manifests/${file}`;
    try {
      const m = parseYaml(readFileSync(join(MANIFEST_DIR, file), "utf8"), source);
      validateManifest(m, source, problems);
      manifests.push(m);
    } catch (err) {
      problems.push(`${source}: parse error: ${err.message}`);
    }
  }
  return { manifests, problems };
}

// ---------------------------------------------------------------------------
// Result readers
function collectPlaywrightSpecs(suites, out) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      const ok = spec.ok === true;
      const evidence = [];
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          for (const a of r.attachments ?? []) {
            if (a.path) evidence.push(a.path);
          }
        }
      }
      out.push({ file: spec.file, ok, evidence });
    }
    collectPlaywrightSpecs(suite.suites, out);
  }
  return out;
}

function readPlaywrightReports(paths) {
  // lane per report -> project name inside the JSON ("critical-chromium"/"critical-webkit")
  const byProject = { "critical-chromium": [], "critical-webkit": [] };
  for (const p of paths) {
    if (!existsSync(p)) throw new Error(`playwright report not found: ${p}`);
    const json = JSON.parse(readFileSync(p, "utf8"));
    for (const spec of collectPlaywrightSpecs(json.suites, [])) {
      const project = json?.config?.projects?.[0]?.name; // reporter JSON carries config
      const lane = project === "critical-webkit" ? "critical-webkit" : "critical-chromium";
      byProject[lane].push(spec);
    }
  }
  return byProject;
}

// Very small JUnit reader: enough for Maestro --format junit and Hercules JUnit.
function readJUnit(path) {
  if (!existsSync(path)) throw new Error(`junit report not found: ${path}`);
  const xml = readFileSync(path, "utf8");
  const cases = [];
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2] ?? "";
    const name = /name="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const classname = /classname="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const failed = /<(failure|error)\b/.test(body);
    const skipped = /<skipped\b/.test(body);
    cases.push({ name, classname, failed, skipped });
  }
  return cases;
}

function missionIdFromMaestroCase(c) {
  // Real Maestro JUnit carries flow header properties as
  // <property name="missionId" value="M11"/> on the <testcase>.
  const hay = c.classname + " " + c.name;
  const prop = /missionId.{0,20}?(M\d{2})/.exec(hay);
  if (prop) return prop[1];
  // Fallback: mission id prefix in the flow filename (M11-*.yaml).
  const file = /(M\d{2})[-_]/.exec(hay);
  return file ? file[1] : null;
}

// ---------------------------------------------------------------------------
// CLI
function usage() {
  console.log(`usage:
  node scripts/qa/aggregate.mjs --validate
  node scripts/qa/aggregate.mjs [--playwright <json> ...] [--maestro <xml>]
      [--maestro-ipad <xml>] [--appium <json>] [--hercules <xml>]
      [--sha <git-sha>] [--out <dir>]`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { usage(); return; }

  const { manifests, problems } = loadManifests();

  if (args.includes("--validate")) {
    // Every feature file must also be claimed by exactly one manifest.
    const features = new Set(readdirSync(join(REPO, "acceptance", "features")).filter((f) => f.endsWith(".feature")));
    const claimed = new Set(manifests.map((m) => m.feature));
    for (const f of features) if (!claimed.has(f)) problems.push(`acceptance/features/${f}: no manifest claims this feature`);
    for (const m of manifests) {
      const expected = manifests.filter((x) => x.id === m.id);
      if (expected.length > 1) problems.push(`acceptance/manifests/${m.id}.yaml: duplicate mission id`);
    }
    if (problems.length > 0) {
      console.error(`acceptance validation FAILED (${problems.length} problems):`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`acceptance validation OK: ${manifests.length} missions, ${features.size} features, all references resolve.`);
    return;
  }

  const getAll = (flag) => {
    const out = [];
    for (let i = 0; i < args.length; i += 1) if (args[i] === flag && args[i + 1]) out.push(args[i + 1]);
    return out;
  };
  const getOne = (flag, dflt) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
  };
  const outDir = resolve(getOne("--out", "qa-out"));
  const sha = getOne("--sha", process.env.GITHUB_SHA ?? "unknown");
  mkdirSync(outDir, { recursive: true });

  // Seed every lane per manifest: real result, or honest "planned"/"not_run".
  const campaign = {
    generated_at: new Date().toISOString(),
    sha,
    missions: [],
  };
  const perMission = {};
  for (const m of manifests) {
    const lanes = {};
    for (const [lane, ex] of Object.entries(m.executors)) {
      const target = lane === "chromium" || lane === "webkit" ? ex.spec : ex.flow;
      lanes[lane] = target === "planned" || target === null
        ? { status: "planned", evidence: [] }
        : { status: "not_run", evidence: [] };
    }
    perMission[m.id] = { id: m.id, feature: m.feature, priority: m.priority, executors: lanes, exploratory: { status: "not_run", findings: [] } };
  }

  // Playwright lane
  const pwPaths = getAll("--playwright");
  if (pwPaths.length > 0) {
    const byProject = readPlaywrightReports(pwPaths);
    const laneOf = { "critical-chromium": "chromium", "critical-webkit": "webkit" };
    for (const [project, specs] of Object.entries(byProject)) {
      const lane = laneOf[project];
      for (const m of manifests) {
        const want = m.executors[lane]?.spec;
        if (typeof want !== "string" || want === "planned") continue;
        const hits = specs.filter((s) => typeof s.file === "string" && (s.file === want || s.file.endsWith("/" + want) || s.file.endsWith(want)));
        if (hits.length === 0) continue;
        const ok = hits.every((h) => h.ok);
        perMission[m.id].executors[lane] = {
          status: ok ? "pass" : "fail",
          evidence: [...new Set(hits.flatMap((h) => h.evidence))],
        };
      }
    }
  }

  // Maestro lane (JUnit). iPad lane only when a separate iPad report is given.
  const maestroPath = getOne("--maestro", null);
  if (maestroPath) {
    const seen = new Set();
    for (const c of readJUnit(maestroPath)) {
      const id = missionIdFromMaestroCase(c);
      if (!id || !perMission[id] || seen.has(id)) continue;
      seen.add(id);
      const flow = perMission[id];
      const st = c.failed ? "fail" : c.skipped ? "not_run" : "pass";
      if (flow.executors.iphone.status !== "planned") {
        flow.executors.iphone = { status: st, evidence: [`maestro:${c.name}`] };
      }
    }
  }
  const ipadPath = getOne("--maestro-ipad", null);
  if (ipadPath) {
    for (const c of readJUnit(ipadPath)) {
      const id = missionIdFromMaestroCase(c);
      if (!id || !perMission[id]) continue;
      const st = c.failed ? "fail" : c.skipped ? "not_run" : "pass";
      if (perMission[id].executors.ipad.status !== "planned") {
        perMission[id].executors.ipad = { status: st, evidence: [`maestro-ipad:${c.name}`] };
      }
    }
  }

  // Appium special-case lane (optional).
  const appiumPath = getOne("--appium", null);
  if (appiumPath) {
    if (!existsSync(appiumPath)) throw new Error(`appium results not found: ${appiumPath}`);
    const json = JSON.parse(readFileSync(appiumPath, "utf8"));
    for (const r of json.results ?? []) {
      const flow = perMission[r.mission];
      if (!flow || !["pass", "fail", "blocked"].includes(r.status)) continue;
      const lane = r.executor === "ipad" ? "ipad" : "iphone";
      flow.executors[lane] = { status: r.status, evidence: r.evidence ?? [] };
    }
  }

  // Hercules exploratory lane: findings recorded, deterministic status untouched.
  const herculesPath = getOne("--hercules", null);
  if (herculesPath) {
    for (const c of readJUnit(herculesPath)) {
      const id = /(M\d{2})/.exec(c.name + " " + c.classname)?.[1];
      if (!id || !perMission[id]) continue;
      perMission[id].exploratory = {
        status: c.failed ? "finding" : "pass",
        findings: [...perMission[id].exploratory.findings, c.name],
      };
    }
  }

  for (const m of manifests) {
    campaign.missions.push(perMission[m.id]);
    writeFileSync(join(outDir, `${m.id}.result.json`), JSON.stringify(perMission[m.id], null, 2) + "\n");
  }
  writeFileSync(join(outDir, "QA_CAMPAIGN.json"), JSON.stringify(campaign, null, 2) + "\n");

  const counts = { pass: 0, fail: 0, not_run: 0, planned: 0 };
  for (const pm of campaign.missions) {
    for (const lane of Object.values(pm.executors)) counts[lane.status] = (counts[lane.status] ?? 0) + 1;
  }
  console.log(`QA_CAMPAIGN.json written to ${outDir} (${campaign.missions.length} missions):`, JSON.stringify(counts));
}

main();
