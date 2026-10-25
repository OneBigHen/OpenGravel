import type { EvidenceStatus } from "@/domain/evidence/types";
import type { TrafficResponse } from "@/infrastructure/traffic";

export interface TrafficDelayBand {
  readonly minMinutes: number;
  readonly maxMinutes: number;
}

export interface ProtectTheRideTrafficCost {
  readonly status: Extract<EvidenceStatus, "known" | "unknown">;
  /**
   * A matched segment was reported closed. A closure is a fact about the road,
   * not a delay, so it never becomes a zero band or an all-clear.
   */
  readonly closed: boolean;
  readonly applied: boolean;
  /** Null means the existing no-traffic cost remains in force. */
  readonly normalizedCost: number | null;
  readonly delayBand: TrafficDelayBand | null;
  readonly label: string;
  readonly explanationKey: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Converts fresh, departure-applicable traffic into a conservative band. The
 * exact provider delay is not shown as an exact rider promise: confidence
 * widens the band, and the score uses its upper edge for Protect the Ride.
 */
export function protectTheRideCost(
  response: TrafficResponse,
  options: { readonly routeDurationSeconds?: number } = {},
): ProtectTheRideTrafficCost {
  const delayEstimateCount = response.segments.filter((segment) => segment.delaySeconds !== null).length;
  const hasSegments = response.availability === "available" && response.segments.length > 0;
  const usable = hasSegments
    && response.departureApplicability === "current"
    && response.freshness.status === "fresh"
    && delayEstimateCount > 0;

  // A provider closure outranks delay arithmetic and freshness: a road that is
  // reported shut does not become clear when the reading ages, and the traffic
  // term must not improve the route's score.
  const closed = hasSegments && response.segments.some(
    (segment) => segment.roadClosure === true || segment.speedClass === "closed",
  );
  if (closed) {
    return {
      status: "unknown",
      closed: true,
      applied: false,
      normalizedCost: null,
      delayBand: null,
      label: "Road closure reported",
      explanationKey: "score.traffic.closure",
    };
  }

  if (!usable) {
    return {
      status: "unknown",
      closed: false,
      applied: false,
      normalizedCost: null,
      delayBand: null,
      label: "Traffic unknown",
      explanationKey: "score.traffic.no-evidence",
    };
  }

  const delaySeconds = response.segments.reduce(
    (total, segment) => total + (segment.delaySeconds === null ? 0 : Math.max(0, segment.delaySeconds)),
    0,
  );
  const confidence = response.segments.reduce((lowest, segment) =>
    segment.confidence === null ? 0 : Math.min(lowest, segment.confidence), 1);
  const uncertaintySeconds = delaySeconds * (1 - confidence);
  const minMinutes = Math.max(0, Math.floor((delaySeconds - uncertaintySeconds) / 60));
  const maxMinutes = Math.max(minMinutes, Math.ceil((delaySeconds + uncertaintySeconds) / 60));
  const routeDurationSeconds = options.routeDurationSeconds ?? 3_600;
  const normalizedCost = clamp((maxMinutes * 60) / Math.max(60, routeDurationSeconds), 0, 1);
  return {
    status: "known",
    closed: false,
    applied: true,
    normalizedCost,
    delayBand: { minMinutes, maxMinutes },
    label: trafficBandLabel(minMinutes, maxMinutes),
    explanationKey: "score.traffic.protect-the-ride-band",
  };
}

/**
 * The rider's words for a delay band (M4, OGV-D-266): `No traffic delays`,
 * `+4 min in traffic`, `+3–7 min in traffic`. The band already carries the
 * uncertainty, so the copy no longer says "uncertain" about a zero.
 */
export function trafficBandLabel(minMinutes: number, maxMinutes: number): string {
  if (maxMinutes <= 0) return "No traffic delays";
  if (minMinutes === maxMinutes) return `+${maxMinutes} min in traffic`;
  return `+${minMinutes}–${maxMinutes} min in traffic`;
}

export const buildProtectTheRideCost = protectTheRideCost;
