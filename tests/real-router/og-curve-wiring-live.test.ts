import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import { analyzeBends } from "@/domain/geometry/bends";
import { analyzeFrancoCurvature } from "@/domain/geometry/franco-curvature";
import { haversine } from "@/domain/geometry/analysis";
import { DEFAULT_BIKE } from "@/domain/ride/create";
import type { Coordinate } from "@/domain/ride/types";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { planRide } from "@/server/planning/plan-service";

const live = process.env.OGV_CURVE_WIRING === "1" ? describe : describe.skip;
const urls = { control: "http://127.0.0.1:8989", og_curve: "http://127.0.0.1:8991" };
const origin = { lon: -75.7387, lat: 40.8636 };
function hash(line: readonly Coordinate[]) { return createHash("sha256").update(JSON.stringify(line.map(p => [p.lon, p.lat]))).digest("hex"); }
function measure(line: readonly Coordinate[], seconds: number) {
  return { geometrySha256: hash(line), minutes: seconds / 60, curvyMiles: analyzeBends(line).bendMeters / 1609.344, francoPerKm: analyzeFrancoCurvature(line).curvaturePerKm };
}
interface WireBody { profile: string; points: number[][]; details?: string[]; custom_model?: { priority?: unknown[]; [key: string]: unknown }; [key: string]: unknown }
interface GhPath { debug_info?: string; points: { coordinates: [number, number][] }; time: number; weight: number; details: Record<string, [number, number, number][]> }

