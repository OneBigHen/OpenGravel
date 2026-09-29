import { describe, expect, it } from "vitest";

import {
  createLocalStorageTelemetryConsentStore,
  type TelemetryStorageLike,
} from "@/infrastructure/telemetry/local-storage-consent-store";
import {
  createSdkBridgeTransport,
  type TelemetrySdkBridge,
} from "@/infrastructure/telemetry/transport";
import { resolveTelemetryConfig } from "@/infrastructure/telemetry/config";
import type { TelemetryEnvelope } from "@/application/telemetry/events";

/**
 * The optional telemetry adapters (Task 11.4; 13-OBSERVABILITY §2,
 * 11 §14).
 *
 * Deployment configuration is fail-closed: only an explicit hosted-beta
 * selection enables sending. Self-host telemetry has no destination and stays
 * off by default. The consent store survives corrupt storage gracefully and
 * the SDK bridge seam is guarded so an SDK failure can never reach a core
 * flow.
 */

const ENVELOPE: TelemetryEnvelope = {
  name: "planner_opened",
  properties: {},
  build: { appVersion: "0.0.0-next", buildId: "b-test" },
};

function fakeStorage(initial?: string): TelemetryStorageLike & {
  entries: Map<string, string>;
  broken: boolean;
} {
  const entries = new Map<string, string>();
  if (initial !== undefined) entries.set("opengravel.vnext.telemetry-consent", initial);
  return {
    entries,
    broken: false,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

describe("resolveTelemetryConfig (13 §2)", () => {
  it("is off by default — self-host has no configured destination", () => {
    expect(resolveTelemetryConfig({})).toEqual({
      mode: "self-host",
      highObservability: false,
    });
  });

  it("enables hosted beta only on an explicit selection", () => {
    expect(
      resolveTelemetryConfig({ NEXT_PUBLIC_TELEMETRY_MODE: "hosted-beta" }),
    ).toEqual({ mode: "hosted-beta", highObservability: true });
  });

  it("fails closed on any other value", () => {
    for (const value of ["self-host", "true", "1", "Hosted-Beta", ""]) {
      expect(
        resolveTelemetryConfig({ NEXT_PUBLIC_TELEMETRY_MODE: value }),
      ).toEqual({ mode: "self-host", highObservability: false });
    }
  });
});

describe("the local-storage consent store (11 §14)", () => {
  it("round-trips an acknowledgement", () => {
    const storage = fakeStorage();
    const store = createLocalStorageTelemetryConsentStore(storage);
    const state = {
      status: "acknowledged",
      acknowledgedAt: "2026-09-23T00:31:33.000Z",
      policyVersion: 1,
    } as const;
    store.write(state);
    expect(store.read()).toEqual({ status: "found", state });
  });

  it("reports absent when nothing is stored", () => {
    const store = createLocalStorageTelemetryConsentStore(fakeStorage());
    expect(store.read()).toEqual({ status: "absent" });
  });

  it("reports corrupt JSON as corrupt, never as an acknowledgement", () => {
    const store = createLocalStorageTelemetryConsentStore(
      fakeStorage("{not json"),
    );
    expect(store.read()).toEqual({ status: "corrupt" });
  });

  it("reports a wrong shape as corrupt, never as an acknowledgement", () => {
    const store = createLocalStorageTelemetryConsentStore(
      fakeStorage(JSON.stringify({ status: "acknowledged" })),
    );
    expect(store.read()).toEqual({ status: "corrupt" });
  });

  it("reports a throwing storage as unreadable and swallows writes", () => {
    const storage: TelemetryStorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const store = createLocalStorageTelemetryConsentStore(storage);
    expect(store.read()).toEqual({ status: "unreadable" });
    expect(() =>
      store.write({ status: "acknowledged", acknowledgedAt: "now", policyVersion: 1 }),
    ).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });
});

describe("the SDK bridge transport seam", () => {
  it("forwards the privacy envelope to the bound SDK bridge", () => {
    const captured: TelemetryEnvelope[] = [];
    const bridge: TelemetrySdkBridge = {
      capture: (envelope) => void captured.push(envelope),
    };
    createSdkBridgeTransport(bridge).send(ENVELOPE);
    expect(captured).toEqual([ENVELOPE]);
  });

  it("swallows a bridge failure (fail closed at the adapter edge)", () => {
    const bridge: TelemetrySdkBridge = {
      capture: () => {
        throw new Error("sdk crashed");
      },
    };
    expect(() => createSdkBridgeTransport(bridge).send(ENVELOPE)).not.toThrow();
  });
});
