/**
 * Deterministic synthetic GPS traces for the recording telemetry fold
 * (RIDE-INSTRUMENT-STRIP §6, §17.3), shared by the slice B trace tests and the
 * Free Ride live-accumulator parity tests.
 */

import type { RecordingPosition } from "@/domain/recording/types";

export const MPH = 1609.344 / 3600;
export const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;
export const START_MS = Date.parse("2026-09-21T14:00:00.000Z");

/** A deterministic, repeatable "noise" in [-1, 1]. */
export function wobble(index: number, seed = 1): number {
  return Math.sin(index * 12.9898 * seed + seed * 78.233) * 0.999;
}

export interface Step {
  readonly seconds?: number;
  readonly deviceSpeedMps?: number | null;
  readonly accuracy?: number;
  readonly altitude?: number | null;
  readonly altitudeAccuracy?: number;
  /** Where the fix lands relative to the true track (metres east), for jumps and jitter. */
  readonly offsetEastMeters?: number;
  readonly offsetNorthMeters?: number;
}

/**
 * Builds a trace heading north from a fixed origin. `ride` moves the true
 * position; the reported fix can be offset from it (jitter, jumps). One fix
 * per `seconds` (default 1 s).
 */
export class Trace {
  private atMs = START_MS;
  private northMeters = 0;
  private eastMeters = 0;
  private pausedMs = 0;
  private index = 0;
  readonly points: RecordingPosition[] = [];

  fix(step: Step = {}): this {
    const lat = 40.14 + (this.northMeters + (step.offsetNorthMeters ?? 0)) / METERS_PER_DEGREE;
    const lon =
      -75.44 + (this.eastMeters + (step.offsetEastMeters ?? 0)) / (METERS_PER_DEGREE * Math.cos((40.14 * Math.PI) / 180));
    this.points.push({
      coordinate: { lon, lat },
      observedAt: new Date(this.atMs).toISOString(),
      accuracyMeters: step.accuracy ?? 5,
      pausedDurationMs: this.pausedMs,
      ...(step.deviceSpeedMps === undefined || step.deviceSpeedMps === null ? {} : { speedMps: step.deviceSpeedMps }),
      ...(step.altitude === undefined || step.altitude === null ? {} : { altitudeMeters: step.altitude }),
      ...(step.altitudeAccuracy === undefined ? {} : { altitudeAccuracyMeters: step.altitudeAccuracy }),
    });
    this.index += 1;
    return this;
  }

  /** `seconds` of riding at `speedMps`, one fix per second after each step. */
  ride(
    seconds: number,
    speedMps: number,
    options: {
      readonly device?: boolean;
      readonly altitude?: (index: number, second: number) => number | null;
      readonly each?: (second: number) => Step;
    } = {},
  ): this {
    for (let second = 1; second <= seconds; second += 1) {
      this.atMs += 1_000;
      this.northMeters += speedMps;
      const extra = options.each?.(second) ?? {};
      this.fix({
        deviceSpeedMps: options.device === false ? null : speedMps,
        altitude: options.altitude?.(this.index, second) ?? null,
        ...extra,
      });
    }
    return this;
  }

  /** Standing still with GPS jitter (a few metres, inside the accuracy) and a noisy near-zero device speed. */
  stop(seconds: number, options: { readonly device?: boolean; readonly spikeEvery?: number; readonly altitude?: number } = {}): this {
    for (let second = 1; second <= seconds; second += 1) {
      this.atMs += 1_000;
      const spike = options.spikeEvery !== undefined && second % options.spikeEvery === 0;
      this.fix({
        offsetEastMeters: 3 * wobble(this.index, 2),
        offsetNorthMeters: 3 * wobble(this.index, 3),
        accuracy: 8,
        deviceSpeedMps: options.device === false ? null : spike ? 3.5 * MPH : Math.abs(wobble(this.index, 5)) * 1.2 * MPH,
        altitude: options.altitude ?? null,
      });
    }
    return this;
  }

  pause(ms: number): this {
    this.atMs += ms;
    this.pausedMs += ms;
    return this;
  }

  wait(ms: number): this {
    this.atMs += ms;
    return this;
  }

  teleport(northMeters: number): this {
    this.northMeters += northMeters;
    return this;
  }
}

/**
 * Every slice B trace, by name: the recipes `recording-telemetry.test.ts`
 * builds its assertions on, so other folds (the Free Ride live accumulator)
 * can be checked against the batch path on exactly the same traces.
 */
function rideThenBrake(device: boolean): Trace {
  return new Trace()
    .fix({ deviceSpeedMps: 0 })
    .ride(60, 30 * MPH, { device })
    .ride(1, 20 * MPH, { device })
    .ride(1, 10 * MPH, { device });
}

