// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { TELEMETRY_INTENT_EVENT } from "@/infrastructure/telemetry/browser-event-bridge";
import { emitTelemetry, UI_TELEMETRY_INTENT_EVENT } from "@/ui/telemetry/emit-telemetry";

describe("emitTelemetry", () => {
  it("uses the same event name the app-root listener subscribes to", () => {
    expect(UI_TELEMETRY_INTENT_EVENT).toBe(TELEMETRY_INTENT_EVENT);
  });
  it("dispatches a typed intent on window", () => {
    const seen = vi.fn();
    window.addEventListener(UI_TELEMETRY_INTENT_EVENT, (e) => seen((e as CustomEvent).detail));
    emitTelemetry("draw_started", { source: "drawing" });
    expect(seen).toHaveBeenCalledWith({ name: "draw_started", properties: { source: "drawing" } });
  });
});
