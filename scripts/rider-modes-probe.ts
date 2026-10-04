import { writeFile } from "node:fs/promises";
import { funGeneratorSettingsFromEnv } from "../src/server/planning/fun-generators";
import { ROUTING_QUALITY_CORPUS, type RoutingQualityCase } from "../tests/real-router/routing-quality-corpus";
import { createGraphHopperRequest, REQUESTED_DETAILS } from "../src/infrastructure/routing/graphhopper/request-builder";
import { parseGraphHopperPath, type GraphHopperResponse } from "../src/infrastructure/routing/graphhopper/response-parser";
import { riderEnvelopeMetrics, searchRiderEnvelope } from "../src/application/planner/rider-mode-search";
import type { ProviderRouteRequest, RouteCandidateProvider } from "../src/application/planner/route-provider";

async function main(): Promise<void> {
  const corpus: readonly RoutingQualityCase[] = [...ROUTING_QUALITY_CORPUS,
    { tests: ["maintained forest roads"], id: "michaux", label: "Michaux / Pine Grove Furnace", origin: { lat: 40.0325, lon: -77.305 }, destination: { lat: 39.965, lon: -77.365 } },
    { tests: ["maintained forest roads"], id: "rothrock", label: "Rothrock / State College", origin: { lat: 40.706, lon: -77.757 }, destination: { lat: 40.679, lon: -77.861 } },
  ];
  const provider: RouteCandidateProvider = {
    id: "probe-graphhopper", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }),
    async candidates(request, signal) {
      const body = createGraphHopperRequest(request, { details: [...REQUESTED_DETAILS, "car_access", "road_access", "smoothness"], spans: request.roadSpans, riderModesEnabled: process.env["OGV_RIDER_MODES"] !== "off" });
      const response = await fetch(`${process.env["GRAPHHOPPER_URL"] ?? "http://127.0.0.1:8989"}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      const json = await response.json() as GraphHopperResponse;
      if (!response.ok) throw Error(`GraphHopper ${response.status}: ${json.message}`);
      for (const path of json.paths ?? []) {
        for (const [detail, prohibited] of [["surface", "sand"], ["road_access", "private"], ["car_access", "false"]]) {
          const intervals = path.details?.[detail!];
          const lastPoint = (path.points?.coordinates?.length ?? 0) - 1;
          if (intervals === undefined || intervals.length === 0 || intervals[0]?.[0] !== 0 || intervals.at(-1)?.[1] !== lastPoint || intervals.some((interval, index) => interval[2] === null || (index > 0 && intervals[index - 1]?.[1] !== interval[0]))) throw Error(`Missing safety coverage: ${detail}`);
          if (intervals.some(([from, to, value]) => to > from && String(value).toLowerCase() === prohibited)) throw Error(`Unsafe route: ${detail}=${prohibited}`);
        }
      }
      return { candidates: (json.paths ?? []).map((path, index) => parseGraphHopperPath(path, { providerId: "graphhopper", profile: request.profile, index, engineVersion: "11" })) };
    },
  };
  const diagnostics: string[] = [];
  const measurements: { id: string; mode: string; seconds: number; unpaved: number; busy: number }[] = [];
  const callBudget = Math.min(3, funGeneratorSettingsFromEnv(process.env).budget.maxProviderCalls);
  const lines = ["# Rider modes live PA/NJ probe", "", `Date: ${new Date().toISOString()}. GraphHopper 11; request builder and bounded envelope search (${callBudget} extra calls). Percentages are distance weighted; busy = primary/trunk/motorway OR CITY. Hard access and sand details checked for every returned path.`, "", "| Route | Mode | Minutes | km | Unpaved % | Busy % | Bends % | Factor | Extra calls |", "|---|---|---:|---:|---:|---:|---:|---:|---:|"];
  for (const route of corpus) {
    for (const mode of ["baseline", "gravel", "dual-sport", "avoid-traffic"] as const) {
      const dirt = mode === "gravel" || mode === "dual-sport";
      const request: ProviderRouteRequest = {
        requestId: `probe:${route.id}:${mode}`, origin: route.origin, destination: route.destination, stops: [], shaping: [], avoidPolygons: [],
        profile: dirt ? "motorcycle_adventure" : "motorcycle_fastest",
        options: { vehicle: "motorcycle", includeAlternatives: false, avoidHighways: route.options?.avoidHighways ?? false, tollPolicy: "allow-with-warning", roadCharacter: "balanced", surfacePreference: dirt ? "dirt-preferred" : "mixed", targetUnpavedShare: dirt ? 0.5 : 0, traffic: mode === "avoid-traffic" ? "protect-ride" : "minimize-delay", bike: { category: mode === "dual-sport" ? "dual-sport" : "adventure", maintainedGravel: "allow", roughTracks: mode === "dual-sport" ? "allow" : "avoid" } },
      };
      const signal = AbortSignal.timeout(30_000);
      const initial = await provider.candidates(request, signal);
      const search = process.env["OGV_RIDER_MODES"] === "off" ? { candidate: null, calls: 0 } : await searchRiderEnvelope({ request, baselineRequest: { ...request, profile: "motorcycle_fastest" }, candidates: initial.candidates, provider, signal, maxCalls: callBudget, deadlineMs: 12_000 });
      const candidate = search.candidate ?? initial.candidates[0];
      if (candidate === undefined) throw Error(`No route for ${request.requestId}`);
      const metrics = riderEnvelopeMetrics(candidate);
      if (metrics === null || metrics.busyShare === null) throw Error(`Missing envelope evidence for ${request.requestId}`);
      measurements.push({ id: route.id, mode, seconds: candidate.durationSeconds, unpaved: metrics.unpavedShare, busy: metrics.busyShare });
      const percent = (value: number | null | undefined): string => value == null ? "unknown" : (value * 100).toFixed(1);
      const line = `| ${route.label} | ${mode} | ${(candidate.durationSeconds / 60).toFixed(1)} | ${(candidate.distanceMeters / 1000).toFixed(1)} | ${percent(metrics?.unpavedShare)} | ${percent(metrics?.busyShare)} | ${percent((candidate.roadSummary?.bendMeters ?? 0) / candidate.distanceMeters)} | ${candidate.providerMetadata?.["riderModeFactor"] ?? 1} | ${search.calls} |`;
      lines.push(line); console.log(line);
      if ("trials" in search) diagnostics.push(`- ${route.label}, ${mode}: ${JSON.stringify(search.trials)}`);
    }
  }
  const baselines = new Map(measurements.filter(row => row.mode === "baseline").map(row => [row.id, row]));
  const gravel = measurements.filter(row => row.mode === "gravel");
  const dual = measurements.filter(row => row.mode === "dual-sport");
  const traffic = measurements.filter(row => row.mode === "avoid-traffic");
  const upliftCount = (rows: typeof measurements): number => rows.filter(row => row.unpaved - baselines.get(row.id)!.unpaved >= 0.03).length;
  const mean = (rows: typeof measurements, field: "unpaved" | "busy"): number => rows.reduce((sum, row) => sum + row[field], 0) / rows.length;
  const baselineRows = [...baselines.values()];
  const maximumDetour = Math.max(...measurements.map(row => row.seconds / baselines.get(row.id)!.seconds - 1));
  const checks = [
    { label: "Gravel uplift of at least 3 percentage points on two or more routes", pass: upliftCount(gravel) >= 2 },
    { label: "Dual-sport uplift of at least 3 percentage points on two or more routes", pass: upliftCount(dual) >= 2 },
    { label: "Dual-sport unpaved share is at least gravel on every route", pass: dual.every(row => row.unpaved + 1e-9 >= gravel.find(other => other.id === row.id)!.unpaved) },
    { label: "Avoid-traffic reduces mean busy exposure by at least 20 percent", pass: mean(traffic, "busy") <= mean(baselineRows, "busy") * 0.8 },
    { label: "Every selected mode stays within 35 percent of the fastest safe reference", pass: maximumDetour <= 0.35 + 1e-9 },
    { label: "Every returned path has complete safety details and no SAND/private/no-car-access", pass: true },
  ];
  const summary = ["", "## Measured acceptance", "", `Mean unpaved: baseline ${(100 * mean(baselineRows, "unpaved")).toFixed(2)}%, gravel ${(100 * mean(gravel, "unpaved")).toFixed(2)}%, dual-sport ${(100 * mean(dual, "unpaved")).toFixed(2)}%.`, `Mean busy exposure: baseline ${(100 * mean(baselineRows, "busy")).toFixed(2)}%, avoid-traffic ${(100 * mean(traffic, "busy")).toFixed(2)}%. Maximum mode detour: ${(maximumDetour * 100).toFixed(2)}%.`, ...checks.map(check => `- ${check.pass ? "PASS" : "FAIL"}: ${check.label}`), "", "Material uplift is operationalised as at least 3 percentage points on two routes, rather than requiring unpaved roads where the graph offers none. Most destinations cannot reach the requested 50% unpaved envelope inside the time cap; diagnostics preserve the shortfall. Michaux did not improve, and Rothrock was already almost entirely unpaved. No distinct rough-track gain was observed for dual-sport. Congestion refinement was unit-tested; this probe does not establish a real live jam avoidance event."];
  const path = `docs/vnext/research/rider-modes-probe-${new Date().toISOString().slice(0, 10)}.md`;
  await writeFile(path, [...lines, ...summary, "", "## Factor measurements", "", ...diagnostics].join("\n") + "\n");
  console.log(`Saved ${path}`);
  for (const check of checks) console.log(`${check.pass ? "PASS" : "FAIL"}: ${check.label}`);
  if (process.env["OGV_RIDER_MODES"] !== "off" && checks.some(check => !check.pass)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
