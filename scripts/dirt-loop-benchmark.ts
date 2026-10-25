/**
 * Live route-plan loop evidence. Run on the baseline revision before editing,
 * then on the treatment with the same cache, seeds and corpus:
 * node --conditions=react-server --import tsx scripts/dirt-loop-benchmark.ts --arm before
 * node --conditions=react-server --import tsx scripts/dirt-loop-benchmark.ts --arm after
 *
 * --prune-capped-lanes avoids HTTP work for answers the six-candidate cap
 * necessarily discards. It waits for the leading lanes and prunes only when
 * both returned three seeds. Omit for a full generator trace (e.g. --only jim-thorpe).
 * Raw responses stay in /tmp; they are not public repository fixtures.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { handleRoutePlanRequest } from "@/server/planning/route-handler";
import { planRide, type PlanServiceResult } from "@/server/planning/plan-service";
import { riderEnvelopeMetrics } from "@/application/planner/rider-mode-search";
import type { ProviderCandidate, ProviderCandidateSet, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1] ?? fallback; }
const arm = arg("--arm", "after");
if (arm !== "before" && arm !== "after") throw Error("--arm must be before or after");
const cache = arg("--cache", "/tmp/dirt-gh-cache");
const out = arg("--out", `/tmp/dirt-loop-${arm}`);
const only = arg("--only", "").split(",");
const cap = Number(arg("--max-http-calls", "600"));
if (!Number.isSafeInteger(cap) || cap <= 0) throw Error("--max-http-calls must be a positive integer");
mkdirSync(cache, { recursive: true });
mkdirSync(out, { recursive: true });
let liveCalls = 0;
let capped = false;
let inFlight = 0;
const fetcher: typeof fetch = async (url, init) => {
  const body = String(init?.body);
  const key = createHash("sha256").update(`${String(url)}\n${body}`).digest("hex");
  const file = join(cache, `${key}.json`);
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8")) as { body: string; status: number };
    return new Response(saved.body, { status: saved.status });
  }
  // Count raw HTTP requests, including seeds and duration calibration, rather
  // than treating a provider invocation with many seeds as one router call.
  if (readdirSync(cache).length + inFlight >= cap) { capped = true; throw Error("Benchmark HTTP call cap reached"); }
  liveCalls += 1;
  inFlight += 1;
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    writeFileSync(file, JSON.stringify({ body: text, status: response.status, request: JSON.parse(body), url: String(url) }));
    return new Response(text, { status: response.status });
  } finally { inFlight -= 1; }
};
const starts = [
  ["jim-thorpe", 40.8676, -75.7327], ["pine-grove", 40.5484, -76.3847],
  ["lock-haven", 41.137, -77.4469], ["renovo", 41.3265, -77.7508],
  ["kempton", 40.6268, -75.853], ["wellsboro", 41.7487, -77.3005],
] as const;
function measurement(candidate: ProviderCandidate) {
  const metric = riderEnvelopeMetrics(candidate);
  return {
    profile: candidate.profile, minutes: candidate.durationSeconds / 60, km: candidate.distanceMeters / 1000,
    dirtPct: metric === null ? null : metric.unpavedShare * 100,
    dirtKm: metric === null ? null : candidate.roadSummary!.totalMeters * metric.unpavedShare / 1000,
    dirtValueKm: metric?.dirtValueKm ?? null,
  };
}
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
async function main(): Promise<void> {
for (const [name, lat, lon] of starts) {
  if (only[0] !== "" && !only.includes(name)) continue;
  for (const minutes of [120, 180]) for (const surface of ["dirt-preferred", "mixed"] as const) {
    if (arg("--minutes", String(minutes)) !== String(minutes) || arg("--surface", surface) !== surface) continue;
    const key = `${name}-${minutes}-${surface}`;
    const file = join(out, `${key}.json`);
    const origin = { lat, lon };
    const request: ProviderRouteRequest = {
      requestId: `dirt-loop:${key}`, origin, destination: origin, stops: [], shaping: [], avoidPolygons: [],
      profile: surface === "dirt-preferred" ? "motorcycle_adventure" : "motorcycle_fastest",
      options: { vehicle: "motorcycle", includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", surfacePreference: surface, roadCharacter: "balanced", traffic: "protect-ride", bike: { category: "adventure", maintainedGravel: "allow", roughTracks: "avoid" } },
      discovery: { targetMinutes: minutes, toleranceMinutes: minutes * 0.15 },
    };
    const inner = createGraphHopperProvider({ baseUrl: process.env["GRAPHHOPPER_URL"] ?? "http://127.0.0.1:18989", fetcher, riderModesEnabled: true, rideFormulaEnabled: false });
    const pending = new Map<string, Promise<ProviderCandidateSet>>();
    const raw: ProviderCandidate[] = [];
    const seen: unknown[] = [];
    const provider: RouteCandidateProvider = {
      id: inner.id, capabilities: () => inner.capabilities(),
      async candidates(asked, signal) {
        if (args.includes("--prune-capped-lanes") && asked.discovery !== undefined && ["motorcycle_twisty", "motorcycle_adventure"].includes(asked.profile)) {
          const leading = await Promise.all(["motorcycle_fastest", "motorcycle_scenic"].map(profile => pending.get(profile)));
          if (leading.every(answer => answer?.candidates.length === 3)) {
            seen.push({ pruned: asked.profile, reason: "leading lanes exhaust six-candidate cap" });
            return { candidates: [] };
          }
        }
        const answer = inner.candidates(asked, signal);
        pending.set(asked.profile, answer);
        const result = await answer;
        raw.push(...result.candidates);
        seen.push({ profile: asked.profile, discovery: asked.discovery, roadSpans: asked.roadSpans?.map(span => span.id), candidates: result.candidates.map(measurement) });
        return result;
      },
    };
    const env = {
      OGV_ATLAS_GENERATORS: "off", OGV_DIRT_LOOP_GENERATORS: arm === "after" ? "on" : "off", OGV_ATLAS_CALLS: "4",
      OGV_FUN_GENERATORS: "shadow", OGV_RIDE_FORMULA: "shadow", OGV_GRAVEL_ATLAS_PATH: "/var/lib/opengravel/gravel-atlas-v3.sqlite",
      OGV_TRAFFIC_LIVE_AVOID: "off", OGV_ROAD_AUTHORITY: "off", OGV_JEV_FUN_JUDGE: "off",
    };
    let result: PlanServiceResult | undefined;
    const before = liveCalls;
    const response = await handleRoutePlanRequest({ identity: { rideId: "ride_dirt_bench", rideRevision: 1, planningGeneration: 1 }, request }, {
      plan: async input => {
        result = await planRide(input, { provider, env, funCharacterClassifier: null, funJudge: null, roadAuthority: null, funGeneratorStrategies: [] });
        return result;
      },
    });
    if (capped) throw Error("Benchmark stopped at HTTP cap; do not report remaining plans as provider failures");
    const plan = result as PlanServiceResult | undefined;
    const pool = plan?.ok ? plan.bundle.candidates.map(candidate => {
      const source = raw.find(item => item.durationSeconds === candidate.durationSeconds && JSON.stringify(item.geometry) === JSON.stringify(candidate.geometry));
      return { id: candidate.id, ...(source === undefined ? {} : measurement(source)) };
    }) : [];
    const pick = plan?.ok ? pool.find(candidate => candidate.id === plan.bundle.roles["best-ride"]) : null;
    const evidence = { sha, arm, key, request, env, responseStatus: response.status, picked: pick, pool, seen, diagnostics: plan?.ok ? plan.diagnostics : plan, httpCalls: liveCalls - before, totalCachedResponses: readdirSync(cache).length };
    writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({ key, picked: pick, httpCalls: liveCalls - before, totalCachedResponses: readdirSync(cache).length }));
  }
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
