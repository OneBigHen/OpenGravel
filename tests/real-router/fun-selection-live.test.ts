import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import { analyzeBends } from "@/domain/geometry/bends";
import { analyzeFrancoCurvature } from "@/domain/geometry/franco-curvature";
import { candidateGeometryFun } from "@/application/planner/geometry-fun";
import { DEFAULT_BIKE } from "@/domain/ride/create";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { planRide } from "@/server/planning/plan-service";
import { ROUTING_QUALITY_CORPUS } from "./routing-quality-corpus";

const enabled = process.env.OGV_FUN_SELECTION_BENCHMARK === "1";
const live = enabled ? describe : describe.skip;
const origin = { lon: -75.7387, lat: 40.8636 };
const trips = [
  { id: "fun-best-destination", label: "Jim Thorpe → Hawk Mountain", origin, destination: { lon: -75.9832, lat: 40.6364 }, loop: false, avoidHighways: false },
  { id: "fun-best-loop-120", label: "Jim Thorpe 120-minute loop", origin, destination: origin, loop: true, avoidHighways: false },
  ...ROUTING_QUALITY_CORPUS.filter(c => ["allentown-stroudsburg", "doylestown-new-hope", "reading-jim-thorpe", "bethlehem-delaware-water-gap"].includes(c.id)).map(c => ({
    ...c, id: `og-curve:${c.id}`, loop: false, avoidHighways: c.options?.avoidHighways ?? false,
  })),
];

function measure(candidate: Pick<ProviderCandidate, "geometry" | "durationSeconds" | "distanceMeters">) {
  return {
    minutes: candidate.durationSeconds / 60,
    miles: candidate.distanceMeters / 1609.344,
    curvyMiles: analyzeBends(candidate.geometry).bendMeters / 1609.344,
    francoPerKm: analyzeFrancoCurvature(candidate.geometry).curvaturePerKm,
  };
}