/** Opt-in powerplex diagnostic. Captures the real app wire, direct replays and selected-route provenance. */
live("og_curve request/edge/selection wiring", () => {
  it("traces Jim Thorpe, replays exact Twisty requests, and exercises strong penalties", { timeout: 180_000 }, async () => {
    const plans = [];
    let twisty: WireBody | undefined;
    for (const graph of ["control", "og_curve"] as const) for (const style of ["balanced", "curvy"] as const) for (const loop of [false, true]) {
      const wire: WireBody[] = [];
      const pool: { profile: string; geometrySha256: string; minutes: number; curvyMiles: number; francoPerKm: number }[] = [];
      const inner = createGraphHopperProvider({ baseUrl: urls[graph], fetcher: async (input, init) => {
        wire.push(JSON.parse(String(init?.body)));
        return fetch(input, init);
      } });
      const provider: RouteCandidateProvider = { id: inner.id, capabilities: () => inner.capabilities(), async candidates(request, signal) {
        const result = await inner.candidates(request, signal);
        pool.push(...result.candidates.map(c => ({ profile: c.profile, ...measure(c.geometry, c.durationSeconds) })));
        return result;
      } };
      const request: ProviderRouteRequest = {
        requestId: loop ? "fun-best-loop-120" : "fun-best-destination", origin,
        destination: loop ? origin : { lon: -75.9832, lat: 40.6364 }, stops: [], shaping: [], avoidPolygons: [],
        profile: style === "curvy" ? "motorcycle_twisty" : "motorcycle_fastest",
        options: { includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", surfacePreference: "mixed", roadCharacter: style, traffic: "protect-ride", vehicle: "motorcycle", bike: DEFAULT_BIKE },
        ...(loop ? { discovery: { targetMinutes: 120, toleranceMinutes: 15 } } : {}),
      };
      const result = await planRide({ identity: { rideId: "og-curve", rideRevision: 1, planningGeneration: 1 }, request }, { provider, env: {}, roadAuthority: null, funCharacterClassifier: null });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      const best = result.bundle.candidates.find(c => c.id === result.bundle.roles["best-ride"]);
      expect(best).toBeDefined();
      const bestHash = hash(best!.geometry);
      const record = { graph, style, loop, best: measure(best!.geometry, best!.durationSeconds), matchingSourceProfiles: [...new Set(pool.filter(c => c.geometrySha256 === bestHash && Math.abs(c.minutes - best!.durationSeconds / 60) < .001).map(c => c.profile))], wire, pool };
      plans.push(record);
      if (graph === "control" && style === "balanced" && !loop) twisty = wire.find(b => b.profile === "motorcycle_twisty");
      console.log("PLAN", JSON.stringify({ ...record, wire: wire.map(b => ({ profile: b.profile, algorithm: b.algorithm, chDisable: b["ch.disable"], lmDisable: b["lm.disable"] })), pool: undefined }));
    }
    expect(twisty).toBeDefined();
    expect(twisty!.points).toEqual([[-75.7387, 40.8636], [-75.9832, 40.6364]]);
    async function direct(graph: keyof typeof urls, body: WireBody) {
      const response = await fetch(`${urls[graph]}/route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      const data = await response.json();
      expect(response.ok, JSON.stringify(data)).toBe(true);
      const path = data.paths[0] as GhPath;
      const line = path.points.coordinates.map(([lon, lat]) => ({ lon, lat }));
      return { path, line, summary: { ...measure(line, path.time / 1000), weight: path.weight, debugInfo: data.info, debug: path.debug_info } };
    }
    const initialTwisty = plans.filter(p => !p.loop).map(p => p.wire.find(b => b.profile === "motorcycle_twisty"));
    for (const body of initialTwisty) expect(body, "Both app modes and graphs send the same initial Twisty wire").toEqual(twisty);
    const control = await direct("control", twisty!);
    const treatmentBody = { ...twisty!, details: [...new Set([...(twisty!.details ?? []), "og_curve"])] };
    const exactTreatment = await direct("og_curve", twisty!);
    const treatment = await direct("og_curve", treatmentBody);
    expect(treatment.summary.geometrySha256).toBe(exactTreatment.summary.geometrySha256);
    expect(treatment.summary.weight).toBe(exactTreatment.summary.weight);
    const details = treatment.path.details.og_curve;
    expect(details).toBeDefined();
    if (!details) throw new Error("Missing og_curve path details");
    const nonzero = details.filter(d => d[2] > 0).map(([from, to, value]) => ({ from, to, value,
      meters: treatment.line.slice(from, to).reduce((sum, p, i) => sum + haversine(p, treatment.line[from + i + 1]!), 0),
      start: treatment.line[from], end: treatment.line[to] }));
    expect(nonzero.length).toBeGreaterThan(0);
    const probes = [];
    for (const threshold of [.001, .15, .4]) {
      const rule = { if: `og_curve < ${threshold}`, multiply_by: "0.01" };
      const body = { ...treatmentBody, custom_model: { ...twisty!.custom_model, priority: [...(twisty!.custom_model?.priority ?? []), rule] } };
      const answer = await direct("og_curve", body);
      probes.push({ rule, ...answer.summary, changedGeometry: answer.summary.geometrySha256 !== treatment.summary.geometrySha256 });
    }
    expect(probes.some(p => p.changedGeometry)).toBe(true);
    expect(probes.every(p => p.weight !== treatment.summary.weight)).toBe(true);
    // Returning an error on the old graph proves these expressions cannot be silently ignored.
    const unsupported = await fetch(`${urls.control}/route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...twisty!, custom_model: { ...twisty!.custom_model, priority: [...(twisty!.custom_model?.priority ?? []), { if: "og_curve < 0.15", multiply_by: "0.01" }] } }), signal: AbortSignal.timeout(30_000) });
    expect(unsupported.ok).toBe(false);
    const unsupportedError = await unsupported.json();
    expect(JSON.stringify(unsupportedError)).toContain("og_curve");
    const planEvidence = plans.map(({ wire, ...plan }) => ({ ...plan, wire: wire.map(body => ({ profile: body.profile, algorithm: body.algorithm ?? null, chDisable: body["ch.disable"] ?? null, lmDisable: body["lm.disable"] ?? null, bodySha256: createHash("sha256").update(JSON.stringify(body)).digest("hex") })) }));
    const report = { schema: 1, plans: planEvidence, appTwistyWire: twisty, directControl: control.summary, directTreatment: exactTreatment.summary, pathDetailsDoNotChangeRoute: true, ogCurveDetails: details, nonzeroIntervals: nonzero, nonzeroMeters: nonzero.reduce((sum, x) => sum + x.meters, 0), probes, controlOgCurveExpressionStatus: unsupported.status, controlOgCurveExpressionError: unsupportedError };
    console.log("DIRECT", JSON.stringify({ ...report, plans: undefined, ogCurveDetails: undefined, nonzeroIntervals: undefined }));
    if (process.env.OGV_CURVE_WIRING_EVIDENCE) writeFileSync(process.env.OGV_CURVE_WIRING_EVIDENCE, JSON.stringify(report, null, 2));
  });
});
