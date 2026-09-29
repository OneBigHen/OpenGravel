/**
 * The telemetry service (Task 11.4; 13-OBSERVABILITY §1–§2, §5–§6;
 * 11-OFFLINE-IDENTITY-SHARING-PRIVACY §14).
 *
 * This is the fail-closed boundary of the privacy event model:
 *
 * - sending is gated on hosted-beta mode AND an acknowledgement AND a
 *   configured transport; self-host telemetry stays off by default until it
 *   has a real destination (13 §2),
 * - every entry point swallows consent-store and transport failures —
 *   telemetry never blocks navigation, planning, drawing, import, advising or
 *   ride execution (13 §1),
 * - payloads pass the runtime allowlist before any send (11 §14–§15), and
 * - workflow timing is recorded as one bounded span per workflow, banded —
 *   never as a per-action timer profile of the rider (13 §5).
 */

import {
  TELEMETRY_EVENT_NAMES,
  sanitizeTelemetryProperties,
  type TelemetryBuildCorrelation,
  type TelemetryEnvelope,
  type TelemetryEventName,
  type TelemetryEventProperties,
} from "@/application/telemetry/events";
import {
  acknowledgedConsentState,
  telemetryGateOpen,
  type TelemetryConsentState,
  type TelemetryMode,
} from "@/application/telemetry/consent";
import type {
  TelemetryConsentStore,
} from "@/application/telemetry/ports/telemetry-consent-store";
import type { TelemetryTransport } from "@/application/telemetry/ports/telemetry-transport";
import {
  durationBand,
  type TelemetryWorkflowName,
} from "@/application/telemetry/vocabulary";

export interface TelemetryServiceOptions {
  /** Deployment mode (13 §2). Self-host is off by default. */
  readonly mode: TelemetryMode;
  /** The configured destination, or `null` when none exists (13 §2). */
  readonly transport: TelemetryTransport | null;
  readonly consentStore: TelemetryConsentStore;
  /** Build correlation carried with every event (13 §6). */
  readonly build: TelemetryBuildCorrelation;
  /** Injectable clock for deterministic acknowledgement timestamps. */
  readonly now?: (() => string) | undefined;
}

export interface TelemetryService {
  /** Records one semantic event. Never throws to the caller (13 §1). */
  track<E extends TelemetryEventName>(
    name: E,
    properties?: TelemetryEventProperties<E> | undefined,
  ): void;
  /** Records one workflow span as a banded duration (13 §5). */
  recordWorkflowSpan(workflow: TelemetryWorkflowName, durationMs: number): void;
  /** Opens the gate: persists the acknowledgement (11 §14). */
  acknowledge(): void;
  /** Closes the gate and clears the stored acknowledgement. */
  withdraw(): void;
  /** The fail-closed consent read (11 §14). */
  consent(): TelemetryConsentState;
  /** Whether this instance currently emits. */
  isEmitting(): boolean;
}

const UNACKNOWLEDGED: TelemetryConsentState = { status: "unacknowledged" };

const KNOWN_EVENT_NAMES: readonly TelemetryEventName[] = TELEMETRY_EVENT_NAMES;

export function createTelemetryService(
  options: TelemetryServiceOptions,
): TelemetryService {
  const { mode, transport, consentStore, build } = options;
  const now = options.now ?? ((): string => new Date().toISOString());

  /** Fail-closed consent read: anything but a found acknowledgement is off. */
  const readConsent = (): TelemetryConsentState => {
    try {
      const read = consentStore.read();
      return read.status === "found" &&
        read.state.status === "acknowledged"
        ? read.state
        : UNACKNOWLEDGED;
    } catch {
      return UNACKNOWLEDGED;
    }
  };

  const isEmitting = (): boolean => {
    try {
      return (
        transport !== null && telemetryGateOpen(mode, readConsent())
      );
    } catch {
      return false;
    }
  };

  const track = <E extends TelemetryEventName>(
    name: E,
    properties?: TelemetryEventProperties<E>,
  ): void => {
    try {
      if (!isEmitting()) return;
      if (!(KNOWN_EVENT_NAMES as readonly string[]).includes(name)) return;
      const envelope: TelemetryEnvelope = {
        name,
        properties: sanitizeTelemetryProperties(name, properties),
        build,
      };
      transport?.send(envelope);
    } catch {
      // Telemetry never blocks a core flow (13 §1).
    }
  };

  return {
    track,
    recordWorkflowSpan: (workflow, durationMs): void => {
      const band = durationBand(durationMs);
      if (band === null) return;
      track("workflow_span_recorded", { workflow, durationBand: band });
    },
    acknowledge: (): void => {
      try {
        consentStore.write(acknowledgedConsentState(now()));
      } catch {
        // Fail closed: the gate stays off when the write cannot persist (11 §14).
      }
    },
    withdraw: (): void => {
      try {
        consentStore.clear();
      } catch {
        // Fail closed: an uncleared record never reopens the gate by itself.
      }
    },
    consent: readConsent,
    isEmitting,
  };
}
