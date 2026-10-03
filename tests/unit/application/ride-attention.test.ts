import { describe, expect, it } from "vitest";

import {
  deriveRideAttentionEnvelope,
} from "@/application/ride-session/ride-attention";

describe("Ride Focus attention envelope", () => {
  it("keeps normal chrome primary while the next maneuver is far away", () => {
    const result = deriveRideAttentionEnvelope({
      moving: true,
      speedMps: 20,
      maneuverDistanceMeters: 1_000,
    });

    expect(result).toEqual({
      mode: "calm",
      secondsToDecision: null,
      prioritizedDecision: "none",
      mapDensity: "normal",
      emphasizeMetrics: true,
      emphasizeSecondary: true,
      emphasizeDecision: false,
    });
  });

  it("uses time-to-decision so faster riding prepares earlier in distance", () => {
    const fast = deriveRideAttentionEnvelope({
      moving: true,
      speedMps: 25,
      maneuverDistanceMeters: 300,
    });
    const slow = deriveRideAttentionEnvelope({
      moving: true,
      speedMps: 8,
      maneuverDistanceMeters: 300,
    });

    expect(fast.mode).toBe("prepare");
    expect(fast.secondsToDecision).toBeCloseTo(12);
    expect(slow.mode).toBe("calm");
  });

  it("reduces secondary information for an imminent maneuver", () => {
    const result = deriveRideAttentionEnvelope({
      moving: true,
      speedMps: 15,
      maneuverDistanceMeters: 75,
    });

    expect(result.mode).toBe("imminent");
    expect(result.prioritizedDecision).toBe("maneuver");
    expect(result.mapDensity).toBe("minimal");
    expect(result.emphasizeMetrics).toBe(false);
    expect(result.emphasizeSecondary).toBe(false);
    expect(result.emphasizeDecision).toBe(true);
  });

  it("uses distance-only fallback when usable speed is unavailable", () => {
    const result = deriveRideAttentionEnvelope({
      moving: true,
      speedMps: null,
      maneuverDistanceMeters: 70,
    });

    expect(result.mode).toBe("imminent");
    expect(result.secondsToDecision).toBeNull();
    expect(result.prioritizedDecision).toBe("maneuver");
  });

  it("does not let an optional Free Ride opportunity compete with a maneuver", () => {
    const result = deriveRideAttentionEnvelope({
      moving: true,
      speedMps: 15,
      maneuverDistanceMeters: 150,
      opportunityDistanceMeters: 40,
    });

    expect(result.mode).toBe("prepare");
    expect(result.prioritizedDecision).toBe("maneuver");
  });

  it("can promote one upcoming Free Ride opportunity when ordinary guidance is calm", () => {
    const result = deriveRideAttentionEnvelope({
      moving: true,
      speedMps: 15,
      maneuverDistanceMeters: null,
      opportunityDistanceMeters: 75,
    });

    expect(result.mode).toBe("imminent");
    expect(result.prioritizedDecision).toBe("opportunity");
  });

  it("recovery outranks normal maneuver and opportunity guidance", () => {
    const result = deriveRideAttentionEnvelope({
      moving: true,
      speedMps: 15,
      maneuverDistanceMeters: 50,
      opportunityDistanceMeters: 40,
      recoveryActive: true,
    });

    expect(result.mode).toBe("recovery");
    expect(result.prioritizedDecision).toBe("recovery");
    expect(result.emphasizeDecision).toBe(true);
  });

  it("critical warnings outrank recovery and all route decisions", () => {
    const result = deriveRideAttentionEnvelope({
      moving: true,
      speedMps: 15,
      maneuverDistanceMeters: 50,
      recoveryActive: true,
      criticalWarningActive: true,
    });

    expect(result.mode).toBe("critical");
    expect(result.prioritizedDecision).toBe("warning");
    expect(result.mapDensity).toBe("minimal");
  });

  it("does not elevate optional route decisions while stopped", () => {
    const result = deriveRideAttentionEnvelope({
      moving: false,
      speedMps: 0,
      maneuverDistanceMeters: 20,
      opportunityDistanceMeters: 20,
    });

    expect(result.mode).toBe("calm");
    expect(result.prioritizedDecision).toBe("none");
  });
});
