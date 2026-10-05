import type { TelemetryEventName, TelemetryEventProperties } from "@/application/telemetry/events";

/**
 * UI-safe telemetry intent. The app-root TelemetryClient listens for this DOM
 * event and applies consent, sanitization and transport; UI code never imports
 * the SDK or infrastructure. The name must match browser-event-bridge.ts.
 */
export const UI_TELEMETRY_INTENT_EVENT = "opengravel:telemetry-intent";

export function emitTelemetry<E extends TelemetryEventName>(name: E, properties?: TelemetryEventProperties<E>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UI_TELEMETRY_INTENT_EVENT, { detail: { name, properties } }));
}
