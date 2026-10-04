/**
 * Live FUN JUDGE evaluation (Node-only, explicit --live; zero model calls otherwise).
 *
 * For each public-place corpus case and road character, plans through the real
 * production plan service against the local GraphHopper with
 * OGV_JEV_FUN_JUDGE=shadow, then records, side by side:
 *   - the deterministic Best Ride (current production winner),
 *   - the Frontier method's pick (routing-method comparison, read-only),
 *   - Jev's raw choice in each presentation order and the budgeted verdict.
 * Only aggregate evidence and provider fingerprints are written; no geometry.
 *
 *   node --conditions=react-server --import tsx scripts/jev-fun-judge-eval.ts \
 *     --output out.json [--live] [--graphhopper http://127.0.0.1:8989]
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { createFunJudge } from "../src/application/planner/fun-judge";
import type { FunJudgeAnswer, FunJudgePort, FunJudgeRequest } from "../src/application/planner/ports/fun-judge";
import { buildRoutingMethodComparison } from "../src/application/planner/routing-method-comparison";
import { defaultRideIntent } from "../src/domain/ride/create";
import { asGeometryRef } from "../src/domain/ride/ids";
import type { RoadCharacterIntent } from "../src/domain/ride/types";
import type { RouteBundle } from "../src/domain/route/types";
import { createGraphHopperProvider } from "../src/infrastructure/routing/graphhopper/provider";
import { jevFunJudgeFromEnv } from "../src/infrastructure/routing/jev-fun-judge";
import { planRide } from "../src/server/planning/plan-service";
import { ROUTING_QUALITY_CORPUS } from "../tests/real-router/routing-quality-corpus";

interface CallRecord {
  readonly order: readonly string[];
  readonly status: FunJudgeAnswer["status"];
  readonly choice: string | null;
  readonly probabilities: Readonly<Record<string, number>> | null;
  readonly none: number | null;
  readonly latencyMs: number;
  readonly reason?: string;
  readonly httpStatus?: number;
}

/** Records raw slot keys (c<index> into the kept list); mapped to fingerprints after planning. */
function recordingPort(inner: FunJudgePort, log: CallRecord[]): FunJudgePort {
  return {
    modelId: inner.modelId,
    async rank(request: FunJudgeRequest, signal: AbortSignal) {
      const answer = await inner.rank(request, signal);
      const fp = (key: string) => key;
      log.push(
        answer.status === "ok"
          ? {
              order: request.candidates.map((c) => fp(c.key)),
              status: "ok",
              choice: answer.choiceKey === null ? null : fp(answer.choiceKey),
              probabilities: Object.fromEntries(
                Object.entries(answer.probabilities).map(([key, p]) => [fp(key), Number(p.toFixed(3))]),
              ),
              none: Number(answer.noneProbability.toFixed(3)),
              latencyMs: Math.round(answer.latencyMs),
            }
          : {
              order: request.candidates.map((c) => fp(c.key)),
              status: "unavailable",
              choice: null,
              probabilities: null,
              none: null,
              latencyMs: Math.round(answer.latencyMs),
              reason: answer.reason,
              ...(answer.httpStatus === undefined ? {} : { httpStatus: answer.httpStatus }),
            },
      );
      return answer;
    },
  };
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      output: { type: "string" },
      live: { type: "boolean", default: false },
      graphhopper: { type: "string", default: "http://127.0.0.1:8989" },
      characters: { type: "string", default: "curvy,backroads" },
    },
    strict: true,
  });
  if (values.output === undefined) throw Error("Required: --output result.json [--live]");
  const characters = values.characters!.split(",") as RoadCharacterIntent[];
  const inner = values.live ? jevFunJudgeFromEnv(process.env) : null;
  if (values.live && inner === null) throw Error("Live requires JEV_API_KEY");

  const calls: CallRecord[] = [];
  const port = inner === null ? null : recordingPort(inner, calls);
  // One judge for the run: the production budget/caching policy applies as-is.
  const judge = port === null ? null : createFunJudge(port);
  const provider = createGraphHopperProvider({ baseUrl: values.graphhopper! });
  const records: unknown[] = [];

  for (const entry of ROUTING_QUALITY_CORPUS) {
    for (const roadCharacter of characters) {
      const surfacePreference = entry.options?.surfacePreference ?? "pavement";
      const before = calls.length;
      const started = performance.now();
      // Candidate keys are c<index> into the kept list; the bundle keeps that order.
      const result = await planRide(
        {
          identity: { rideId: "ride_fun_judge_eval", rideRevision: 1, planningGeneration: 1 },
          request: {
            requestId: `eval_${entry.id}_${roadCharacter}`,
            origin: entry.origin,
            destination: entry.destination,
            stops: [],
            shaping: [],
            avoidPolygons: [],
            profile: roadCharacter === "curvy" ? "motorcycle_twisty" : "motorcycle_scenic",
            options: {
              includeAlternatives: true,
              avoidHighways: false,
              tollPolicy: "avoid",
              surfacePreference,
              roadCharacter,
              vehicle: "motorcycle",
            },
          },
        },
        {
          provider,
          env: { OGV_JEV_FUN_JUDGE: "shadow" },
          roadAuthority: null,
          funCharacterClassifier: null,
          funJudge: judge,
        },
      );
      const planMs = Math.round(performance.now() - started);
      if (!result.ok) {
        records.push({ caseId: entry.id, roadCharacter, status: "plan-failed", code: result.error.code });
        continue;
      }
      const bundle = result.bundle;
      const fpOf = (id: string | null | undefined) =>
        bundle.candidates.find((c) => c.id === id)?.fingerprint ?? null;
      const rideId = "ride_fun_judge_eval" as RouteBundle["rideId"];
      const domainBundle: RouteBundle = {
        ...bundle,
        candidates: bundle.candidates.map((candidate, index) => {
          const { geometry, ...withoutGeometry } = candidate;
          void geometry; // geometry stays out of the domain bundle and the evidence file
          return { ...withoutGeometry, geometryRef: asGeometryRef(`eval_${index}`) };
        }),
        rideId,
        rideRevision: 1,
        planningGeneration: 1,
        createdAt: new Date().toISOString(),
      } as RouteBundle;
      const comparison = buildRoutingMethodComparison({
        bundle: domainBundle,
        selectedRouteId: domainBundle.selectedRouteId,
        intent: { ...defaultRideIntent(), roadCharacter },
        stale: false,
      });
      const method = (id: string) => comparison.methods.find((m) => m.id === id)?.routeId ?? null;
      const diagnostic = result.diagnostics.funJudge;
      const keyFp = (key: string) => bundle.candidates[Number(key.slice(1))]?.fingerprint ?? key;
      const planCalls = calls.slice(before).map((call) => ({
        ...call,
        order: call.order.map(keyFp),
        choice: call.choice === null ? null : keyFp(call.choice),
        probabilities: call.probabilities === null
          ? null
          : Object.fromEntries(Object.entries(call.probabilities).map(([key, p]) => [keyFp(key), p])),
      }));
      records.push({
        caseId: entry.id,
        roadCharacter,
        surfacePreference,
        status: "planned",
        planMs,
        candidates: bundle.candidates.map((c) => ({
          fingerprint: c.fingerprint,
          profile: c.provider.profile,
          durationMinutes: Number((c.durationSeconds / 60).toFixed(1)),
          distanceMiles: Number((c.distanceMeters / 1609.344).toFixed(1)),
          scoreTotal: Number(c.score.total.toFixed(2)),
          curvature: c.score.components.curvature.input,
          backroad: c.score.components.backroad.input,
          elevation: c.score.components.elevation.input,
          junctionFriction: c.score.components.junctionFriction.input,
        })),
        deterministicBestRide: fpOf(bundle.roles["best-ride"]),
        frontierPick: fpOf(method("frontier")),
        sustainedCurvesPick: fpOf(method("sustained-curves")),
        funJudge: diagnostic === undefined
          ? null
          : {
              outcome: diagnostic.outcome,
              jevPick: fpOf(diagnostic.jevRouteId),
              confidence: diagnostic.confidence,
              margin: diagnostic.margin,
              orderAgreement: diagnostic.orderAgreement,
              shortlistSize: diagnostic.shortlistSize,
              excluded: diagnostic.excluded.map((e) => ({ fingerprint: fpOf(e.routeId), reason: e.reason })),
              why: diagnostic.why,
              addedTimePct: diagnostic.addedTimePct,
              calls: diagnostic.calls,
              cached: diagnostic.cached,
              latencyMs: diagnostic.latencyMs,
            },
        modelCalls: planCalls,
      });
    }
  }

  // ---- summary ------------------------------------------------------------
  type Planned = {
    status: "planned";
    deterministicBestRide: string | null;
    frontierPick: string | null;
    funJudge: null | { outcome: string; jevPick: string | null; shortlistSize: number; latencyMs: number };
    modelCalls: CallRecord[];
  };
  const planned = records.filter((r): r is Planned => (r as { status: string }).status === "planned");
  const judged = planned.filter((r) => r.modelCalls.length > 0);
  const rawChoice = (r: Planned): string | null => {
    // Mean-probability argmax across orders (ignores the promotion floors).
    const ok = r.modelCalls.filter((c) => c.status === "ok" && c.probabilities !== null);
    if (ok.length === 0) return null;
    const totals = new Map<string, number>();
    for (const call of ok) for (const [fp, p] of Object.entries(call.probabilities!)) totals.set(fp, (totals.get(fp) ?? 0) + p);
    const none = ok.reduce((s, c) => s + (c.none ?? 0), 0);
    const best = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    return best === undefined || none > best[1] ? null : best[0];
  };
  const rate = (n: number, d: number) => (d === 0 ? null : Number((n / d).toFixed(3)));
  const withRaw = judged.filter((r) => rawChoice(r) !== null);
  const preferred = planned.filter((r) => r.funJudge?.outcome === "preferred");
  const callLatencies = calls.map((c) => c.latencyMs);
  const outcomes: Record<string, number> = {};
  for (const r of planned) {
    const key = r.funJudge?.outcome ?? "none";
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  }
  const orderPairs = judged.filter((r) => r.modelCalls.length === 2 && r.modelCalls.every((c) => c.status === "ok"));
  const summary = {
    plans: records.length,
    plannedOk: planned.length,
    judgedPlans: judged.length,
    modelCalls: calls.length,
    modelCallsOk: calls.filter((c) => c.status === "ok").length,
    outcomes,
    orderAgreementRate: rate(orderPairs.filter((r) => r.modelCalls[0]!.choice === r.modelCalls[1]!.choice).length, orderPairs.length),
    rawJevVsDeterministic: {
      comparable: withRaw.length,
      agreementRate: rate(withRaw.filter((r) => rawChoice(r) === r.deterministicBestRide).length, withRaw.length),
    },
    rawJevVsFrontier: {
      comparable: withRaw.filter((r) => r.frontierPick !== null).length,
      agreementRate: rate(
        withRaw.filter((r) => r.frontierPick !== null && rawChoice(r) === r.frontierPick).length,
        withRaw.filter((r) => r.frontierPick !== null).length,
      ),
    },
    confidentJevVsDeterministic: {
      preferred: preferred.length,
      agreementRate: rate(preferred.filter((r) => r.funJudge!.jevPick === r.deterministicBestRide).length, preferred.length),
      wouldChangeBestRide: preferred.filter((r) => r.funJudge!.jevPick !== r.deterministicBestRide).length,
    },
    deterministicVsFrontierAgreementRate: rate(
      planned.filter((r) => r.frontierPick !== null && r.frontierPick === r.deterministicBestRide).length,
      planned.filter((r) => r.frontierPick !== null).length,
    ),
    callLatencyMs: {
      p50: percentile(callLatencies, 50),
      p95: percentile(callLatencies, 95),
      max: callLatencies.length === 0 ? null : Math.max(...callLatencies),
    },
    judgementLatencyMs: {
      p50: percentile(judged.map((r) => r.funJudge?.latencyMs ?? 0), 50),
      p95: percentile(judged.map((r) => r.funJudge?.latencyMs ?? 0), 95),
    },
  };

  await writeFile(
    values.output,
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        mode: values.live ? "live" : "no-model",
        model: inner?.modelId ?? null,
        graphhopper: "local GraphHopper (PA/NJ graph)",
        roadAuthority: "disabled for evaluation (closures/access unknown, not clear)",
        summary,
        records,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  console.error("FUN JUDGE evaluation failed:", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
