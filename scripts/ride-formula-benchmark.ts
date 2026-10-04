/**
 * Beat-Google benchmark for the OpenGravel Ride Formula (live GraphHopper).
 *
 * For every trip and rider mode it plans three ways, strictly one after the
 * other against the same router:
 *   1. fastest  - the plain fastest profile (the Google-like baseline);
 *   2. production - today's deployed Best Ride (rider modes + knee search,
 *      Gravel Atlas probes and the Ride Formula both off);
 *   3. formula - Gravel Atlas probes on and OGV_RIDE_FORMULA=on.
 * Every returned route is measured with the same yardsticks (distance-weighted
 * dirt, Franco curvature, busy-road share, minutes) and scored by the same
 * ride-formula-v1, so the columns compare like with like.
 *
 *   npx tsx scripts/ride-formula-benchmark.ts [--only id,id] [--out path]
 *
 * Needs GraphHopper on GRAPHHOPPER_URL (default http://127.0.0.1:8989) and, for
 * the formula treatment, the Gravel Atlas at OGV_GRAVEL_ATLAS_PATH.
 */

import { writeFile } from "node:fs/promises";

import { analyzeFrancoCurvature } from "../src/domain/geometry/franco-curvature";
import { scoreCandidateWithRideFormula } from "../src/application/planner/ride-formula";
import type { ProviderCandidate, ProviderCandidateSet, ProviderRouteRequest, RouteCandidateProvider } from "../src/application/planner/route-provider";
import type { Coordinate } from "../src/domain/ride/types";
import { createGraphHopperProvider } from "../src/infrastructure/routing/graphhopper/provider";
import { planRide } from "../src/server/planning/plan-service";
import { createFunJudge } from "../src/application/planner/fun-judge";
import { jevFunJudgeFromEnv } from "../src/infrastructure/routing/jev-fun-judge";
import { ROUTING_QUALITY_CORPUS } from "../tests/real-router/routing-quality-corpus";

type Mode = "gravel" | "dual-sport" | "curvy";

interface Trip {
  readonly id: string;
  readonly label: string;
  readonly origin: Coordinate;
  readonly destination: Coordinate;
  readonly loopMinutes?: number;
  readonly avoidHighways?: boolean;
  readonly modes: readonly Mode[];
  readonly dirtFocus: boolean;
}

const DIRT_TRIPS: readonly Trip[] = [
  { id: "pine-grove-loop-2h", label: "Pine Grove Furnace loop, 2 h", origin: { lon: -77.305, lat: 40.0325 }, destination: { lon: -77.305, lat: 40.0325 }, loopMinutes: 120, modes: ["gravel", "dual-sport"], dirtFocus: true },
  { id: "state-college-rothrock-loop-2h", label: "State College to Rothrock loop, 2 h", origin: { lon: -77.86, lat: 40.7934 }, destination: { lon: -77.86, lat: 40.7934 }, loopMinutes: 120, modes: ["gravel", "dual-sport"], dirtFocus: true },
  { id: "jim-thorpe-hickory-run", label: "Jim Thorpe to Hickory Run", origin: { lon: -75.7387, lat: 40.8636 }, destination: { lon: -75.6745, lat: 41.0035 }, modes: ["gravel", "dual-sport"], dirtFocus: true },
  { id: "lock-haven-slate-run", label: "Lock Haven to Slate Run", origin: { lon: -77.4469, lat: 41.137 }, destination: { lon: -77.4744, lat: 41.4687 }, modes: ["gravel", "dual-sport"], dirtFocus: true },
  { id: "gettysburg-pine-grove", label: "Gettysburg to Pine Grove Furnace", origin: { lon: -77.2311, lat: 39.8309 }, destination: { lon: -77.305, lat: 40.0325 }, modes: ["gravel", "dual-sport"], dirtFocus: true },
  { id: "williamsport-waterville", label: "Williamsport to Waterville (Pine Creek)", origin: { lon: -77.0011, lat: 41.2412 }, destination: { lon: -77.3719, lat: 41.3189 }, modes: ["gravel", "dual-sport"], dirtFocus: true },
];

const CORPUS_TRIPS: readonly Trip[] = ROUTING_QUALITY_CORPUS.map((entry) => ({
  id: entry.id,
  label: entry.label,
  origin: entry.origin,
  destination: entry.destination,
  ...(entry.options?.avoidHighways === undefined ? {} : { avoidHighways: entry.options.avoidHighways }),
  modes: ["curvy", "gravel"] as const,
  dirtFocus: false,
}));

