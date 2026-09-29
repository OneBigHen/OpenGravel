/**
 * Telemetry deployment configuration (Task 11.4; 13-OBSERVABILITY §2).
 *
 * Fail closed by construction: only an explicit hosted-beta selection enables
 * telemetry, and self-host telemetry stays off until it has a real
 * destination. A missing or unrecognized value is a missing configuration, and
 * missing configuration never blocks a core flow (13 §1).
 */

import type { TelemetryMode } from "@/application/telemetry/consent";

/** The deployment environment surface the mode is read from. */
export interface TelemetryEnv {
  readonly NEXT_PUBLIC_TELEMETRY_MODE?: string | undefined;
}

export interface TelemetryConfig {
  readonly mode: TelemetryMode;
  /**
   * Whether the deployment may use high-observability recording (session
   * replay, autocapture) — still gated on rider acknowledgement (11 §14–§15).
   */
  readonly highObservability: boolean;
}

export function resolveTelemetryConfig(env: TelemetryEnv): TelemetryConfig {
  if (env.NEXT_PUBLIC_TELEMETRY_MODE === "hosted-beta") {
    return { mode: "hosted-beta", highObservability: true };
  }
  return { mode: "self-host", highObservability: false };
}
