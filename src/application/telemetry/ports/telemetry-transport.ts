/**
 * Telemetry transport port (Task 11.4; 13-OBSERVABILITY §1–§2).
 *
 * Deliberately SDK-agnostic: the hosted build binds this to its analytics SDK
 * at the composition root, and deployments without a destination pass no
 * transport at all (the gate stays off — 11 §14).
 */

import type { TelemetryEnvelope } from "@/application/telemetry/events";

export interface TelemetryTransport {
  /** Hands one privacy-safe envelope to the destination. Never throws upward. */
  send(envelope: TelemetryEnvelope): void;
}