const DIRT_SURFACES = new Set(["gravel", "fine_gravel", "compacted", "dirt", "ground", "unpaved", "earth"]);
const BUSY_CLASSES = new Set(["motorway", "trunk", "primary"]);

function requestFor(trip: Trip, mode: Mode, tag: string): ProviderRouteRequest {
  const dirt = mode !== "curvy";
  return {
    // One seed per trip and mode: loop shapes are seeded by the request id, so
    // a per-treatment id compared two different loops, not two rankings.
    requestId: `bench:${trip.id}:${mode}:${tag === "fastest" ? tag : "plan"}`,
    origin: trip.origin,
    destination: trip.destination,
    stops: [],
    shaping: [],
    avoidPolygons: [],
    profile: dirt ? "motorcycle_adventure" : "motorcycle_twisty",
    options: {
      includeAlternatives: true,
      avoidHighways: trip.avoidHighways ?? false,
      tollPolicy: "allow-with-warning",
      vehicle: "motorcycle",
      roadCharacter: dirt ? "balanced" : "curvy",
      surfacePreference: dirt ? "dirt-preferred" : "mixed",
      ...(dirt ? { targetUnpavedShare: 0.5 } : {}),
      traffic: "protect-ride",
      bike: {
        category: mode === "dual-sport" ? "dual-sport" : mode === "gravel" ? "adventure" : "street",
        maintainedGravel: "allow",
        roughTracks: mode === "dual-sport" ? "allow" : "avoid",
      },
    },
    ...(trip.loopMinutes === undefined ? {} : { discovery: { targetMinutes: trip.loopMinutes, toleranceMinutes: 15 } }),
  };
}

function sameLine(a: readonly Coordinate[], b: readonly Coordinate[]): boolean {
  return a.length === b.length && a.every((point, at) => point.lat === b[at]!.lat && point.lon === b[at]!.lon);
}

interface Recorder {
  readonly provider: RouteCandidateProvider;
  readonly seen: ProviderCandidate[];
  calls: number;
}

function recorder(inner: RouteCandidateProvider): Recorder {
  const state: Recorder = {
    seen: [],
    calls: 0,
    provider: {
      id: inner.id,
      capabilities: () => inner.capabilities(),
      async candidates(request, signal): Promise<ProviderCandidateSet> {
        state.calls += 1;
        const answer = await inner.candidates(request, signal);
        state.seen.push(...answer.candidates);
        return answer;
      },
    },
  };
  return state;
}

interface Measured {
  readonly minutes: number;
  readonly km: number;
  readonly dirtShare: number | null;
  readonly longestDirtKm: number | null;
  readonly francoBendShare: number | null;
  readonly francoPerKm: number | null;
  readonly busyShare: number | null;
  readonly formulaValue: number;
  readonly formulaConfidence: number;
  readonly sameAsProduction?: boolean;
}

function measure(candidate: ProviderCandidate, request: ProviderRouteRequest, fastestSeconds: number): Measured {
  const runs = candidate.roadSummary?.roadRuns ?? [];
  const total = runs.reduce((sum, run) => sum + (run.meters > 0 ? run.meters : 0), 0);
  let dirt = 0;
  let busy = 0;
  let longest = 0;
  let current = 0;
  for (const run of runs) {
    if (!(run.meters > 0)) continue;
    const isDirt = DIRT_SURFACES.has(run.surface.toLowerCase());
    if (isDirt) {
      dirt += run.meters;
      current += run.meters;
      longest = Math.max(longest, current);
    } else current = 0;
    const roadClass = run.roadClass.toLowerCase();
    if (BUSY_CLASSES.has(roadClass) || run.roadClassLink === true || run.urbanDensity.toLowerCase() === "city") busy += run.meters;
  }
  const franco = analyzeFrancoCurvature(candidate.geometry);
  const formula = scoreCandidateWithRideFormula(candidate, request.options, { fastestSeconds });
  return {
    minutes: candidate.durationSeconds / 60,
    km: candidate.distanceMeters / 1000,
    dirtShare: total > 0 ? dirt / total : null,
    longestDirtKm: total > 0 ? longest / 1000 : null,
    francoBendShare: franco.bendShare,
    francoPerKm: franco.curvaturePerKm,
    busyShare: total > 0 ? busy / total : null,
    formulaValue: formula.value,
    formulaConfidence: formula.confidence,
  };
}

