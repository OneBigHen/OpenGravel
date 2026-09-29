/**
 * Recording quality trace fixtures (RIDE-INSTRUMENT-STRIP §6, §17.3).
 *
 * Every fixture is a deterministic synthetic trace: a normal highway ride,
 * stop-and-go traffic, a long stop, a GPS jump, poor accuracy, missing
 * altitude, altitude stair-steps and noise, and a resume after a pause. The
 * assertions are the §17.3 gate: no impossible max-speed spike, stable moving
 * time, one consistent average-speed definition, and a working gain/loss
 * deadband.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_RECORDING_TELEMETRY,
  TELEMETRY_LIMITS,
  createRecordingTelemetry,
  deriveSpeedMps,
  movingAverageSpeedMps,
  summarizeRecordingTelemetry,
  type RecordingTelemetry,
} from "@/domain/recording/telemetry";

import { MPH, START_MS, Trace, wobble } from "../../fixtures/recording-telemetry/traces";

function telemetryOf(trace: Trace): RecordingTelemetry {
  return summarizeRecordingTelemetry(trace.points);
}

function mph(mps: number | null): number {
  return (mps ?? Number.NaN) / MPH;
}

/** The §6.2 definition, checked on every fixture. */
function expectConsistentAverage(telemetry: RecordingTelemetry): void {
  const average = movingAverageSpeedMps(telemetry);
  if (telemetry.movingMs < TELEMETRY_LIMITS.averageMinMovingMs) {
    expect(average).toBeNull();
    return;
  }
  expect(average).toBeCloseTo(telemetry.acceptedDistanceMeters / (telemetry.movingMs / 1000), 9);
}

describe("normal highway ride", () => {
  const highway = new Trace().fix({ deviceSpeedMps: 0, altitude: 200 }).ride(600, 65 * MPH, {
    altitude: (index) => 200 + 2 * wobble(index, 7),
    each: (second) => ({ deviceSpeedMps: (65 + wobble(second, 11)) * MPH }),
  });
  const telemetry = telemetryOf(highway);

  it("counts the whole ride as moving time, bar the start-up samples", () => {
    expect(telemetry.movement).toBe("moving");
    expect(telemetry.movingMs).toBe(600_000);
    expect(telemetry.movingSinceMs).toBe(START_MS);
  });

  it("has a moving average of the ride's speed, by one definition", () => {
    expect(mph(movingAverageSpeedMps(telemetry))).toBeCloseTo(65, 0);
    expectConsistentAverage(telemetry);
  });

  it("has a max no higher than any speed held for two samples", () => {
    expect(mph(telemetry.maxSpeedMps)).toBeLessThanOrEqual(66);
    expect(mph(telemetry.maxSpeedMps)).toBeGreaterThan(64);
  });

  it("keeps ±2 m of flat-road altitude noise out of gain and loss", () => {
    expect(telemetry.elevation.gainMeters).toBe(0);
    expect(telemetry.elevation.lossMeters).toBe(0);
    expect(telemetry.elevation.currentMeters).toBeCloseTo(200, -1);
  });

  it("gets the same answer from derived speed when the device reports none", () => {
    const derived = telemetryOf(new Trace().fix().ride(600, 65 * MPH, { device: false }));
    expect(mph(movingAverageSpeedMps(derived))).toBeCloseTo(65, 0);
    expect(mph(derived.maxSpeedMps)).toBeCloseTo(65, 0);
    // The first second has no derivation baseline yet; the rest is moving.
    expect(derived.movingMs).toBeGreaterThanOrEqual(598_000);
    expectConsistentAverage(derived);
  });

  it("is deterministic and the same whether folded at once or point by point", () => {
    const incremental = createRecordingTelemetry();
    let previousMoving = 0;
    for (const point of highway.points) {
      incremental.add(point);
      const snapshot = incremental.snapshot();
      // Stable: moving time never goes backwards.
      expect(snapshot.movingMs).toBeGreaterThanOrEqual(previousMoving);
      previousMoving = snapshot.movingMs;
    }
    expect(incremental.snapshot()).toEqual(telemetry);
    expect(telemetryOf(highway)).toEqual(telemetry);
  });
});

