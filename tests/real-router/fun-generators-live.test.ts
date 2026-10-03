/**
 * Live equal-budget measurement of the fun-route generator family.
 *
 * Opt-in twice: GraphHopper must answer AND `OGV_FUN_GENERATORS_LIVE=1`, because
 * this spends ~15 sequential calls per request on the production router.
 *
 * Protocol (generalizes #36): the control is the real production plan. Each
 * treatment replays the control's own lane answers except the generic
 * `balanced` lane and the engine-alternatives pass, and hands exactly the calls
 * those spent to one generator (or the whole family). Treatment and control
 * therefore cost the same number of provider calls. A `family@3` row spends 3
 * extra calls and is reported as informational, never as an equal-budget win.
 *
 * Set `OGV_FUN_GENERATORS_EVIDENCE=<path>` to write the JSON evidence file.
 */

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { FunGeneratorAllocation, FunGeneratorReport } from "@/application/planner/fun-generators";
import { ALL_FUN_GENERATORS, FUN_GENERATORS, funRouteMeasurement } from "@/application/planner/fun-generator-strategies";
import type { ProviderCandidateSet, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import type { RoutePlanCandidate } from "@/application/planner/ports/route-plan-contract";
import { routeSimilarity } from "@/domain/route/diversity";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { planRide, ROUTE_POLICY } from "@/server/planning/plan-service";
import { roadAuthorityFromEnv } from "@/server/planning/road-authority";
import type { FunGeneratorSettings } from "@/server/planning/fun-generators";

const url = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";
const enabled = process.env.OGV_FUN_GENERATORS_LIVE === "1";
const reachable = enabled && await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_500) }).then((response) => response.ok, () => false);
const live = reachable ? describe : describe.skip;

interface Case {
  readonly id: string;
  readonly origin: { lon: number; lat: number };
  readonly destination: { lon: number; lat: number };
  readonly loopMinutes?: number;
}

const CASES: readonly Case[] = [
  { id: "jim-thorpe-to-hawk-mountain", origin: { lon: -75.736, lat: 40.8687 }, destination: { lon: -75.9906, lat: 40.6346 } },
  { id: "doylestown-to-frenchtown", origin: { lon: -75.1299, lat: 40.3101 }, destination: { lon: -75.0618, lat: 40.5262 } },
  { id: "water-gap-to-stroudsburg", origin: { lon: -75.1427, lat: 40.9787 }, destination: { lon: -75.1946, lat: 40.9868 } },
  { id: "king-of-prussia-to-phoenixville", origin: { lon: -75.396, lat: 40.089 }, destination: { lon: -75.5149, lat: 40.1304 } },
  { id: "hatboro-loop-90", origin: { lon: -75.1068, lat: 40.1748 }, destination: { lon: -75.1068, lat: 40.1748 }, loopMinutes: 90 },
  // A loop from inside the library's densest area, so the loop beam is tested where it has material.
  { id: "green-lane-loop-120", origin: { lon: -75.4716, lat: 40.3376 }, destination: { lon: -75.4716, lat: 40.3376 }, loopMinutes: 120 },
];

const BALANCED_PROFILE = "motorcycle_scenic";

function request(entry: Case): ProviderRouteRequest {
  return {
    requestId: `live_fun_${entry.id}`,
    origin: entry.origin,
    destination: entry.destination,
    stops: [],
    shaping: [],
    avoidPolygons: [],
    profile: "motorcycle_twisty",
    options: {
      includeAlternatives: true,
      avoidHighways: false,
      tollPolicy: "avoid",
      surfacePreference: "pavement",
      roadCharacter: "curvy",
      vehicle: "motorcycle",
    },
    ...(entry.loopMinutes === undefined ? {} : { discovery: { targetMinutes: entry.loopMinutes, toleranceMinutes: 15 } }),
  };
}

function laneKey(request: ProviderRouteRequest): string {
  return `${request.profile}|alt=${String(request.options.includeAlternatives)}`;
}

/** Counts every live call and keeps the control's lane answers for replay. */
function recorder(inner: RouteCandidateProvider) {
  const answers = new Map<string, ProviderCandidateSet>();
  const calls: { key: string; shaping: number; ms: number }[] = [];
  const provider: RouteCandidateProvider = {
    id: inner.id,
    capabilities: () => inner.capabilities(),
    async candidates(request, signal) {
      const started = performance.now();
      const answer = await inner.candidates(request, signal);
      calls.push({ key: laneKey(request), shaping: request.shaping.length, ms: Math.round(performance.now() - started) });
      if (request.shaping.length === 0) answers.set(laneKey(request), answer);
      return answer;
    },
  };
  return { provider, answers, calls };
}

