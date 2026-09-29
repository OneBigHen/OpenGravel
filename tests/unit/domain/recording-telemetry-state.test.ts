/**
 * The telemetry fold as a durable, incremental state (RIDE-INSTRUMENT-STRIP
 * §6, §11): a Free Ride with no stored track keeps only this state, so it must
 * give exactly the batch answer, survive JSON, stay small, and treat a
 * reload as a pause.
 */

import { describe, expect, it } from "vitest";

import {
  INITIAL_RECORDING_TELEMETRY_STATE,
  TELEMETRY_LIMITS,
  createRecordingTelemetry,
  parseRecordingTelemetryState,
  summarizeRecordingTelemetry,
  suspendRecordingTelemetry,
  type RecordingTelemetryState,
} from "@/domain/recording/telemetry";
import type { RecordingPosition } from "@/domain/recording/types";

import { MPH, SLICE_B_TRACES, Trace } from "../../fixtures/recording-telemetry/traces";

/** What storage does to a state: a JSON round trip, then validation. */
function throughStorage(state: RecordingTelemetryState): RecordingTelemetryState {
  const parsed = parseRecordingTelemetryState(JSON.parse(JSON.stringify(state)));
  if (parsed === null) throw new Error("a state the fold wrote did not parse");
  return parsed;
}

/** The trace's points after `index`, shifted later by `gapMs` and marked as resumed from a pause of that length. */
function afterBreak(points: readonly RecordingPosition[], index: number, gapMs: number): RecordingPosition[] {
  return points.slice(index).map((point) => ({
    ...point,
    observedAt: new Date(Date.parse(point.observedAt) + gapMs).toISOString(),
    pausedDurationMs: (point.pausedDurationMs ?? 0) + gapMs,
  }));
}

describe("the incremental fold matches the batch path", () => {
  for (const [name, build] of Object.entries(SLICE_B_TRACES)) {
    it(`${name}: identical after every point, even when the state is stored and restored between points`, () => {
      const points = build().points;
      const batch = summarizeRecordingTelemetry(points);
      const live = createRecordingTelemetry();
      let state = INITIAL_RECORDING_TELEMETRY_STATE;
      let previousMoving = 0;
      for (const [index, point] of points.entries()) {
        live.add(point);
        // A fresh accumulator on the stored state, as if the page were rebuilt from storage at every fix.
        const restored = createRecordingTelemetry(state);
        restored.add(point);
        state = throughStorage(restored.state());
        expect(restored.snapshot()).toEqual(live.snapshot());
        expect(live.snapshot()).toEqual(summarizeRecordingTelemetry(points.slice(0, index + 1)));
        expect(live.snapshot().movingMs).toBeGreaterThanOrEqual(previousMoving);
        previousMoving = live.snapshot().movingMs;
      }
      expect(live.snapshot()).toEqual(batch);
      expect(createRecordingTelemetry(state).snapshot()).toEqual(batch);
    });
  }
});

describe("the stored state stays small", () => {
  it("holds no track: its size does not grow with the ride", () => {
    const ten = createRecordingTelemetry();
    for (const point of new Trace().fix().ride(600, 30 * MPH, { device: false }).points) ten.add(point);
    const one = createRecordingTelemetry();
    for (const point of new Trace().fix().ride(60, 30 * MPH, { device: false }).points) one.add(point);
    const bytes = JSON.stringify(ten.state()).length;
    expect(bytes).toBeLessThan(2_000);
    expect(Math.abs(bytes - JSON.stringify(one.state()).length)).toBeLessThan(200);
    // The speed look-back only: at 1 Hz, the last 5 s of fixes.
    expect(ten.state().history.length).toBeLessThanOrEqual(TELEMETRY_LIMITS.deriveMaxBaselineMs / 1_000 + 1);
  });

  it("is a copy: changing what was handed out never changes the fold", () => {
    const fold = createRecordingTelemetry();
    for (const point of new Trace().fix().ride(30, 30 * MPH).points) fold.add(point);
    const before = fold.snapshot();
    const state = fold.state() as unknown as { movingMs: number; history: unknown[] };
    state.movingMs = 1e9;
    state.history.length = 0;
    expect(fold.snapshot()).toEqual(before);
  });
});

