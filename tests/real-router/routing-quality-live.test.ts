/**
 * Live motorcycle-routing quality corpus.
 *
 * This suite is not a "twisty profile must win" test. It holds a stable set of
 * real route questions and emits machine-readable measurements for every
 * profile. That gives routing experiments a reproducible baseline without
 * hard-coding subjective route-quality claims into CI.
 *
 * Run locally against the real GraphHopper:
 *
 *   npm run test:real-router -- tests/real-router/routing-quality-live.test.ts
 *
 * Every record is prefixed ROUTING_QUALITY_JSON so it can be captured into a
 * later comparison/report tool.
 */

import { describe, expect, it } from "vitest";

import type {
  ProviderCandidate,
  ProviderRouteRequest,
} from "@/application/planner/route-provider";
import {
  backroadShare,
  engineCurvature,
  engineSurfaceMix,
} from "@/application/roads/engine-road-evidence";
import { calculateGeometryOverlap } from "@/domain/geometry/analysis";
import { bendMeters } from "@/domain/geometry/bends";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";

import {
  ROUTING_QUALITY_CORPUS,
  type RoutingQualityCase,
} from "./routing-quality-corpus";

const BASE_URL = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";
const PROBE_TIMEOUT_MS = 1_500;
const METERS_PER_MILE = 1_609.344;

const PROFILES = [
  "motorcycle_fastest",
  "motorcycle_scenic",
  "motorcycle_twisty",
] as const;

