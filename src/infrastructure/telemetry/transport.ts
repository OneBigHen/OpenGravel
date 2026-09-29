/**
 * The optional SDK bridge seam (Task 11.4; 13 §2; 11 §14).
 *
 * Telemetry ships no analytics SDK as a dependency (no new dependencies; Rule
 * F). The hosted-beta build binds a bridge to its analytics SDK at the
 * composition root; an unbound deployment passes no transport and the gate
 * stays off. The seam is guarded so an SDK failure can never reach a core
 * flow (13 §1).
 */

import type { TelemetryEnvelope } from "@/application/telemetry/events";
import type { TelemetryTransport } from "@/application/telemetry/ports/telemetry-transport";

/** The minimal SDK surface the hosted build binds here. */
export interface TelemetrySdkBridge {
  capture(envelope: TelemetryEnvelope): void;
}

export function createSdkBridgeTransport(
  bridge: TelemetrySdkBridge,
): TelemetryTransport {
  return {
    send(envelope: TelemetryEnvelope): void {
      try {
        bridge.capture(envelope);
      } catch {
        // Fail closed at the adapter edge (13 §1).
      }
    },
  };
}
