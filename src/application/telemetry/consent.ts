/**
 * Consent gate and the honest acknowledgement model (Task 11.4;
 * 11-OFFLINE-IDENTITY-SHARING-PRIVACY §14–§15; 13-OBSERVABILITY §2).
 *
 * Telemetry is off until the rider acknowledges the disclosure. The
 * acknowledgement view model below is the product truth of that decision: it
 * must be honest about what a session replay reveals (map pixels and the map
 * viewport carry geographic context), it lists what is strictly excluded, and
 * it names no provider (VNX-007 / Rule E).
 */

/** Deployment telemetry mode (13 §2). Self-host stays off by default. */
export type TelemetryMode = "self-host" | "hosted-beta";

/**
 * The disclosure copy version. An acknowledgement is recorded against the
 * version of the copy the rider actually saw.
 */
export const TELEMETRY_CONSENT_POLICY_VERSION = 1;

export type TelemetryAcknowledgedConsentState = {
  readonly status: "acknowledged";
  readonly acknowledgedAt: string;
  readonly policyVersion: number;
};

export type TelemetryConsentState =
  | { readonly status: "unacknowledged" }
  | TelemetryAcknowledgedConsentState;

/** Builds the acknowledged state against the current copy version. */
export function acknowledgedConsentState(
  acknowledgedAt: string,
): TelemetryAcknowledgedConsentState {
  return {
    status: "acknowledged",
    acknowledgedAt,
    policyVersion: TELEMETRY_CONSENT_POLICY_VERSION,
  };
}

/**
 * The gate (11 §14): sending requires both an enabled deployment mode and an
 * acknowledgement. Self-host telemetry has no destination and is off even
 * after acknowledgement.
 */
export function telemetryGateOpen(
  mode: TelemetryMode,
  consent: TelemetryConsentState,
): boolean {
  return mode === "hosted-beta" && consent.status === "acknowledged";
}

/**
 * The rider-facing acknowledgement view model (Task 11.4; 11 §14–§15).
 * Copy rules: sentence case, no provider names (VNX-007 / Rule E).
 */
export interface TelemetryAcknowledgementCopy {
  /** The acknowledge title. */
  readonly title: string;
  /** What is collected, exactly and only. */
  readonly collectedSummary: string;
  /** What is strictly excluded (11 §14–§15). */
  readonly neverCollectedSummary: string;
  /**
   * The honest session-replay disclosure: the map is shown as-is, so map
   * pixels and the map viewport can reveal geographic context (11 §15).
   */
  readonly mapContextDisclosure: string;
  /** The gate is off until acknowledged and reversible at any time. */
  readonly offUntilAcknowledgedNote: string;
}

export const TELEMETRY_ACKNOWLEDGEMENT: TelemetryAcknowledgementCopy = {
  title: "Help improve OpenGravel with usage data",
  collectedSummary:
    "If you acknowledge this, OpenGravel records the actions you take, broad duration, distance and latency bands, error classes, capability status and the build version, plus selected autocapture and approximate location derived from your network address. It can also include a session replay that records what the screen shows.",
  neverCollectedSummary:
    "Never collected: passwords and passkey secrets, sign-in tokens, raw GPX data, recording geometry, full route geometry, imported file names, ride or account identifiers, and server secrets.",
  mapContextDisclosure:
    "A session replay shows the map exactly as you see it, so map pixels and the map viewport can reveal the geographic context of where you plan and ride. Acknowledge this only if that is acceptable.",
  offUntilAcknowledgedNote:
    "Usage data stays off until you acknowledge this, and you can turn it off again at any time.",
};