describe("stop-and-go traffic", () => {
  const trace = new Trace()
    .fix({ deviceSpeedMps: 0 })
    .ride(30, 20 * MPH)
    .stop(3) // a stoplight roll: shorter than the stopped window
    .ride(30, 20 * MPH)
    .stop(20)
    .ride(30, 20 * MPH);
  const telemetry = telemetryOf(trace);

  it("keeps a short dip as moving time and leaves a sustained stop out", () => {
    // 30 + 3 + 30 moving, the 20 s stop out, then 30 more (entry samples credited back).
    expect(telemetry.movingMs).toBe(93_000);
    expect(telemetry.movement).toBe("moving");
  });

  it("restarts 'since stop' at the sustained stop, not the short dip", () => {
    const resumedAt = START_MS + (30 + 3 + 30 + 20) * 1_000;
    expect(telemetry.movingSinceMs).toBe(resumedAt);
  });

  it("never credits stationary jitter as distance", () => {
    expect(telemetry.acceptedDistanceMeters).toBeGreaterThan(90 * 20 * MPH - 5);
    expect(telemetry.acceptedDistanceMeters).toBeLessThan(90 * 20 * MPH + 25);
    expectConsistentAverage(telemetry);
    expect(mph(movingAverageSpeedMps(telemetry))).toBeLessThan(20.5);
  });
});

describe("long stop", () => {
  /** 60 s at 30 mph, then a realistic brake to a standstill (~4.5 m/s²). */
  function rideThenBrake(device: boolean): Trace {
    return new Trace()
      .fix({ deviceSpeedMps: 0 })
      .ride(60, 30 * MPH, { device })
      .ride(1, 20 * MPH, { device })
      .ride(1, 10 * MPH, { device });
  }

  it("stops the moving clock through ten minutes of jitter and stoplight spikes (device speed)", () => {
    const before = telemetryOf(rideThenBrake(true));
    const telemetry = telemetryOf(rideThenBrake(true).stop(600, { spikeEvery: 7 }));
    expect(telemetry.movement).toBe("stopped");
    expect(telemetry.movingSinceMs).toBeNull();
    // The stopped window was only ever pending; none of it stays.
    expect(telemetry.movingMs).toBe(before.movingMs);
    expect(telemetry.acceptedDistanceMeters).toBeCloseTo(before.acceptedDistanceMeters, 6);
    expect(mph(telemetry.maxSpeedMps)).toBeLessThanOrEqual(30.01);
    expectConsistentAverage(telemetry);
  });

  it("stops the moving clock through ten minutes of jitter (derived speed, no device speed)", () => {
    const before = telemetryOf(rideThenBrake(false));
    const settling = createRecordingTelemetry();
    for (const point of rideThenBrake(false).stop(15, { device: false }).points) settling.add(point);
    const afterSettling = settling.snapshot();
    const telemetry = telemetryOf(rideThenBrake(false).stop(600, { device: false }));
    expect(telemetry.movement).toBe("stopped");
    // A derived speed trails the stop by at most its look-back window, then the clock holds still.
    expect(telemetry.movingMs).toBeLessThanOrEqual(before.movingMs + TELEMETRY_LIMITS.deriveMaxBaselineMs);
    expect(telemetry.movingMs).toBe(afterSettling.movingMs);
    expect(mph(telemetry.maxSpeedMps)).toBeLessThanOrEqual(30.01);
    expectConsistentAverage(telemetry);
  });

  it("needs several credible samples above 3 mph before it counts as moving again", () => {
    const telemetry = telemetryOf(
      new Trace().fix({ deviceSpeedMps: 0 }).stop(30).ride(2, 10 * MPH).stop(30),
    );
    expect(telemetry.movingMs).toBe(0);
    expect(telemetry.maxSpeedMps).toBeNull();
  });
});

describe("GPS jump", () => {
  it("rejects a one-sample 800 m jump and a one-sample device speed spike", () => {
    const trace = new Trace()
      .fix({ deviceSpeedMps: 0 })
      .ride(60, 40 * MPH)
      .ride(1, 40 * MPH, { each: () => ({ offsetEastMeters: 800, deviceSpeedMps: 140 }) })
      .ride(30, 40 * MPH)
      .ride(1, 40 * MPH, { each: () => ({ deviceSpeedMps: 70 }) })
      .ride(30, 40 * MPH);
    const telemetry = telemetryOf(trace);
    expect(telemetry.rejected.jumps).toBe(1);
    expect(telemetry.rejected.speedSpikes).toBeGreaterThanOrEqual(1);
    expect(mph(telemetry.maxSpeedMps)).toBeLessThanOrEqual(40.01);
    // The jump sample is dropped; its time is carried by the next interval.
    expect(telemetry.movingMs).toBe(122_000);
    expect(telemetry.acceptedDistanceMeters).toBeCloseTo(122 * 40 * MPH, -1);
    expectConsistentAverage(telemetry);
  });

  it("rejects a 60 m jump while standing still: not plausible from a standstill", () => {
    const trace = new Trace()
      .fix({ deviceSpeedMps: 0 })
      .stop(10)
      .wait(1_000)
      .fix({ offsetEastMeters: 60, accuracy: 8 })
      .stop(10);
    const telemetry = telemetryOf(trace);
    expect(telemetry.rejected.jumps).toBe(1);
    expect(telemetry.movingMs).toBe(0);
  });

  it("believes a sustained relocation after a few agreeing fixes, crediting nothing across it", () => {
    const trace = new Trace()
      .fix({ deviceSpeedMps: 0 })
      .ride(30, 30 * MPH)
      .teleport(2_000)
      .ride(40, 30 * MPH);
    const telemetry = telemetryOf(trace);
    expect(telemetry.rejected.jumps).toBe(TELEMETRY_LIMITS.jumpReanchorSamples);
    expect(telemetry.acceptedDistanceMeters).toBeLessThan(70 * 30 * MPH);
    expect(mph(telemetry.maxSpeedMps)).toBeLessThanOrEqual(30.01);
    expectConsistentAverage(telemetry);
  });
});