/** Replays the control's lanes; the balanced lane and the alternatives pass are handed to the generators. */
function replay(answers: ReadonlyMap<string, ProviderCandidateSet>, inner: RouteCandidateProvider, keepAll: boolean): RouteCandidateProvider {
  return {
    id: inner.id,
    capabilities: () => inner.capabilities(),
    async candidates(request) {
      if (!keepAll && (request.profile === BALANCED_PROFILE || request.options.includeAlternatives)) return { candidates: [] };
      return answers.get(laneKey(request)) ?? { candidates: [] };
    },
  };
}

function summarize(candidate: RoutePlanCandidate | undefined) {
  if (candidate === undefined) return null;
  const measured = funRouteMeasurement(candidate);
  return {
    minutes: Math.round(candidate.durationSeconds / 60),
    km: Math.round(candidate.distanceMeters / 100) / 10,
    bendShare: measured.bendShare === null ? null : Number(measured.bendShare.toFixed(3)),
    backroadShare: measured.backroadShare === null ? null : Number(measured.backroadShare.toFixed(3)),
    longestBendRunM: measured.longestBendRunMeters === null ? null : Math.round(measured.longestBendRunMeters),
  };
}

function bestRide(candidates: readonly RoutePlanCandidate[], roles: Readonly<Record<string, string | null>>): RoutePlanCandidate | undefined {
  return candidates.find((candidate) => candidate.id === roles["best-ride"]) ?? candidates[0];
}

const evidence: Record<string, unknown>[] = [];