async function routerIsReachable(): Promise<boolean> {
  try {
    return (
      await fetch(`${BASE_URL}/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
    ).ok;
  } catch {
    return false;
  }
}

const reachable = await routerIsReachable();
const live = reachable ? describe : describe.skip;

function requestFor(
  entry: RoutingQualityCase,
  profile: string,
): ProviderRouteRequest {
  return {
    requestId: `quality_${entry.id}_${profile}`,
    origin: entry.origin,
    destination: entry.destination,
    stops: [],
    shaping: [],
    profile,
    avoidPolygons: [],
    options: {
      includeAlternatives: false,
      avoidHighways: false,
      tollPolicy: "allow-with-warning",
      surfacePreference: "mixed",
      vehicle: "motorcycle",
      ...entry.options,
    },
  };
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function routeManeuverCount(candidate: ProviderCandidate): number {
  return (candidate.instructions ?? []).filter(
    (instruction) =>
      instruction.maneuver !== undefined &&
      instruction.maneuver !== "straight",
  ).length;
}

function shortManeuverCount(candidate: ProviderCandidate): number {
  return (candidate.instructions ?? []).filter(
    (instruction) =>
      instruction.maneuver !== undefined &&
      instruction.maneuver !== "straight" &&
      Number.isFinite(instruction.distanceMeters) &&
      instruction.distanceMeters <= 300,
  ).length;
}

function candidateReport(
  candidate: ProviderCandidate,
  surfacePreference: ProviderRouteRequest["options"]["surfacePreference"],
): Readonly<Record<string, unknown>> {
  const summary = candidate.roadSummary;
  const bends =
    summary?.bendMeters !== undefined && Number.isFinite(summary.bendMeters)
      ? Math.max(0, summary.bendMeters)
      : bendMeters(candidate.geometry);
  const backroads = summary === undefined ? null : backroadShare(summary);
  const surface =
    summary === undefined
      ? null
      : engineSurfaceMix(summary, surfacePreference ?? "mixed");
  const curvature =
    summary === undefined ? null : engineCurvature(summary);

  return {
    profile: candidate.profile,
    fingerprint: candidate.providerMetadata?.["fingerprint"] ?? null,
    distanceMiles: round(candidate.distanceMeters / METERS_PER_MILE, 2),
    durationMinutes: round(candidate.durationSeconds / 60, 1),
    geometryPoints: candidate.geometry.length,
    bendMiles: round(bends / METERS_PER_MILE, 2),
    bendShare:
      candidate.distanceMeters > 0
        ? round(bends / candidate.distanceMeters, 4)
        : null,
    curvatureUnit: curvature === null ? null : round(curvature.unit, 4),
    backroadShare: backroads === null ? null : round(backroads, 4),
    pavedShare:
      surface === null || summary === undefined || summary.totalMeters <= 0
        ? null
        : round(surface.pavedMeters / summary.totalMeters, 4),
    inferredPavedShare:
      surface === null || summary === undefined || summary.totalMeters <= 0
        ? null
        : round(surface.inferredPavedMeters / summary.totalMeters, 4),
    unpavedShare:
      surface === null || summary === undefined || summary.totalMeters <= 0
        ? null
        : round(
            (surface.gravelMeters + surface.dirtMeters) /
              summary.totalMeters,
            4,
          ),
    unknownSurfaceShare:
      surface === null || summary === undefined || summary.totalMeters <= 0
        ? null
        : round(surface.unknownMeters / summary.totalMeters, 4),
    maneuvers: routeManeuverCount(candidate),
    shortManeuvers: shortManeuverCount(candidate),
  };
}


function profileDifferential(
  candidates: readonly ProviderCandidate[],
): Readonly<Record<string, unknown>> | null {
  const fastest = candidates.find(
    (candidate) => candidate.profile === "motorcycle_fastest",
  );
  const twisty = candidates.find(
    (candidate) => candidate.profile === "motorcycle_twisty",
  );
  if (fastest === undefined || twisty === undefined) return null;

  const bendShare = (candidate: ProviderCandidate): number | null => {
    if (!Number.isFinite(candidate.distanceMeters) || candidate.distanceMeters <= 0) {
      return null;
    }
    const summary = candidate.roadSummary;
    const bends =
      summary?.bendMeters !== undefined && Number.isFinite(summary.bendMeters)
        ? Math.max(0, summary.bendMeters)
        : bendMeters(candidate.geometry);
    return bends / candidate.distanceMeters;
  };
  const curvature = (candidate: ProviderCandidate): number | null => {
    const summary = candidate.roadSummary;
    if (summary === undefined) return null;
    return engineCurvature(summary).unit;
  };
  const backroads = (candidate: ProviderCandidate): number | null => {
    const summary = candidate.roadSummary;
    return summary === undefined ? null : backroadShare(summary);
  };
  const delta = (left: number | null, right: number | null, digits = 4): number | null =>
    left === null || right === null ? null : round(left - right, digits);
  const percentDelta = (left: number, right: number): number | null =>
    right > 0 ? round((left - right) / right, 4) : null;

  return {
    comparison: "motorcycle_twisty-vs-motorcycle_fastest",
    geometryOverlap: round(
      calculateGeometryOverlap(twisty.geometry, fastest.geometry) / 100,
      4,
    ),
    sameFingerprint:
      (twisty.providerMetadata?.["fingerprint"] ?? null) ===
      (fastest.providerMetadata?.["fingerprint"] ?? null),
    distanceDeltaRatio: percentDelta(
      twisty.distanceMeters,
      fastest.distanceMeters,
    ),
    durationDeltaRatio: percentDelta(
      twisty.durationSeconds,
      fastest.durationSeconds,
    ),
    bendShareDelta: delta(bendShare(twisty), bendShare(fastest)),
    curvatureUnitDelta: delta(curvature(twisty), curvature(fastest)),
    backroadShareDelta: delta(backroads(twisty), backroads(fastest)),
  };
}

function pairwiseOverlap(
  candidates: readonly ProviderCandidate[],
): readonly Readonly<Record<string, unknown>>[] {
  const pairs: Readonly<Record<string, unknown>>[] = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const a = candidates[left];
      const b = candidates[right];
      if (a === undefined || b === undefined) continue;
      pairs.push({
        left: a.profile,
        right: b.profile,
        overlap: round(
          calculateGeometryOverlap(a.geometry, b.geometry) / 100,
          4,
        ),
      });
    }
  }
  return pairs;
}

live(`routing quality corpus (${BASE_URL})`, () => {
  for (const entry of ROUTING_QUALITY_CORPUS) {
    it(entry.label, async () => {
      const provider = createGraphHopperProvider({ baseUrl: BASE_URL });
      const answers = await Promise.all(
        PROFILES.map(async (profile) => {
          const request = requestFor(entry, profile);
          const answer = await provider.candidates(
            request,
            new AbortController().signal,
          );
          const candidate = answer.candidates[0];
          if (candidate === undefined) {
            throw new Error(
              `live router returned no candidate for ${entry.id}/${profile}`,
            );
          }
          return { request, candidate };
        }),
      );

      const candidates = answers.map((answer) => answer.candidate);
      for (const candidate of candidates) {
        expect(candidate.geometry.length).toBeGreaterThanOrEqual(2);
        expect(candidate.distanceMeters).toBeGreaterThan(0);
        expect(candidate.durationSeconds).toBeGreaterThan(0);
      }

      const report = {
        schemaVersion: 1,
        caseId: entry.id,
        label: entry.label,
        tests: entry.tests,
        providerCalls: PROFILES.length,
        profiles: answers.map(({ request, candidate }) =>
          candidateReport(candidate, request.options.surfacePreference),
        ),
        pairwiseOverlap: pairwiseOverlap(candidates),
        twistyVsFastest: profileDifferential(candidates),
      };

      console.log(`ROUTING_QUALITY_JSON ${JSON.stringify(report)}`);
    });
  }
});