describe("poor accuracy", () => {
  it("ignores fixes with unusable accuracy, even when they are far off", () => {
    const trace = new Trace()
      .fix({ deviceSpeedMps: 0 })
      .ride(120, 30 * MPH, {
        each: (second) => (second % 3 === 0 ? { accuracy: 120, offsetEastMeters: 150, deviceSpeedMps: 55 } : {}),
      });
    const telemetry = telemetryOf(trace);
    expect(telemetry.rejected.poorAccuracy).toBe(40);
    expect(mph(telemetry.maxSpeedMps)).toBeLessThanOrEqual(30.01);
    // Second 120 is itself a poor fix, so the last credible one is at 119 s.
    expect(telemetry.acceptedDistanceMeters).toBeCloseTo(119 * 30 * MPH, -1);
    expectConsistentAverage(telemetry);
  });

  it("shows nothing at all from a trace that is all poor accuracy", () => {
    const trace = new Trace().fix({ accuracy: 200 }).ride(60, 30 * MPH, { each: () => ({ accuracy: 200 }) });
    const telemetry = telemetryOf(trace);
    expect(telemetry.lastSampleAtMs).toBeNull();
    expect(telemetry.movingMs).toBe(0);
    expect(telemetry.maxSpeedMps).toBeNull();
    expect(movingAverageSpeedMps(telemetry)).toBeNull();
  });

  it("never derives a speed from an unusable fix", () => {
    const base = { coordinate: { lon: -75.44, lat: 40.14 }, atMs: START_MS, accuracyMeters: 5 };
    const far = { coordinate: { lon: -75.43, lat: 40.14 }, atMs: START_MS + 3_000, accuracyMeters: 80 };
    expect(deriveSpeedMps([base], far)).toBeNull();
    expect(deriveSpeedMps([], { ...far, accuracyMeters: 5 })).toBeNull();
  });
});

describe("missing altitude", () => {
  it("reports no altitude at all rather than a zero profile", () => {
    const telemetry = telemetryOf(new Trace().fix().ride(120, 30 * MPH));
    expect(telemetry.elevation).toEqual({ ...EMPTY_RECORDING_TELEMETRY.elevation });
    expect(telemetry.elevation.sampleCount).toBe(0);
    expect(telemetry.elevation.currentMeters).toBeNull();
  });

  it("does not bridge a long altitude gap: a climb hidden in the gap is not credited", () => {
    const trace = new Trace()
      .fix({ altitude: 100 })
      .ride(60, 20 * MPH, { altitude: () => 100 })
      .ride(90, 20 * MPH) // 90 s without altitude
      .ride(60, 20 * MPH, { altitude: () => 250 });
    const telemetry = telemetryOf(trace);
    expect(telemetry.elevation.gainMeters).toBe(0);
    expect(telemetry.elevation.currentMeters).toBeCloseTo(250, 3);
  });

  it("lets the current elevation lapse when altitude stops arriving", () => {
    const trace = new Trace().fix({ altitude: 100 }).ride(30, 20 * MPH, { altitude: () => 100 }).ride(40, 20 * MPH);
    expect(telemetryOf(trace).elevation.currentMeters).toBeNull();
  });

  it("ignores altitude with an unusable vertical accuracy", () => {
    const trace = new Trace().fix({ altitude: 100, altitudeAccuracy: 60 }).ride(60, 20 * MPH, {
      altitude: (_index, second) => 100 + second,
      each: () => ({ altitudeAccuracy: 60 }),
    });
    expect(telemetryOf(trace).elevation.sampleCount).toBe(0);
  });
});

