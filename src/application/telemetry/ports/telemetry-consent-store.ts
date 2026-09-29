/**
 * Telemetry consent persistence port (Task 11.4; 11 §14).
 *
 * Reads are fail-closed: anything that is not a found, well-formed consent
 * state (absent, unreadable, corrupt) is treated as "unacknowledged", so a
 * broken store can never open the gate.
 */

import type { TelemetryConsentState } from "@/application/telemetry/consent";

export type TelemetryConsentRead =
  | { readonly status: "absent" }
  | { readonly status: "unreadable" }
  | { readonly status: "corrupt" }
  | { readonly status: "found"; readonly state: TelemetryConsentState };

export interface TelemetryConsentStore {
  read(): TelemetryConsentRead;
  write(state: TelemetryConsentState): void;
  clear(): void;
}