interface Row {
  readonly trip: Trip;
  readonly mode: Mode;
  readonly fastest: Measured | null;
  readonly production: Measured | null;
  readonly formula: Measured | null;
  readonly productionCalls: number;
  readonly formulaCalls: number;
  readonly productionMs: number;
  readonly formulaMs: number;
  readonly note: string;
}

const BASE_URL = process.env["GRAPHHOPPER_URL"] ?? "http://127.0.0.1:8989";

async function planOnce(trip: Trip, mode: Mode, treatment: "production" | "formula", fastestSeconds: number): Promise<{ measured: Measured | null; calls: number; ms: number; geometry: readonly Coordinate[] | null; note: string }> {
  const formulaOn = treatment === "formula";
  const inner = createGraphHopperProvider({ baseUrl: BASE_URL, riderModesEnabled: true, rideFormulaEnabled: formulaOn && process.env["BENCH_REQUEST_RULES"] !== "off" });
  const record = recorder(inner);
  const request = requestFor(trip, mode, treatment);
  const env: Record<string, string> = {
    OGV_RIDER_MODES: "on",
    OGV_TRAFFIC_LIVE_AVOID: "off",
    OGV_ROAD_AUTHORITY: "off",
    OGV_FUN_GENERATORS: "off",
    OGV_JEV_FUN_JUDGE: "off",
    OGV_ATLAS_GENERATORS: formulaOn && process.env["BENCH_ATLAS"] !== "off" ? "on" : "off",
    OGV_RIDE_FORMULA: formulaOn ? "on" : "off",
    OGV_FUN_GENERATORS_CALLS: "3",
    OGV_FUN_GENERATORS_DEADLINE_MS: "20000",
    OGV_ATLAS_CALLS: process.env["OGV_ATLAS_CALLS"] ?? "3",
  };
  const started = performance.now();
  const result = await planRide(
    { identity: { rideId: `bench_${trip.id}`, rideRevision: 1, planningGeneration: 1 }, request },
    { provider: record.provider, env, funCharacterClassifier: null, funJudge: null, roadAuthority: null },
  );
  const ms = performance.now() - started;
  if (!result.ok) return { measured: null, calls: record.calls, ms, geometry: null, note: `plan failed: ${result.error.code}` };
  const best = result.bundle.candidates.find((candidate) => candidate.id === (result.bundle.roles["best-ride"] ?? result.bundle.selectedRouteId));
  if (best === undefined) return { measured: null, calls: record.calls, ms, geometry: null, note: "no best ride" };
  const source = record.seen.find((candidate) => sameLine(candidate.geometry, best.geometry) && Math.abs(candidate.durationSeconds - best.durationSeconds) < 1);
  if (source === undefined) return { measured: null, calls: record.calls, ms, geometry: best.geometry, note: "best ride not matched to a provider answer" };
  const atlas = result.diagnostics.atlas;
  const pool = result.bundle.candidates.map((candidate) => Math.round(candidate.durationSeconds / 60)).join("/");
  const note = `pool ${pool}; ` + (atlas === undefined ? "" : `atlas ${atlas.considered} corridors, ${atlas.calls} calls, probes: ${atlas.probes.map((probe) => `${probe.status}:${probe.note}${probe.minutes === null ? "" : ` ${probe.minutes.toFixed(0)}min`}${probe.unpavedShare === null ? "" : ` dirt${(probe.unpavedShare * 100).toFixed(0)}%`}`).join(" / ") || "none"}`);
  return { measured: measure(source, request, fastestSeconds), calls: record.calls, ms, geometry: best.geometry, note };
}

async function fastestFor(trip: Trip, mode: Mode): Promise<Measured | null> {
  if (trip.loopMinutes !== undefined) return null;
  const provider = createGraphHopperProvider({ baseUrl: BASE_URL, riderModesEnabled: false, rideFormulaEnabled: false });
  const base = requestFor(trip, mode, "fastest");
  const request: ProviderRouteRequest = {
    ...base,
    profile: "motorcycle_fastest",
    options: { vehicle: "motorcycle", includeAlternatives: false, avoidHighways: base.options.avoidHighways, tollPolicy: "allow-with-warning", roadCharacter: "efficient", surfacePreference: "mixed" },
  };
  const answer = await provider.candidates(request, AbortSignal.timeout(60_000));
  const first = answer.candidates[0];
  return first === undefined ? null : measure(first, base, first.durationSeconds);
}

function pct(value: number | null): string {
  return value === null ? "n/a" : (value * 100).toFixed(0);
}