describe("a reload is a pause", () => {
  const points = new Trace().fix({ deviceSpeedMps: 0, altitude: 100 }).ride(120, 30 * MPH, { altitude: () => 100 }).points;
  const cut = 61;

  for (const gapMs of [3_000, 20_000, 120_000]) {
    it(`continues from the saved totals and credits none of a ${gapMs / 1_000} s reload`, () => {
      const before = createRecordingTelemetry();
      for (const point of points.slice(0, cut)) before.add(point);
      const saved = before.snapshot();

      const reloaded = createRecordingTelemetry(suspendRecordingTelemetry(throughStorage(before.state())));
      // Straight after the reload: the totals are back, and the rider reads as stopped.
      expect(reloaded.snapshot()).toMatchObject({
        movingMs: saved.movingMs,
        maxSpeedMps: saved.maxSpeedMps,
        acceptedDistanceMeters: saved.acceptedDistanceMeters,
        movement: "stopped",
        movingSinceMs: null,
      });

      const rest = afterBreak(points, cut, gapMs);
      for (const point of rest) reloaded.add(point);
      // Exactly the batch answer for the same ride with the reload recorded as a pause.
      expect(reloaded.snapshot()).toEqual(summarizeRecordingTelemetry([...points.slice(0, cut), ...rest]));
      // The riding after the reload is credited (bar the re-entry samples), the gap never is.
      const after = reloaded.snapshot().movingMs - saved.movingMs;
      expect(after).toBeLessThanOrEqual((points.length - cut - 1) * 1_000);
      expect(after).toBeGreaterThanOrEqual((points.length - cut - 1 - TELEMETRY_LIMITS.movingEnterSamples) * 1_000);
      expect(reloaded.snapshot().maxSpeedMps).toBeCloseTo(30 * MPH, 6);
    });
  }

  it("does not bridge a reload even when the next fix comes within the gap rule", () => {
    const before = createRecordingTelemetry();
    for (const point of points.slice(0, cut)) before.add(point);
    const reloaded = createRecordingTelemetry(suspendRecordingTelemetry(before.state()));
    // The very next fix, one second on: a live fold would credit that second; a reload does not.
    const next = points[cut]!;
    reloaded.add(next);
    before.add(next);
    expect(reloaded.snapshot().movingMs).toBe(before.snapshot().movingMs - 1_000);
    expect(reloaded.snapshot().movement).toBe("stopped");
  });
});

describe("a stored state is validated", () => {
  const good = (() => {
    const fold = createRecordingTelemetry();
    for (const point of new Trace().fix({ altitude: 100 }).ride(30, 30 * MPH, { altitude: () => 100 }).points) fold.add(point);
    return JSON.parse(JSON.stringify(fold.state())) as Record<string, unknown>;
  })();

  it("accepts what the fold wrote", () => {
    expect(parseRecordingTelemetryState(good)).toEqual(good);
    expect(parseRecordingTelemetryState(INITIAL_RECORDING_TELEMETRY_STATE)).toEqual(INITIAL_RECORDING_TELEMETRY_STATE);
  });

  it.each([
    ["not an object", "{"],
    ["null", null],
    ["another version", { ...good, version: 2 }],
    ["a missing total", { ...good, movingMs: undefined }],
    ["a negative moving time", { ...good, movingMs: -5 }],
    ["a non-finite distance", { ...good, distance: "12" }],
    ["an unknown movement", { ...good, movement: "sliding" }],
    ["a broken anchor", { ...good, anchor: { atMs: 1 } }],
    ["a broken history", { ...good, history: [{ atMs: 1, coordinate: { lon: 500, lat: 0 }, accuracyMeters: 5 }] }],
    ["no rejection counters", { ...good, rejected: null }],
  ])("rejects %s", (_name, value) => {
    expect(parseRecordingTelemetryState(value)).toBeNull();
  });
});
