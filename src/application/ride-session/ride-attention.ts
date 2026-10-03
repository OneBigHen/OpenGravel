/**
 * Cross-platform attention envelope for in-motion navigation.
 *
 * This module does not render UI and does not schedule speech. It reduces the
 * current riding situation into one deterministic attention state that phone,
 * native iOS and future CarPlay surfaces can all consume.
 *
 * The intent is progressive disclosure:
 * - calm: keep chrome quiet;
 * - prepare: make the next maneuver easier to acquire at a glance;
 * - imminent: prioritize only the immediate decision;
 * - recovery: route/GPS recovery outranks ordinary guidance;
 * - critical: a blocking/current warning outranks everything else.
 *
 * Thresholds are experiment policy, not safety claims. They should be tuned
 * against ride tests and workload data rather than silently changed by a UI.
 */

export type RideAttentionMode =
  | "calm"
  | "prepare"
  | "imminent"
  | "recovery"
  | "critical";

export type RideAttentionDensity = "minimal" | "reduced" | "normal";

export interface RideAttentionInput {
  readonly moving: boolean;
  readonly speedMps: number | null;
  readonly maneuverDistanceMeters: number | null;
  readonly recoveryActive?: boolean;
  readonly criticalWarningActive?: boolean;
  /**
   * Free Ride opportunity distance. It never outranks an ordinary maneuver
   * unless no maneuver is currently in its prepare window.
   */
  readonly opportunityDistanceMeters?: number | null;
}

export interface RideAttentionEnvelope {
  readonly mode: RideAttentionMode;
  /**
   * Estimated seconds to the currently prioritized decision, when speed and
   * distance make that estimate meaningful.
   */
  readonly secondsToDecision: number | null;
  readonly prioritizedDecision: "maneuver" | "opportunity" | "recovery" | "warning" | "none";
  /** Suggested information density for map labels/secondary chrome. */
  readonly mapDensity: RideAttentionDensity;
  /** Whether the three-stat strip should remain visually primary. */
  readonly emphasizeMetrics: boolean;
  /** Whether secondary route progress/ETA should be visually primary. */
  readonly emphasizeSecondary: boolean;
  /** Whether the maneuver/opportunity card should receive primary emphasis. */
  readonly emphasizeDecision: boolean;
}

const PREPARE_SECONDS = 15;
const IMMINENT_SECONDS = 6;
const MIN_ESTIMATE_SPEED_MPS = 3;
const FALLBACK_PREPARE_METERS = 250;
const FALLBACK_IMMINENT_METERS = 80;

function usableDistance(value: number | null | undefined): number | null {
  return value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function usableSpeed(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function secondsTo(
  distanceMeters: number | null,
  speedMps: number | null,
): number | null {
  if (distanceMeters === null) return null;
  if (speedMps === null || speedMps < MIN_ESTIMATE_SPEED_MPS) return null;
  return distanceMeters / speedMps;
}

function decisionBand(
  distanceMeters: number | null,
  seconds: number | null,
): "calm" | "prepare" | "imminent" {
  if (distanceMeters === null) return "calm";

  if (seconds !== null) {
    if (seconds <= IMMINENT_SECONDS) return "imminent";
    if (seconds <= PREPARE_SECONDS) return "prepare";
    return "calm";
  }

  // When speed is unavailable/too low, use conservative distance-only bands
  // rather than inventing a time-to-turn.
  if (distanceMeters <= FALLBACK_IMMINENT_METERS) return "imminent";
  if (distanceMeters <= FALLBACK_PREPARE_METERS) return "prepare";
  return "calm";
}

function envelopeForDecision(
  mode: "calm" | "prepare" | "imminent",
  prioritizedDecision: "maneuver" | "opportunity" | "none",
  secondsToDecision: number | null,
): RideAttentionEnvelope {
  switch (mode) {
    case "imminent":
      return {
        mode,
        secondsToDecision,
        prioritizedDecision,
        mapDensity: "minimal",
        emphasizeMetrics: false,
        emphasizeSecondary: false,
        emphasizeDecision: true,
      };
    case "prepare":
      return {
        mode,
        secondsToDecision,
        prioritizedDecision,
        mapDensity: "reduced",
        emphasizeMetrics: false,
        emphasizeSecondary: true,
        emphasizeDecision: true,
      };
    case "calm":
      return {
        mode,
        secondsToDecision,
        prioritizedDecision,
        mapDensity: "normal",
        emphasizeMetrics: true,
        emphasizeSecondary: true,
        emphasizeDecision: false,
      };
  }
}

/**
 * Derives one shared attention state.
 *
 * Priority:
 * critical warning > recovery > maneuver > optional Free Ride opportunity.
 *
 * A Free Ride opportunity is deliberately prevented from competing with an
 * imminent/prepare maneuver. If normal guidance needs the rider's attention,
 * the optional opportunity can wait or expire.
 */
export function deriveRideAttentionEnvelope(
  input: RideAttentionInput,
): RideAttentionEnvelope {
  if (input.criticalWarningActive === true) {
    return {
      mode: "critical",
      secondsToDecision: null,
      prioritizedDecision: "warning",
      mapDensity: "minimal",
      emphasizeMetrics: false,
      emphasizeSecondary: false,
      emphasizeDecision: true,
    };
  }

  if (input.recoveryActive === true) {
    return {
      mode: "recovery",
      secondsToDecision: null,
      prioritizedDecision: "recovery",
      mapDensity: "reduced",
      emphasizeMetrics: false,
      emphasizeSecondary: false,
      emphasizeDecision: true,
    };
  }

  if (!input.moving) {
    return {
      mode: "calm",
      secondsToDecision: null,
      prioritizedDecision: "none",
      mapDensity: "normal",
      emphasizeMetrics: true,
      emphasizeSecondary: true,
      emphasizeDecision: false,
    };
  }

  const speed = usableSpeed(input.speedMps);
  const maneuverDistance = usableDistance(input.maneuverDistanceMeters);
  const maneuverSeconds = secondsTo(maneuverDistance, speed);
  const maneuverBand = decisionBand(maneuverDistance, maneuverSeconds);

  if (maneuverBand !== "calm") {
    return envelopeForDecision(
      maneuverBand,
      "maneuver",
      maneuverSeconds,
    );
  }

  const opportunityDistance = usableDistance(
    input.opportunityDistanceMeters,
  );
  const opportunitySeconds = secondsTo(opportunityDistance, speed);
  const opportunityBand = decisionBand(
    opportunityDistance,
    opportunitySeconds,
  );

  if (opportunityBand !== "calm") {
    return envelopeForDecision(
      opportunityBand,
      "opportunity",
      opportunitySeconds,
    );
  }

  return envelopeForDecision("calm", "none", null);
}