export const SLICE_B_TRACES: Readonly<Record<string, () => Trace>> = {
  "highway (device speed)": () =>
    new Trace().fix({ deviceSpeedMps: 0, altitude: 200 }).ride(600, 65 * MPH, {
      altitude: (index) => 200 + 2 * wobble(index, 7),
      each: (second) => ({ deviceSpeedMps: (65 + wobble(second, 11)) * MPH }),
    }),
  "highway (derived speed)": () => new Trace().fix().ride(600, 65 * MPH, { device: false }),
  "stop-and-go": () =>
    new Trace().fix({ deviceSpeedMps: 0 }).ride(30, 20 * MPH).stop(3).ride(30, 20 * MPH).stop(20).ride(30, 20 * MPH),
  "long stop (device speed)": () => rideThenBrake(true).stop(600, { spikeEvery: 7 }),
  "long stop (derived speed)": () => rideThenBrake(false).stop(600, { device: false }),
  "brief roll between stops": () => new Trace().fix({ deviceSpeedMps: 0 }).stop(30).ride(2, 10 * MPH).stop(30),
  "GPS jump and speed spike": () =>
    new Trace()
      .fix({ deviceSpeedMps: 0 })
      .ride(60, 40 * MPH)
      .ride(1, 40 * MPH, { each: () => ({ offsetEastMeters: 800, deviceSpeedMps: 140 }) })
      .ride(30, 40 * MPH)
      .ride(1, 40 * MPH, { each: () => ({ deviceSpeedMps: 70 }) })
      .ride(30, 40 * MPH),
  "jump while standing": () =>
    new Trace().fix({ deviceSpeedMps: 0 }).stop(10).wait(1_000).fix({ offsetEastMeters: 60, accuracy: 8 }).stop(10),
  "sustained relocation": () => new Trace().fix({ deviceSpeedMps: 0 }).ride(30, 30 * MPH).teleport(2_000).ride(40, 30 * MPH),
  "poor accuracy": () =>
    new Trace().fix({ deviceSpeedMps: 0 }).ride(120, 30 * MPH, {
      each: (second) => (second % 3 === 0 ? { accuracy: 120, offsetEastMeters: 150, deviceSpeedMps: 55 } : {}),
    }),
  "all poor accuracy": () => new Trace().fix({ accuracy: 200 }).ride(60, 30 * MPH, { each: () => ({ accuracy: 200 }) }),
  "missing altitude": () => new Trace().fix().ride(120, 30 * MPH),
  "altitude gap": () =>
    new Trace()
      .fix({ altitude: 100 })
      .ride(60, 20 * MPH, { altitude: () => 100 })
      .ride(90, 20 * MPH)
      .ride(60, 20 * MPH, { altitude: () => 250 }),
  "altitude lapses": () => new Trace().fix({ altitude: 100 }).ride(30, 20 * MPH, { altitude: () => 100 }).ride(40, 20 * MPH),
  "poor altitude accuracy": () =>
    new Trace().fix({ altitude: 100, altitudeAccuracy: 60 }).ride(60, 20 * MPH, {
      altitude: (_index, second) => 100 + second,
      each: () => ({ altitudeAccuracy: 60 }),
    }),
  "altitude stair-steps and noise": () =>
    new Trace().fix({ altitude: 200 }).ride(600, 25 * MPH, {
      altitude: (index, second) => 200 + (Math.floor(second / 4) % 2 === 0 ? 0 : 2) + 3 * wobble(index, 13),
    }),
  "climb under the deadband": () =>
    new Trace().fix({ altitude: 200 }).ride(120, 20 * MPH, { altitude: (_index, second) => 200 + Math.min(4, second / 10) }),
  "noisy climb and descent": () =>
    new Trace()
      .fix({ altitude: 300 })
      .ride(300, 25 * MPH, { altitude: (index, second) => 300 + second * 0.4 + 3 * wobble(index, 17) })
      .ride(300, 25 * MPH, { altitude: (index, second) => 420 - second * 0.4 + 3 * wobble(index, 19) }),
  "stair-step climb": () =>
    new Trace().fix({ altitude: 0 }).ride(200, 20 * MPH, { altitude: (_index, second) => Math.floor(second / 20) * 10 }),
  "vertical jump": () =>
    new Trace().fix({ altitude: 150 }).ride(60, 30 * MPH, { altitude: (_index, second) => (second === 30 ? 400 : 150) }),
  "resume after a pause": () =>
    new Trace()
      .fix({ deviceSpeedMps: 0, altitude: 100 })
      .ride(60, 30 * MPH, { altitude: () => 100 })
      .pause(300_000)
      .teleport(500)
      .fix({ deviceSpeedMps: 0, altitude: 180 })
      .ride(60, 30 * MPH, { altitude: () => 180 }),
  "long GPS gap": () =>
    new Trace().fix({ deviceSpeedMps: 0 }).ride(30, 30 * MPH).wait(60_000).teleport(800).ride(30, 30 * MPH),
};
