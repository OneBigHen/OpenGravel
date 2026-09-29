/**
 * Lean-angle beta math (issue #12 follow-up): calibration against an
 * arbitrary mount, the signed angle a gravity sample reads against that
 * reference, the exponential low-pass filter, and the per-ride max fold.
 */

import { describe, expect, it } from "vitest";

import {
  calibrateLean,
  calibrateLeanReference,
  INITIAL_LEAN_TELEMETRY_STATE,
  leanAngleDegrees,
  lowPass,
  sampleLean,
  type LeanTelemetryState,
} from "@/domain/motion/lean";

describe("calibrateLeanReference", () => {
  it("calibrates 'down' from gravity and 'right' from the device's seed axis when it isn't parallel to down", () => {
    const reference = calibrateLeanReference({ x: 0, y: 0, z: 1 }, 1_000);
    expect(reference).toEqual({ down: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, calibratedAtMs: 1_000 });
  });

  it("falls back to a different seed when gravity runs along the device's seed axis, never a degenerate right", () => {
    const reference = calibrateLeanReference({ x: 5, y: 0, z: 0 }, 1_000);
    expect(reference).toEqual({ down: { x: 1, y: 0, z: 0 }, right: { x: 0, y: 1, z: 0 }, calibratedAtMs: 1_000 });
  });

  it("is null for a degenerate (all-zero) reading, never a guessed reference", () => {
    expect(calibrateLeanReference({ x: 0, y: 0, z: 0 }, 1_000)).toBeNull();
  });
});

describe("leanAngleDegrees", () => {
  const reference = calibrateLeanReference({ x: 0, y: 0, z: 1 }, 1_000)!;

  it("is 0 at the reference itself", () => {
    expect(leanAngleDegrees(reference, { x: 0, y: 0, z: 1 })).toBe(0);
  });

  it("is signed: positive toward the reference's right, negative toward its left", () => {
    expect(leanAngleDegrees(reference, { x: 1, y: 0, z: 1 })).toBeCloseTo(45, 9);
    expect(leanAngleDegrees(reference, { x: -1, y: 0, z: 1 })).toBeCloseTo(-45, 9);
  });

  it("is null for a degenerate sample", () => {
    expect(leanAngleDegrees(reference, { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe("lowPass", () => {
  it("returns the sample outright with no previous value, or a non-positive interval", () => {
    expect(lowPass(null, 10, 400, 400)).toBe(10);
    expect(lowPass(0, 10, 0, 400)).toBe(10);
    expect(lowPass(0, 10, -5, 400)).toBe(10);
  });

  it("blends toward the sample by 1 - e^(-dt/timeConstant)", () => {
    expect(lowPass(0, 10, 400, 400)).toBeCloseTo(6.321205588, 8);
  });
});

describe("calibrateLean", () => {
  it("re-zeroes: a fresh reference, smoothed at 0, and a cleared max", () => {
    const state = calibrateLean({ x: 0, y: 0, z: 1 }, 1_000);
    expect(state).toEqual({
      reference: { down: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, calibratedAtMs: 1_000 },
      smoothedDegrees: 0,
      lastSampleAtMs: 1_000,
      maxLeftDegrees: 0,
      maxRightDegrees: 0,
    });
  });

  it("is null for a degenerate reading", () => {
    expect(calibrateLean({ x: 0, y: 0, z: 0 }, 1_000)).toBeNull();
  });
});

describe("sampleLean", () => {
  it("auto-calibrates on the first sample fed to the initial state", () => {
    const state = sampleLean(INITIAL_LEAN_TELEMETRY_STATE, { x: 0, y: 0, z: 1 }, 1_000);
    expect(state.reference).not.toBeNull();
    expect(state.smoothedDegrees).toBe(0);
  });

  it("keeps waiting (does not calibrate) on a degenerate first sample", () => {
    const state = sampleLean(INITIAL_LEAN_TELEMETRY_STATE, { x: 0, y: 0, z: 0 }, 1_000);
    expect(state).toEqual(INITIAL_LEAN_TELEMETRY_STATE);
  });

  it("smooths later samples against the calibrated reference and tracks each side's running max independently", () => {
    let state = sampleLean(INITIAL_LEAN_TELEMETRY_STATE, { x: 0, y: 0, z: 1 }, 1_000);
    state = sampleLean(state, { x: 1, y: 0, z: 1 }, 1_400); // +45° raw, one time constant later
    expect(state.smoothedDegrees).toBeCloseTo(28.445425147, 8);
    expect(state.maxRightDegrees).toBeCloseTo(28.445425147, 8);
    expect(state.maxLeftDegrees).toBe(0);

    state = sampleLean(state, { x: -1, y: 0, z: 1 }, 1_800); // -45° raw, swings back through zero
    expect(state.smoothedDegrees).toBeCloseTo(-17.980938040, 8);
    // The right-side max from the earlier sample is kept, not reset by the swing to the left.
    expect(state.maxRightDegrees).toBeCloseTo(28.445425147, 8);
    expect(state.maxLeftDegrees).toBeCloseTo(17.980938040, 8);
  });

  it("drops a degenerate sample mid-ride rather than counting it as a zero", () => {
    let state = sampleLean(INITIAL_LEAN_TELEMETRY_STATE, { x: 0, y: 0, z: 1 }, 1_000);
    state = sampleLean(state, { x: 1, y: 0, z: 1 }, 1_400);
    const before: LeanTelemetryState = state;
    const after = sampleLean(state, { x: 0, y: 0, z: 0 }, 1_800);
    expect(after).toEqual(before);
  });
});
