import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import { analyzeBends } from "@/domain/geometry/bends";
import { analyzeFrancoCurvature } from "@/domain/geometry/franco-curvature";
import { DEFAULT_BIKE } from "@/domain/ride/create";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { planRide } from "@/server/planning/plan-service";
import { ROUTING_QUALITY_CORPUS } from "./routing-quality-corpus";

const enabled = process.env.OGV_CURVE_BENCHMARK === "1";
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

/** Same app/policy and fixed request IDs on both graphs. Fails on unavailable routers; never a green skip when enabled. */
live("og_curve graph comparison through planRide", () => {
  const rows: { graph: string; trip: string; style: string; httpAttempts: number; best: ReturnType<typeof measure> | undefined; [key: string]: unknown }[] = [];
  const graphInfo = new Map<string, { version: string; profiles: unknown; bbox: unknown; data_date: string }>();
  function writeEvidence() {
    const pairs = rows.filter(r => r.graph === "control").map(control => {
      const treatment = rows.find(r => r.graph === "og_curve" && r.trip === control.trip && r.style === control.style);
      return { trip: control.trip, style: control.style, sameHttpAttempts: treatment?.httpAttempts === control.httpAttempts,
        controlHttpAttempts: control.httpAttempts, treatmentHttpAttempts: treatment?.httpAttempts ?? null,
        delta: control.best && treatment?.best ? { minutes: treatment.best.minutes - control.best.minutes, curvyMiles: treatment.best.curvyMiles - control.best.curvyMiles, francoPerKm: treatment.best.francoPerKm - control.best.francoPerKm } : null };
    });
    if (process.env.OGV_CURVE_EVIDENCE) writeFileSync(process.env.OGV_CURVE_EVIDENCE, JSON.stringify({ schema: 2, status: "measurement-only; passing is not promotion", appBase: "3fb2b69", controlUrl: process.env.OGV_CURVE_CONTROL_URL, treatmentUrl: process.env.OGV_CURVE_TREATMENT_URL, graphInfo: Object.fromEntries(graphInfo), rows, pairs }, null, 2));
  }
  afterAll(() => { writeEvidence(); expect(rows).toHaveLength(24); });
  for (const graph of ["control", "og_curve"] as const) {
    for (const trip of trips) {
      for (const style of ["balanced", "curvy"] as const) {
        it(`${graph} / ${trip.label} / ${style}`, { timeout: 120_000 }, async () => {
          const url = graph === "control" ? process.env.OGV_CURVE_CONTROL_URL : process.env.OGV_CURVE_TREATMENT_URL;
          expect(url, "Set both powerplex router URLs explicitly").toBeTruthy();
          const info = await fetch(`${url}/info`, { signal: AbortSignal.timeout(5000) }).then(r => { expect(r.ok).toBe(true); return r.json(); });
          expect(Boolean(info.encoded_values?.og_curve), "Do not benchmark the wrong graph").toBe(graph === "og_curve");
          const identity = { version: info.version, profiles: info.profiles, bbox: info.bbox, data_date: info.data_date };
          graphInfo.set(graph, identity);
          if (graph === "og_curve") expect(identity, "Graph version, region, data date and profiles must match control").toEqual(graphInfo.get("control"));
          let httpAttempts = 0;
          const transport: { profile: string; algorithm: string; status: number }[] = [];
          const inner = createGraphHopperProvider({ baseUrl: url!, fetcher: async (input, init) => {
            httpAttempts += 1;
            const request = JSON.parse(String(init?.body ?? "{}"));
            const response = await fetch(input, init);
            transport.push({ profile: request.profile, algorithm: request.algorithm ?? "", status: response.status });
            return response;
          } });
          const calls: unknown[] = [];
          const provider: RouteCandidateProvider = {
            id: inner.id, capabilities: () => inner.capabilities(),
            async candidates(request, signal) {
              const result = await inner.candidates(request, signal);
              calls.push({ profile: request.profile, candidates: result.candidates.map(c => measure(c)) });
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
          const row = { graph, trip: trip.id, label: trip.label, style, httpAttempts, transport, canonicalScore: best?.score.total, elapsedMs: performance.now() - started, best: best && measure(best), fastest: fastest && measure(fastest), calls, diagnostics: result.diagnostics };
          rows.push(row);
          console.log(JSON.stringify({ graph, trip: trip.id, style, best: row.best }));
          writeEvidence();
        });
      }
    }
  }
});
