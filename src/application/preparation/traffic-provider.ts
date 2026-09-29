import { protectTheRideCost } from "@/application/traffic";
import type { Coordinate } from "@/domain/ride/types";
import type { TrafficResponse } from "@/infrastructure/traffic";
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

interface TrafficRouteResponse {
  readonly traffic?: unknown;
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
      const cost = protectTheRideCost(traffic, {
        routeDurationSeconds: context.rideDurationMinutes === null || context.rideDurationMinutes === undefined
          ? undefined
          : context.rideDurationMinutes * 60,
      });
      lastResult = {
        state: cost.status === "known" ? "ready" : "unavailable",
        reason: cost.status === "known" ? "Traffic matched to this route." : "Traffic is unknown.",
        provenance: traffic.provenance,
        data: {
          display: cost.label,
          ...(traffic.freshness.fetchedAt === null ? {} : { observedAt: traffic.freshness.fetchedAt }),
          ...(traffic.freshness.validUntil === null ? {} : { validUntil: traffic.freshness.validUntil }),
          freshnessLabel: traffic.freshness.status === "fresh" ? "Fresh" : "Stale",
          delayBand: cost.delayBand,
        },
      };
      return lastResult;
    },
  };
  return provider;
}