function num(value: number | null, digits = 0): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function verdict(row: Row): string {
  if (row.production === null || row.formula === null) return "no data";
  const p = row.production;
  const f = row.formula;
  if (Math.abs(f.minutes - p.minutes) < 0.05 && Math.abs(f.km - p.km) < 0.05) return "same route";
  const dirtMode = row.mode !== "curvy";
  const gain = dirtMode
    ? (f.dirtShare ?? 0) - (p.dirtShare ?? 0)
    : (f.francoPerKm ?? 0) / Math.max(1, p.francoPerKm ?? 1) - 1;
  const busyWorse = (f.busyShare ?? 0) - (p.busyShare ?? 0) > 0.1;
  const extra = f.minutes - p.minutes;
  if (gain >= (dirtMode ? 0.03 : 0.1) && !busyWorse) return `WIN (${dirtMode ? `+${(gain * 100).toFixed(0)} pp dirt` : `+${(gain * 100).toFixed(0)}% curvature`}, ${extra >= 0 ? "+" : ""}${extra.toFixed(0)} min)`;
  if (gain <= -(dirtMode ? 0.03 : 0.1)) return `LOSS (${dirtMode ? `${(gain * 100).toFixed(0)} pp dirt` : `${(gain * 100).toFixed(0)}% curvature`})`;
  return "tie";
}

function table(rows: readonly Row[], includeFastest: boolean): string[] {
  const lines = [
    "| Trip | Mode | Route | Min | vs fastest | vs prod | Dirt % | Longest dirt km | Franco bend % | Franco /km | Busy % | Formula | Verdict |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const row of rows) {
    const fastest = row.fastest;
    const formulaCells = (label: string, m: Measured | null, last: boolean): string => {
      if (m === null) return `| ${row.trip.label} | ${row.mode} | ${label} | n/a | | | | | | | | | ${last ? verdict(row) : ""} |`;
      const vsFast = fastest === null ? "n/a" : `${(((m.minutes / fastest.minutes) - 1) * 100).toFixed(0)}%`;
      const vsProd = row.production === null || label === "production" || label === "fastest" ? "" : `${(m.minutes - row.production.minutes).toFixed(0)} min`;
      return `| ${row.trip.label} | ${row.mode} | ${label} | ${m.minutes.toFixed(0)} | ${label === "fastest" ? "-" : vsFast} | ${vsProd} | ${pct(m.dirtShare)} | ${num(m.longestDirtKm, 1)} | ${pct(m.francoBendShare)} | ${num(m.francoPerKm)} | ${pct(m.busyShare)} | ${m.formulaValue.toFixed(1)} | ${last ? verdict(row) : ""} |`;
    };
    if (includeFastest) lines.push(formulaCells("fastest", row.fastest, false));
    lines.push(formulaCells("production", row.production, false));
    lines.push(formulaCells("formula", row.formula, true));
  }
  return lines;
}

interface JevRow {
  readonly label: string;
  readonly before: string;
  readonly beforeMs: number | null;
  readonly after: string;
  readonly afterMs: number | null;
}

/**
 * Jev reliability over the benchmark trips. "Before" is the old behaviour:
 * the judge runs in the request path (`on`, 1.2 s deadline). "After" is the
 * new shadow path: off the response path with a 4 s budget. Each run gets a
 * fresh judge so neither benefits from the other's cache. Needs JEV_API_KEY.
 */
