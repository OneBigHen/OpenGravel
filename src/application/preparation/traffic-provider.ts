import { protectTheRideCost } from "@/application/traffic";
import type { Coordinate } from "@/domain/ride/types";
import type { TrafficResponse, TrafficSegment } from "@/infrastructure/traffic";
import type { RoutePreparationContext } from "./prepare-route";
import type {
  ProviderCapability,
  ProviderResult,
  TrafficData,
  TrafficProvider,
} from "./providers";

/**
 * What the rider is told about the traffic source.
 *
 * The provider's identity stays diagnostics-only (OGV-D-151): a rider deciding
 * whether to trust a delay needs the *kind* of evidence, not a vendor name
 * (VNX-007 / Rule E).
 */
const LIVE_TRAFFIC_PROVENANCE = "Live traffic feed";

const TRAFFIC_PATH = "/api/route-traffic";

/**
 * The answer only speaks for the segments the corridor match assigned to this
 * route. Below this share it says too little to stand as an answer at all, and
 * above it the rider is told how much of the route was actually checked.
 */
export const MIN_TRAFFIC_COVERAGE_RATIO = 0.25;

const PARTIAL_COVERAGE_REASON = "Traffic was checked for only part of this route.";
const PARTIAL_COVERAGE_NOTE = "Traffic was checked for part of this route; the rest is unknown.";
const PARTIAL_COVERAGE_NOTE_SHORT = "part of route checked";

interface TrafficRouteResponse {
  readonly traffic?: unknown;
  readonly corridorMatch?: unknown;
}

/** What the server's corridor match proved about this answer. */
interface TrafficCoverage {
  readonly coverageRatio: number;
  readonly matchedTrafficSegmentIds: readonly string[];
}

export interface TomTomTrafficPreparationProviderOptions {
  readonly fetcher?: typeof fetch;
  readonly path?: string;
}

function unavailable(reason: string): ProviderResult<TrafficData> {
  return { state: "unavailable", reason, provenance: LIVE_TRAFFIC_PROVENANCE };
}

function isTrafficResponse(value: unknown): value is TrafficResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const reasonValid = candidate["reason"] === null || typeof candidate["reason"] === "string";
  return (candidate["availability"] === "available" || candidate["availability"] === "unavailable")
    && Array.isArray(candidate["segments"])
    && typeof candidate["label"] === "string"
    && reasonValid;
}

function corridorFrom(context: RoutePreparationContext): readonly Coordinate[] | null {
  const corridor = context.trafficCorridor;
  return corridor !== undefined && corridor.length >= 2 ? corridor : null;
}

/** An unreadable match means the coverage claim cannot be checked. */
function coverageFrom(value: unknown): TrafficCoverage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const ratio = candidate["coverageRatio"];
  const ids = candidate["matchedTrafficSegmentIds"];
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) return null;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
  return { coverageRatio: ratio, matchedTrafficSegmentIds: ids };
}

/**
 * Only the provider segments the corridor match assigned to this route count,
 * each once: an unmatched or repeated segment must not add delay the route was
 * never shown to carry.
 */
function matchedSegments(
  traffic: TrafficResponse,
  coverage: TrafficCoverage,
): readonly TrafficSegment[] | null {
  const matched = new Set(coverage.matchedTrafficSegmentIds);
  const seen = new Set<string>();
  const segments = traffic.segments.filter((segment) => {
    if (!matched.has(segment.id) || seen.has(segment.id)) return false;
    seen.add(segment.id);
    return true;
  });
  return segments.length === 0 ? null : segments;
}

export interface TomTomTrafficPreparationProvider extends TrafficProvider {
  readonly refresh: (context: RoutePreparationContext) => Promise<ProviderResult<TrafficData>>;
}

