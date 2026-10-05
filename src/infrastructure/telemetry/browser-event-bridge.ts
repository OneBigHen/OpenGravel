import type { TelemetryEventName, TelemetryEventProperties } from "@/application/telemetry/events";
import type { TelemetryService } from "@/application/telemetry/telemetry-service";

export const TELEMETRY_INTENT_EVENT = "opengravel:telemetry-intent";
export interface BrowserTelemetryIntent {
  readonly name: TelemetryEventName;
  readonly properties?: TelemetryEventProperties<TelemetryEventName> | undefined;
}
/** Local typed event bridge; the app-root service retains consent/sanitization. */
export const publishTelemetryIntent: TelemetryService["track"] = (name, properties) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TELEMETRY_INTENT_EVENT, { detail: { name, properties } }));
};