async function jevReliability(trips: readonly Trip[]): Promise<JevRow[]> {
  const rows: JevRow[] = [];
  for (const trip of trips) {
    const mode = trip.modes[0]!;
    const run = async (judgeMode: "on" | "shadow"): Promise<{ outcome: string; ms: number | null }> => {
      const port = jevFunJudgeFromEnv(process.env);
      if (port === null) return { outcome: "no-key", ms: null };
      const funJudge = createFunJudge(port);
      let shadow: { outcome: string; ms: number } | null = null;
      const provider = createGraphHopperProvider({ baseUrl: BASE_URL, riderModesEnabled: true, rideFormulaEnabled: false });
      const result = await planRide(
        { identity: { rideId: `jev_${trip.id}`, rideRevision: 1, planningGeneration: 1 }, request: requestFor(trip, mode, `jev-${judgeMode}`) },
        {
          provider, funJudge, funCharacterClassifier: null, roadAuthority: null,
          env: { OGV_RIDER_MODES: "on", OGV_TRAFFIC_LIVE_AVOID: "off", OGV_ROAD_AUTHORITY: "off", OGV_FUN_GENERATORS: "off", OGV_ATLAS_GENERATORS: "off", OGV_JEV_FUN_JUDGE: judgeMode },
          onFunJudgeShadow: (selection) => { shadow = { outcome: selection.diagnostic?.outcome ?? "no-judgement", ms: selection.diagnostic?.latencyMs ?? 0 }; },
        },
      );
      if (!result.ok) return { outcome: "plan-failed", ms: null };
      if (judgeMode === "on") {
        const diagnostic = result.diagnostics.funJudge;
        return diagnostic === undefined ? { outcome: "no-judgement", ms: null } : { outcome: diagnostic.outcome, ms: diagnostic.latencyMs };
      }
      const deadline = Date.now() + 8_000;
      while (shadow === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      const done = shadow as { outcome: string; ms: number } | null;
      return done === null ? { outcome: "never-finished", ms: null } : done;
    };
    const before = await run("on");
    const after = await run("shadow");
    rows.push({ label: `${trip.label} (${mode})`, before: before.outcome, beforeMs: before.ms, after: after.outcome, afterMs: after.ms });
    console.log(`jev ${trip.id}: before ${before.outcome} ${before.ms ?? ""}ms, after ${after.outcome} ${after.ms ?? ""}ms`);
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
  return rows;
}

function jevSection(rows: readonly JevRow[]): string[] {
  const judged = (outcome: string): boolean => !["no-judgement", "no-key", "plan-failed", "never-finished"].includes(outcome);
  const before = rows.filter((row) => judged(row.before));
  const after = rows.filter((row) => judged(row.after));
  const timeouts = (set: readonly { outcome: string }[]): number => set.filter((row) => row.outcome === "timeout").length;
  return [
    "## Jev reliability (live judge)",
    "",
    `Before = judge in the request path (\`on\`, 1.2 s deadline). After = shadow path, off the response path, 4 s budget. Fresh judge per run (no shared cache). Trips where a judgement happened: before ${before.length}, after ${after.length}.`,
    "",
    `Timeouts: before ${timeouts(before.map((row) => ({ outcome: row.before })))} of ${before.length}; after ${timeouts(after.map((row) => ({ outcome: row.after })))} of ${after.length}.`,
    "",
    "| Trip | Before | ms | After | ms |",
    "|---|---|---:|---|---:|",
    ...rows.map((row) => `| ${row.label} | ${row.before} | ${row.beforeMs === null ? "" : Math.round(row.beforeMs)} | ${row.after} | ${row.afterMs === null ? "" : Math.round(row.afterMs)} |`),
    "",
  ];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = new Set((args[args.indexOf("--only") + 1] ?? "").split(",").filter((entry) => entry !== "" && args.includes("--only")));
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1]! : "docs/vnext/research/ride-formula-benchmark-2026-10-04.md";
  const trips = [...DIRT_TRIPS, ...CORPUS_TRIPS].filter((trip) => only.size === 0 || only.has(trip.id));
  const rows: Row[] = [];
  for (const trip of trips) {
    for (const mode of trip.modes) {
      let fastest: Measured | null = null;
      try { fastest = await fastestFor(trip, mode); } catch (error) { console.error(`fastest failed ${trip.id}: ${String(error)}`); }
      const fastestSeconds = fastest === null ? 0 : fastest.minutes * 60;
      let production: Awaited<ReturnType<typeof planOnce>> | null = null;
      let formula: Awaited<ReturnType<typeof planOnce>> | null = null;
      try { production = await planOnce(trip, mode, "production", fastestSeconds); } catch (error) { console.error(`production failed ${trip.id}: ${String(error)}`); }
      try { formula = await planOnce(trip, mode, "formula", fastestSeconds); } catch (error) { console.error(`formula failed ${trip.id}: ${String(error)}`); }
      const row: Row = {
        trip, mode, fastest,
        production: production?.measured ?? null, formula: formula?.measured ?? null,
        productionCalls: production?.calls ?? 0, formulaCalls: formula?.calls ?? 0,
        productionMs: production?.ms ?? 0, formulaMs: formula?.ms ?? 0,
        note: [production?.note, formula?.note].filter((entry) => entry !== undefined && entry !== "").join(" | "),
      };
      rows.push(row);
      console.log(`${trip.id} ${mode}: prod ${row.production === null ? "-" : `${row.production.minutes.toFixed(0)}min dirt ${pct(row.production.dirtShare)}%`} formula ${row.formula === null ? "-" : `${row.formula.minutes.toFixed(0)}min dirt ${pct(row.formula.dirtShare)}%`} ${verdict(row)} (${row.formulaCalls} calls ${(row.formulaMs / 1000).toFixed(1)}s) ${row.note}`);
    }
  }
  const jevRows = args.includes("--jev") ? await jevReliability(trips) : [];
  const dirtRows = rows.filter((row) => row.trip.dirtFocus);
  const corpusRows = rows.filter((row) => !row.trip.dirtFocus);
  const wins = rows.filter((row) => verdict(row).startsWith("WIN")).length;
  const losses = rows.filter((row) => verdict(row).startsWith("LOSS")).length;
  const ties = rows.length - wins - losses;
  const mean = (values: readonly (number | null)[]): number | null => {
    const known = values.filter((value): value is number => value !== null);
    return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length;
  };
  const summary = (label: string, set: readonly Row[]): string => {
    const fm = (pick: (row: Row) => Measured | null, field: keyof Measured): number | null => mean(set.map((row) => { const m = pick(row); const value = m?.[field]; return typeof value === "number" ? value : null; }));
    const production = (field: keyof Measured) => fm((row) => row.production, field);
    const formula = (field: keyof Measured) => fm((row) => row.formula, field);
    return `| ${label} | ${set.length} | ${pct(production("dirtShare"))} -> ${pct(formula("dirtShare"))} | ${num(production("longestDirtKm"), 1)} -> ${num(formula("longestDirtKm"), 1)} | ${num(production("francoPerKm"))} -> ${num(formula("francoPerKm"))} | ${pct(production("busyShare"))} -> ${pct(formula("busyShare"))} | ${num(production("minutes"))} -> ${num(formula("minutes"))} | ${num(production("formulaValue"), 1)} -> ${num(formula("formulaValue"), 1)} |`;
  };
  const document = [
    "# Ride Formula benchmark (live GraphHopper, PA/NJ)",
    "",
    `Run: ${new Date().toISOString()}. Router: ${BASE_URL} (profiles_lm landmarks, PA+NJ). Strictly sequential.`,
    "",
    "Three plans per trip and mode: **fastest** (plain fastest profile, the Google-like baseline), **production** (today's Best Ride: rider modes and knee search; Gravel Atlas probes and Ride Formula off), **formula** (Gravel Atlas probes on, `OGV_RIDE_FORMULA=on`, request-time penalty rules on).",
    "Dirt % is distance-weighted unpaved surface (gravel, fine_gravel, compacted, dirt, ground, unpaved; sand excluded and never routed). Franco bend % and Franco /km are the roadcurvature.com style measure (franco-v1) of the returned line. Busy % is primary/trunk/motorway, links and CITY density. Formula is ride-formula-v1 (0-100) for the trip's mode, the same scorer for every row. Loops have no fastest baseline (`vs fastest` is n/a).",
    "",
    "## Summary (production -> formula, means)",
    "",
    "| Set | Plans | Dirt % | Longest dirt km | Franco /km | Busy % | Minutes | Formula value |",
    "|---|---:|---|---|---|---|---|---|",
    summary("Dirt-focused trips", dirtRows),
    summary("PA/NJ corpus", corpusRows),
    summary("All", rows),
    "",
    `Verdicts over ${rows.length} plans: ${wins} win, ${losses} loss, ${ties} tie or same route. A win means the formula route has at least +3 pp dirt (dirt modes) or +10% Franco curvature per km (Curvy), with busy-road share not worse by more than 10 pp.`,
    "",
    "## Dirt-focused trips",
    "",
    ...table(dirtRows, true),
    "",
    "## PA/NJ corpus",
    "",
    ...table(corpusRows, true),
    "",
    "## Cost",
    "",
    "| Trip | Mode | Production calls | Production s | Formula calls | Formula s | Notes |",
    "|---|---|---:|---:|---:|---:|---|",
    ...rows.map((row) => `| ${row.trip.label} | ${row.mode} | ${row.productionCalls} | ${(row.productionMs / 1000).toFixed(1)} | ${row.formulaCalls} | ${(row.formulaMs / 1000).toFixed(1)} | ${row.note} |`),
    "",
    ...(jevRows.length === 0 ? [] : jevSection(jevRows)),
  ].join("\n");
  await writeFile(out, document);
  await writeFile(out.replace(/\.md$/, ".json"), JSON.stringify(rows, null, 1));
  console.log(`Saved ${out}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