export function createTomTomTrafficPreparationProvider(
  options: TomTomTrafficPreparationProviderOptions = {},
): TomTomTrafficPreparationProvider {
  const fetcher = options.fetcher ?? fetch;
  const path = options.path ?? TRAFFIC_PATH;
  let lastResult: ProviderResult<TrafficData> | null = null;

  const capability = (): ProviderCapability => ({
    kind: "traffic",
    availability: lastResult?.state === "stale"
      ? "degraded"
      : lastResult?.state === "unavailable" ? "unavailable" : "available",
    freshness: "time-bound",
    reason: lastResult?.state === "unavailable" ? lastResult.reason : null,
    provenance: LIVE_TRAFFIC_PROVENANCE,
  });

  const provider: TomTomTrafficPreparationProvider = {
    id: "traffic-tomtom",
    kind: "traffic",
    capabilities: capability,
    getTraffic: () => lastResult ?? unavailable("Traffic unknown until the route is checked."),
    async refresh(context): Promise<ProviderResult<TrafficData>> {
      const corridor = corridorFrom(context);
      if (corridor === null) {
        lastResult = unavailable("Traffic needs a route corridor.");
        return lastResult;
      }
      const departureTime = context.departure ?? new Date().toISOString();
      let response: Response;
      try {
        response = await fetcher(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            corridor,
            departureTime,
            ...(context.trafficWaypoints === undefined ? {} : { waypoints: context.trafficWaypoints }),
          }),
        });
      } catch {
        lastResult = unavailable("Traffic is unavailable right now.");
        return lastResult;
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        lastResult = unavailable("Traffic returned an unreadable response.");
        return lastResult;
      }
      if (!response.ok) {
        lastResult = unavailable("Traffic is unavailable right now.");
        return lastResult;
      }
      const traffic = typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as TrafficRouteResponse).traffic
        : undefined;
      if (!isTrafficResponse(traffic)) {
        lastResult = unavailable("Traffic returned an unreadable response.");
        return lastResult;
      }
      if (traffic.availability !== "available") {
        lastResult = unavailable(traffic.reason ?? "Traffic is unknown.");
        return lastResult;
      }
      const coverage = coverageFrom(typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as TrafficRouteResponse).corridorMatch
        : undefined);
      const matched = coverage === null ? null : matchedSegments(traffic, coverage);
      if (coverage === null || matched === null) {
        // Without a verifiable match the answer describes some other stretch of
        // road; presenting it as this route's traffic would be a clear claim.
        lastResult = unavailable(PARTIAL_COVERAGE_REASON);
        return lastResult;
      }
      const partialCoverage = coverage.coverageRatio < 1;
      const cost = protectTheRideCost({ ...traffic, segments: matched }, {
        routeDurationSeconds: context.rideDurationMinutes === null || context.rideDurationMinutes === undefined
          ? undefined
          : context.rideDurationMinutes * 60,
      });
      const observation = {
        ...(traffic.freshness.fetchedAt === null ? {} : { observedAt: traffic.freshness.fetchedAt }),
        ...(traffic.freshness.validUntil === null ? {} : { validUntil: traffic.freshness.validUntil }),
        freshnessLabel: traffic.freshness.status === "fresh" ? "Fresh" as const : "Stale" as const,
        coverageRatio: coverage.coverageRatio,
      };
      if (cost.closed) {
        // A closure is a route fact worth a row of its own, not an unavailable
        // provider and never a zero-delay all-clear. It outranks coverage: a
        // shut road is worth knowing about even when only part was checked.
        lastResult = {
          state: "ready",
          reason: partialCoverage
            ? `A traffic source reports a closure on this route; check before you ride. ${PARTIAL_COVERAGE_NOTE}`
            : "A traffic source reports a closure on this route; check before you ride.",
          provenance: traffic.provenance,
          data: { display: cost.label, ...observation, roadClosure: true, delayBand: null },
        };
        return lastResult;
      }
      if (coverage.coverageRatio < MIN_TRAFFIC_COVERAGE_RATIO) {
        lastResult = unavailable(PARTIAL_COVERAGE_REASON);
        return lastResult;
      }
      const known = cost.status === "known";
      lastResult = {
        state: known ? "ready" : "unavailable",
        reason: known
          ? partialCoverage ? PARTIAL_COVERAGE_NOTE : "Traffic matched to this route."
          : "Traffic is unknown.",
        provenance: traffic.provenance,
        data: {
          display: known && partialCoverage ? `${cost.label} · ${PARTIAL_COVERAGE_NOTE_SHORT}` : cost.label,
          ...observation,
          delayBand: cost.delayBand,
        },
      };
      return lastResult;
    },
  };
  return provider;
}
