import { describe, expect, it } from "vitest";

import {
  createTelemetryService,
  type TelemetryServiceOptions,
} from "@/application/telemetry/telemetry-service";
import type {
  TelemetryEnvelope,
  TelemetryEventProperties,
  TelemetryEventName,
} from "@/application/telemetry/events";
import { TELEMETRY_CONSENT_POLICY_VERSION } from "@/application/telemetry/consent";
import type {
  TelemetryConsentRead,
  TelemetryConsentStore,
} from "@/application/telemetry/ports/telemetry-consent-store";
import type { TelemetryTransport } from "@/application/telemetry/ports/telemetry-transport";

/**
 * The telemetry service is the fail-closed boundary (Task 11.4;
 * 13-OBSERVABILITY §1–§2, §5–§6; 11 §14).
 *
 * Core flows never touch telemetry: every entry point swallows storage and
 * transport failures, sending is gated on hosted beta + acknowledgement +
 * a configured transport, and self-host telemetry stays off until it has a
 * real destination.
 */

const NOW = "2026-09-23T00:31:33.000Z";

const BUILD = {
  appVersion: "0.0.0-next",
  buildId: "b-test",
  routePolicyVersion: "rp-1",
  graphVersionBand: "g-2026-09",
} as const;

function memoryConsentStore(): TelemetryConsentStore {
  let state: TelemetryConsentRead = { status: "absent" };
  return {
    read: () => state,
    write: (next) => {
      state = { status: "found", state: next };
    },
    clear: () => {
      state = { status: "absent" };
    },
  };
}

function recordingTransport(): {
  transport: TelemetryTransport;
  sent: TelemetryEnvelope[];
} {
  const sent: TelemetryEnvelope[] = [];
  return { transport: { send: (envelope) => void sent.push(envelope) }, sent };
}

function buildService(
  overrides: Partial<TelemetryServiceOptions> = {},
): ReturnType<typeof createTelemetryService> {
  return createTelemetryService({
    mode: "hosted-beta",
    transport: recordingTransport().transport,
    consentStore: memoryConsentStore(),
    build: BUILD,
    now: () => NOW,
    ...overrides,
  });
}

describe("gated emission (11 §14)", () => {
  it("sends nothing before acknowledgement", () => {
    const { transport, sent } = recordingTransport();
    const service = buildService({ transport });
    service.track("planner_opened", {});
    expect(sent).toEqual([]);
    expect(service.isEmitting()).toBe(false);
  });

  it("sends the privacy envelope with build correlation after acknowledgement (13 §6)", () => {
    const { transport, sent } = recordingTransport();
    const service = buildService({ transport });
    service.acknowledge();
    service.track("route_plan_requested", { routeMode: "to", source: "rider" });
    expect(sent).toEqual([
      {
        name: "route_plan_requested",
        properties: { routeMode: "to", source: "rider" },
        build: BUILD,
      },
    ]);
    expect(service.isEmitting()).toBe(true);
  });

  it("never sends in self-host mode, even after acknowledgement (11 §14)", () => {
    const { transport, sent } = recordingTransport();
    const service = buildService({ mode: "self-host", transport });
    service.acknowledge();
    service.track("planner_opened", {});
    expect(sent).toEqual([]);
  });

  it("stops sending after a withdraw", () => {
    const { transport, sent } = recordingTransport();
    const service = buildService({ transport });
    service.acknowledge();
    service.track("planner_opened", {});
    service.withdraw();
    service.track("planner_opened", {});
    expect(sent).toHaveLength(1);
  });

  it("fails closed when the consent read throws", () => {
    const store: TelemetryConsentStore = {
      read: () => {
        throw new Error("storage unavailable");
      },
      write: () => undefined,
      clear: () => undefined,
    };
    const { transport, sent } = recordingTransport();
    const service = buildService({ consentStore: store, transport });
    expect(() => service.track("planner_opened", {})).not.toThrow();
    expect(sent).toEqual([]);
  });
});

describe("fail-closed delivery (13 §1–§2)", () => {
  it("treats a missing transport as a quiet no-op (missing configuration never blocks)", () => {
    const service = buildService({ transport: null });
    service.acknowledge();
    expect(() => service.track("planner_opened", {})).not.toThrow();
  });

  it("never lets a transport failure block the caller or the next call", () => {
    const sent: TelemetryEnvelope[] = [];
    let failNext = true;
    const transport: TelemetryTransport = {
      send: (envelope) => {
        if (failNext) {
          failNext = false;
          throw new Error("collector down");
        }
        sent.push(envelope);
      },
    };
    const service = buildService({ transport });
    service.acknowledge();
    expect(() => service.track("planner_opened", {})).not.toThrow();
    expect(() => service.track("planner_opened", {})).not.toThrow();
    expect(sent).toHaveLength(1);
  });

  it("sanitizes every payload before sending (11 §14–§15)", () => {
    const { transport, sent } = recordingTransport();
    const service = buildService({ transport });
    service.acknowledge();
    service.track("route_primary_ready", {
      routeMode: "loop",
      distanceBand: "10-50km",
      rideId: "ride_x",
      coordinates: [
        [1, 2],
        [3, 4],
      ],
    } as unknown as TelemetryEventProperties<"route_primary_ready">);
    expect(sent).toEqual([
      {
        name: "route_primary_ready",
        properties: { routeMode: "loop", distanceBand: "10-50km" },
        build: BUILD,
      },
    ]);
  });

  it("drops an unknown event name cast in from untyped code", () => {
    const { transport, sent } = recordingTransport();
    const service = buildService({ transport });
    service.acknowledge();
    service.track("bogus_event" as TelemetryEventName, {});
    expect(sent).toEqual([]);
  });
});

describe("workflow spans (13 §5)", () => {
  it("records a span as a banded workflow event, never as raw milliseconds", () => {
    const { transport, sent } = recordingTransport();
    const service = buildService({ transport });
    service.acknowledge();
    service.recordWorkflowSpan("plan-click-to-first-route", 2_500);
    expect(sent).toEqual([
      {
        name: "workflow_span_recorded",
        properties: {
          workflow: "plan-click-to-first-route",
          durationBand: "1-10s",
        },
        build: BUILD,
      },
    ]);
  });

  it("drops a span whose duration is not a measurement (unknown stays unknown)", () => {
    const { transport, sent } = recordingTransport();
    const service = buildService({ transport });
    service.acknowledge();
    service.recordWorkflowSpan("plan-click-to-first-route", -1);
    expect(sent).toEqual([]);
  });
});

describe("acknowledgement handling (11 §14)", () => {
  it("persists the acknowledgement with its timestamp and policy version", () => {
    const store = memoryConsentStore();
    const service = buildService({ consentStore: store });
    service.acknowledge();
    expect(store.read()).toEqual({
      status: "found",
      state: {
        status: "acknowledged",
        acknowledgedAt: NOW,
        policyVersion: TELEMETRY_CONSENT_POLICY_VERSION,
      },
    });
  });

  it("fails closed when the consent write throws", () => {
    const store: TelemetryConsentStore = {
      read: (): TelemetryConsentRead => ({ status: "absent" }),
      write: () => {
        throw new Error("quota exceeded");
      },
      clear: () => undefined,
    };
    const { transport, sent } = recordingTransport();
    const service = buildService({ consentStore: store, transport });
    expect(() => service.acknowledge()).not.toThrow();
    service.track("planner_opened", {});
    expect(sent).toEqual([]);
  });
});