describe("altitude stair-steps and noise", () => {
  it("counts no gain or loss from stair-step quantisation plus noise on a flat road", () => {
    const trace = new Trace().fix({ altitude: 200 }).ride(600, 25 * MPH, {
      // 2 m stairs flipping every 4 s, plus ±3 m noise.
      altitude: (index, second) => 200 + (Math.floor(second / 4) % 2 === 0 ? 0 : 2) + 3 * wobble(index, 13),
    });
    const telemetry = telemetryOf(trace);
    expect(telemetry.elevation.gainMeters).toBe(0);
    expect(telemetry.elevation.lossMeters).toBe(0);
  });

  it("does not count a climb smaller than the deadband", () => {
    const trace = new Trace().fix({ altitude: 200 }).ride(120, 20 * MPH, {
      altitude: (_index, second) => 200 + Math.min(4, second / 10),
    });
    expect(telemetryOf(trace).elevation.gainMeters).toBe(0);
  });

  it("counts a sustained, noisy 120 m climb and descent, less the deadband", () => {
    const trace = new Trace()
      .fix({ altitude: 300 })
      .ride(300, 25 * MPH, { altitude: (index, second) => 300 + second * 0.4 + 3 * wobble(index, 17) })
      .ride(300, 25 * MPH, { altitude: (index, second) => 420 - second * 0.4 + 3 * wobble(index, 19) });
    const telemetry = telemetryOf(trace);
    expect(telemetry.elevation.gainMeters).toBeGreaterThan(110);
    expect(telemetry.elevation.gainMeters).toBeLessThanOrEqual(125);
    expect(telemetry.elevation.lossMeters).toBeGreaterThan(100);
    expect(telemetry.elevation.lossMeters).toBeLessThanOrEqual(125);
  });

  it("counts a real stair-step climb of 10 m every 20 s", () => {
    const trace = new Trace().fix({ altitude: 0 }).ride(200, 20 * MPH, {
      altitude: (_index, second) => Math.floor(second / 20) * 10,
    });
    const telemetry = telemetryOf(trace);
    expect(telemetry.elevation.gainMeters).toBeGreaterThan(90);
    expect(telemetry.elevation.gainMeters).toBeLessThanOrEqual(100);
  });

  it("rejects an impossible one-sample vertical jump", () => {
    const trace = new Trace()
      .fix({ altitude: 150 })
      .ride(60, 30 * MPH, { altitude: (_index, second) => (second === 30 ? 400 : 150) });
    const telemetry = telemetryOf(trace);
    expect(telemetry.rejected.verticalJumps).toBe(1);
    expect(telemetry.elevation.gainMeters).toBe(0);
    expect(telemetry.elevation.lossMeters).toBe(0);
  });
});

describe("resume after a pause", () => {
  const trace = new Trace()
    .fix({ deviceSpeedMps: 0, altitude: 100 })
    .ride(60, 30 * MPH, { altitude: () => 100 })
    .pause(300_000)
    .teleport(500) // pushed the bike across the lot while paused
    .fix({ deviceSpeedMps: 0, altitude: 180 })
    .ride(60, 30 * MPH, { altitude: () => 180 });
  const telemetry = telemetryOf(trace);

  it("credits no time, distance or climb across the pause", () => {
    expect(telemetry.movingMs).toBe(120_000);
    expect(telemetry.acceptedDistanceMeters).toBeCloseTo(120 * 30 * MPH, -1);
    expect(telemetry.elevation.gainMeters).toBe(0);
    expectConsistentAverage(telemetry);
    expect(mph(movingAverageSpeedMps(telemetry))).toBeCloseTo(30, 0);
  });

  it("restarts 'since stop' at the resume", () => {
    expect(telemetry.movingSinceMs).toBe(START_MS + 60_000 + 300_000);
  });

  it("does not bridge a long GPS gap either, paused or not", () => {
    const gap = telemetryOf(
      new Trace().fix({ deviceSpeedMps: 0 }).ride(30, 30 * MPH).wait(60_000).teleport(800).ride(30, 30 * MPH),
    );
    expect(gap.movingMs).toBeLessThanOrEqual(60_000);
    expect(gap.acceptedDistanceMeters).toBeLessThan(60 * 30 * MPH + 1);
  });
});

describe("the stored sample stays backward compatible", () => {
  it("accepts a point without speed or altitude, and validates them when present", async () => {
    const { isRecordingPosition } = await import("@/domain/recording/types");
    const base = { coordinate: { lon: -75.44, lat: 40.14 }, observedAt: new Date(START_MS).toISOString(), accuracyMeters: 5 };
    expect(isRecordingPosition(base)).toBe(true);
    expect(isRecordingPosition({ ...base, speedMps: 12, altitudeMeters: -12.5, altitudeAccuracyMeters: 3 })).toBe(true);
    expect(isRecordingPosition({ ...base, speedMps: -1 })).toBe(false);
    expect(isRecordingPosition({ ...base, altitudeMeters: Number.NaN })).toBe(false);
    expect(isRecordingPosition({ ...base, altitudeAccuracyMeters: -2 })).toBe(false);
  });
});
