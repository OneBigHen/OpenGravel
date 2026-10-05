import { describe, expect, it } from "vitest";
import { createLocalStorageTelemetryConsentStore, TELEMETRY_CONSENT_CHANGED_EVENT } from "@/infrastructure/telemetry/local-storage-consent-store";
describe("same-tab withdrawal", () => {
  it("signals immediate withdrawal even when storage cannot be cleared", () => {
    const changes: unknown[] = [];
    const listen = (event: Event) => changes.push((event as CustomEvent).detail);
    window.addEventListener(TELEMETRY_CONSENT_CHANGED_EVENT, listen);
    try {
      createLocalStorageTelemetryConsentStore({ getItem: () => null, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } }).clear();
      expect(changes).toEqual([{ status: "unacknowledged" }]);
    } finally { window.removeEventListener(TELEMETRY_CONSENT_CHANGED_EVENT, listen); }
  });
});