/** Fixed request IDs and unchanged control graph on both app revisions. Fails on unavailable routers; never a green skip when enabled. */
live("geometry fun selection through planRide", () => {
  const rows: { graph: string; trip: string; style: string; httpAttempts: number; best: ReturnType<typeof measure> | undefined; [key: string]: unknown }[] = [];
  const graphInfo = new Map<string, { version: string; profiles: unknown; bbox: unknown; data_date: string }>();
  function writeEvidence() {
    if (process.env.OGV_FUN_SELECTION_EVIDENCE) writeFileSync(process.env.OGV_FUN_SELECTION_EVIDENCE, JSON.stringify({ schema: 1, revision: process.env.OGV_FUN_SELECTION_REVISION ?? "working-tree", status: "measurement-only; passing is not promotion", router: process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989", graphInfo: Object.fromEntries(graphInfo), rows }, null, 2));
  }
  const repeats = Number(process.env.OGV_FUN_SELECTION_REPEATS ?? 1);
  const styles = process.env.OGV_FUN_SELECTION_FAST === "1" ? ["efficient"] as const : ["balanced", "curvy"] as const;
  afterAll(() => { writeEvidence(); expect(rows).toHaveLength(trips.length * styles.length * repeats); });
  for (let repeat = 0; repeat < repeats; repeat++)
  for (const graph of ["control"] as const) {
    for (const trip of trips) {
      for (const style of styles) {
        it(`${graph} / ${trip.label} / ${style}`, { timeout: 120_000 }, async () => {
          const url = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";
          expect(url, "Control router URL").toBeTruthy();
          const info = await fetch(`${url}/info`, { signal: AbortSignal.timeout(5000) }).then(r => { expect(r.ok).toBe(true); return r.json(); });

          expect(Boolean(info.encoded_values?.og_curve), "Use the unchanged control graph").toBe(false);
          const identity = { version: info.version, profiles: info.profiles, bbox: info.bbox, data_date: info.data_date };
          graphInfo.set(graph, identity);
          let httpAttempts = 0;
          const transport: { profile: string; algorithm: string; status: number }[] = [];
          const inner = createGraphHopperProvider({ baseUrl: url!, fetcher: async (input, init) => {
            httpAttempts += 1;
            const request = JSON.parse(String(init?.body ?? "{}"));
            const response = await fetch(input, init);
            transport.push({ profile: request.profile, algorithm: request.algorithm ?? "", status: response.status });
            return response;
          } });
          const calls: { profile: string; requestId: string; factor: number | null; elapsedMs: number; alternatives: boolean; candidates: readonly ProviderCandidate[] }[] = [];
          const sourceRoads = new Map<string, ProviderCandidate>();
          const geometryHash = (geometry: ProviderCandidate["geometry"]) => createHash("sha256").update(JSON.stringify(geometry)).digest("hex");
          const provider: RouteCandidateProvider = {
            id: inner.id, capabilities: () => inner.capabilities(),
            async candidates(request, signal) {
              const callStarted = performance.now();
              const result = await inner.candidates(request, signal);
              calls.push({ profile: request.profile, requestId: request.requestId, factor: request.options.riderModeFactor ?? null, alternatives: request.options.includeAlternatives, elapsedMs: performance.now() - callStarted, candidates: result.candidates });
              return result;
            },
          };
          const request: ProviderRouteRequest = {
            requestId: trip.id, origin: trip.origin, destination: trip.destination,
            stops: [], shaping: [], avoidPolygons: [], profile: style === "curvy" ? "motorcycle_twisty" : "motorcycle_fastest",
            options: { includeAlternatives: true, avoidHighways: trip.avoidHighways, tollPolicy: "avoid", surfacePreference: "mixed", roadCharacter: style, traffic: "protect-ride", vehicle: "motorcycle", bike: DEFAULT_BIKE },
            ...(trip.loop ? { discovery: { targetMinutes: 120, toleranceMinutes: 15 } } : {}),
          };
          const started = performance.now();
          const result = await planRide({ identity: { rideId: "og-curve", rideRevision: 1, planningGeneration: 1 }, request }, { provider, env: {}, roadAuthority: null, funCharacterClassifier: null });
          const elapsedMs = performance.now() - started;
          expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(true);
          if (!result.ok) return;
          const best = result.bundle.candidates.find(c => c.id === result.bundle.roles["best-ride"]);
          expect(best).toBeDefined();
          const fastest = result.bundle.candidates.find(c => c.id === result.bundle.roles.fastest);
          if (style === "balanced" && best && fastest && !trip.loop) expect(best.durationSeconds).toBeLessThanOrEqual(fastest.durationSeconds * 1.25);
          if (trip.loop && best) {
            expect(best.durationSeconds / 60).toBeGreaterThanOrEqual(105);
            expect(best.durationSeconds / 60).toBeLessThanOrEqual(135);
          }
          for (const call of calls) for (const candidate of call.candidates) {
            if (candidate.roadSummary) sourceRoads.set(geometryHash(candidate.geometry), candidate);
          }
          const bestSource = best ? sourceRoads.get(geometryHash(best.geometry)) : undefined;
          const row = { repeat, bestSurfaceEvidence: best?.evidence.surfaceMix ?? null, bestRawSurfaceByRoadClassMeters: bestSource ? { surfaces: bestSource.roadSummary?.surfaceByRoadClassMeters, fun: candidateGeometryFun(bestSource) } : null, graph, trip: trip.id, label: trip.label, style, httpAttempts, transport, canonicalScore: best?.score.total, elapsedMs, bestGeometryHash: best ? geometryHash(best.geometry) : null, best: best && { ...measure(best), headingDegreesPerKm: bestSource ? candidateGeometryFun(bestSource)?.headingDegreesPerKm ?? null : null, funScore: bestSource ? candidateGeometryFun(bestSource)?.funScore ?? null : null }, fastest: fastest && measure(fastest), calls: calls.map(call => ({ ...call, candidates: call.candidates.map(measure) })), diagnostics: result.diagnostics };
          if (style === "balanced" && process.env.OGV_FUN_SELECTION_BASELINE) {
            const baseline = JSON.parse(readFileSync(process.env.OGV_FUN_SELECTION_BASELINE, "utf8")) as { rows: { trip: string; style: string; best: ReturnType<typeof measure> }[] };
            const previous = baseline.rows.find(r => r.trip === trip.id && r.style === style)?.best;
            expect(previous, "Every Balanced ride needs its old Best Ride comparator").toBeDefined();
            if (previous && row.best && row.best.curvyMiles < previous.curvyMiles - 1e-8 && row.best.francoPerKm < previous.francoPerKm - 1e-8) {
              expect(row.best.minutes, "Losing both curve metrics requires at least 10% time savings").toBeLessThanOrEqual(previous.minutes * 0.9 + 1e-8);
            }
          }
          rows.push(row);
          console.log(JSON.stringify({ graph, trip: trip.id, style, best: row.best }));
          writeEvidence();
        });
      }
    }
  }
});