live("fun-route generators — equal-budget live measurement", () => {
  for (const entry of CASES) {
    it(`measures ${entry.id}`, { timeout: 240_000 }, async () => {
      const roadAuthority = roadAuthorityFromEnv(process.env);
      const graphhopper = createGraphHopperProvider({ baseUrl: url });
      const control = recorder(graphhopper);
      const started = performance.now();
      const plan = await planRide({ identity: { rideId: "ride_live_fun", rideRevision: 1, planningGeneration: 1 }, request: request(entry) }, {
        provider: control.provider,
        env: {},
        roadAuthority,
        funCharacterClassifier: null,
        funGenerators: { mode: "off", allocation: "fixed", budget: { maxProviderCalls: 0, deadlineMs: 0 } },
      });
      const controlMs = Math.round(performance.now() - started);
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      const controlBest = bestRide(plan.bundle.candidates, plan.bundle.roles);
      const controlCalls = control.calls.length;
      const freed = control.calls.filter((call) => call.key.startsWith(`${BALANCED_PROFILE}|`) || call.key.endsWith("alt=true")).length;

      const arms: { id: string; generators: typeof FUN_GENERATORS; allocation: FunGeneratorAllocation; calls: number; equal: boolean }[] = [
        ...ALL_FUN_GENERATORS.map((generator) => ({ id: generator.id, generators: [generator], allocation: "fixed" as const, calls: freed, equal: true })),
        { id: "family-fixed", generators: FUN_GENERATORS, allocation: "fixed", calls: freed, equal: true },
        { id: "family-adaptive", generators: FUN_GENERATORS, allocation: "adaptive", calls: freed, equal: true },
        { id: "family-adaptive@3-extra", generators: FUN_GENERATORS, allocation: "adaptive", calls: 3, equal: false },
        { id: "all-adaptive@3-extra", generators: ALL_FUN_GENERATORS, allocation: "adaptive", calls: 3, equal: false },
      ];

      const rows: Record<string, unknown>[] = [];
      for (const arm of arms) {
        const counted = recorder(graphhopper);
        let report: FunGeneratorReport | null = null;
        const settings: FunGeneratorSettings = { mode: "on", allocation: arm.allocation, budget: { maxProviderCalls: arm.calls, deadlineMs: 25_000 } };
        // Lane requests replay the control: equal-budget arms lose the balanced
        // lane and the alternatives pass; `@3-extra` keeps every control lane.
        // Generator requests (shaped, re-ended or loop-as-vias) go live and are counted.
        const asked = request(entry);
        const lanes = replay(control.answers, graphhopper, !arm.equal);
        const isLane = (req: ProviderRouteRequest): boolean =>
          req.shaping.length === 0 &&
          (req.discovery === undefined) === (asked.discovery === undefined) &&
          req.origin.lon === asked.origin.lon && req.origin.lat === asked.origin.lat &&
          req.destination.lon === asked.destination.lon && req.destination.lat === asked.destination.lat;
        const provider: RouteCandidateProvider = {
          id: graphhopper.id,
          capabilities: () => graphhopper.capabilities(),
          candidates: (req, signal) => (isLane(req) ? lanes.candidates(req, signal) : counted.provider.candidates(req, signal)),
        };
        const treatment = await planRide({ identity: { rideId: "ride_live_fun", rideRevision: 1, planningGeneration: 1 }, request: request(entry) }, {
          provider,
          env: {},
          roadAuthority,
          funCharacterClassifier: null,
          funGenerators: settings,
          funGeneratorStrategies: arm.generators,
          onFunGeneratorReport: (value) => { report = value; },
        });
        const result = report as FunGeneratorReport | null;
        const pool = result?.pool ?? [];
        const newVsControl = pool.filter((generated) => plan.bundle.candidates.every((existing) => {
          const similarity = routeSimilarity(
            { id: 0, geometry: generated.candidate.geometry, score: { total: 0 } },
            { id: 1, geometry: existing.geometry, score: { total: 0 } },
          );
          return similarity.mode === "unknown" || similarity.overlap < ROUTE_POLICY.duplicateSimilarityThreshold;
        }));
        // Proposals are pure and known before any call is spent, so a strategy
        // with nothing to propose hands the call back to the balanced lane: the
        // equal-budget treatment is then exactly the control.
        const fellBack = arm.equal && (result === null || result.probes.length === 0);
        const treatmentBest = fellBack
          ? controlBest
          : treatment.ok ? bestRide(treatment.bundle.candidates, treatment.bundle.roles) : undefined;
        const generatedShown = treatment.ok
          ? treatment.bundle.candidates.filter((shown) => pool.some((generated) => generated.measurement.fingerprint === shown.fingerprint)).length
          : 0;
        rows.push({
          arm: arm.id,
          equalBudget: arm.equal,
          budgetCalls: arm.calls,
          fellBackToBalanced: fellBack,
          liveCalls: counted.calls.length,
          generatorMs: result === null ? null : Math.round(result.elapsedMs),
          proposals: result?.proposals ?? {},
          probes: (result?.probes ?? []).map((probe) => ({
            generator: probe.generator,
            status: probe.status,
            note: probe.note,
            calls: probe.providerCalls,
            adherence: probe.adherence === null ? null : Number(probe.adherence.toFixed(2)),
            sources: probe.sourceIds,
            ...(probe.ineligibleCodes === undefined ? {} : { ineligible: probe.ineligibleCodes }),
            ...(probe.measurement === undefined ? {} : {
              minutes: Math.round(probe.measurement.durationSeconds / 60),
              bendShare: probe.measurement.bendShare === null ? null : Number(probe.measurement.bendShare.toFixed(3)),
              backroadShare: probe.measurement.backroadShare === null ? null : Number(probe.measurement.backroadShare.toFixed(3)),
            }),
          })),
          newEligible: newVsControl.length,
          generatedShownInBundle: generatedShown,
          treatmentBestRide: summarize(treatmentBest),
          treatmentBestIsGenerated: treatmentBest !== undefined && pool.some((generated) => generated.measurement.fingerprint === treatmentBest.fingerprint),
        });
      }

      evidence.push({
        case: entry.id,
        loopMinutes: entry.loopMinutes ?? null,
        control: {
          calls: controlCalls,
          lanes: control.calls.map((call) => `${call.key} ${call.ms}ms`),
          freedCalls: freed,
          planMs: controlMs,
          bestRide: summarize(controlBest),
          shown: plan.bundle.candidates.map(summarize),
        },
        arms: rows,
      });
      const path = process.env.OGV_FUN_GENERATORS_EVIDENCE;
      if (path !== undefined && path !== "") {
        writeFileSync(path, `${JSON.stringify({ measuredAt: new Date().toISOString(), router: "local GraphHopper PA/NJ", cases: evidence }, null, 2)}\n`);
      }
    });
  }
});
