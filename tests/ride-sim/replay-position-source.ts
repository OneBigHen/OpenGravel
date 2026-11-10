/**
 * Replay position source for the ride simulation (tests/ride-sim).
 *
 * This is the fixture source from `src/infrastructure/ride/fixture-position-source.ts`
 * pointed at recorded data instead of a live line: it walks a precomputed,
 * timestamped timeline and emits raw GPS readings through the regular position
 * pipeline. The navigation engine still owns smoothing, matching, progress,
 * off-route detection, instructions and speech — nothing here decides guidance.
 *
 * A track is replayed at the speeds it records, never at wall-clock speed: a
 * 25-minute ride is replayed in a few hundred milliseconds while every fix keeps
 * its real `observedAt` instant. That is what lets a scenario contain a 30 s GPS
 * blackout or a 2-minute stop without the test waiting 30 s or 2 minutes.
 *
 * GPS noise is optional and seeded: the same seed and fix index always produce
 * the same offset, so a failure is reproducible rather than a flake.
 */

import type {
  PositionPermission,
  PositionSource,
  PositionSourceObserver,
  PositionWatch,
  RawPosition,
} from "@/application/ride-session/position-pipeline";
import type { Coordinate } from "@/domain/ride/types";

const METERS_PER_DEGREE = 111_320;

/** One timestamped observation the replay source can emit. */
export interface ReplayFix {
  readonly coordinate: Coordinate;
  /** ISO-8601 instant the observation was made in the simulated ride. */
  readonly observedAt: string;
  /** The same instant as epoch milliseconds, for the replay clock. */
  readonly atMs: number;
  /**
   * How far along the ridden path the rider really is. It is never used to
   * judge guidance — the navigation matcher does that from coordinates — only to
   * know when a scenario's own anchors (a missed turn, a stop) were reached.
   */
  readonly intendedDistanceMeters: number;
  readonly accuracyMeters: number;
  readonly headingDegrees: number;
  readonly speedMps: number;
}

export interface ReplayPositionSourceOptions {
  readonly fixes: readonly ReplayFix[];
  /**
   * Optional seeded GPS error. A fix is displaced by a random radius from 0 to
   * `meters` in a random direction, as a real fix's accuracy circle describes.
   */
  readonly noise?: { readonly meters: number; readonly seed: number } | null;
}

export interface ReplayPositionSource extends PositionSource {
  /** The replay clock, always the last emitted fix's instant. */
  nowMs(): number;
  /** Emits every fix in order and drains each one through `onFix`. */
  playEach(onFix?: (fix: ReplayFix, index: number) => Promise<void> | void): Promise<void>;
  /** Number of fixes emitted so far. */
  emitted(): number;
  /** Exactly the coordinates handed to the pipeline, noise included. */
  observations(): readonly Coordinate[];
}

/** Mulberry32: a tiny, deterministic PRNG, enough for a replay's GPS error. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function displaced(
  coordinate: Coordinate,
  meters: number,
  angleRadians: number,
): Coordinate {
  const latitude = (coordinate.lat * Math.PI) / 180;
  const north = Math.cos(angleRadians) * meters;
  const east = Math.sin(angleRadians) * meters;
  return {
    lat: coordinate.lat + north / METERS_PER_DEGREE,
    lon: coordinate.lon + east / (METERS_PER_DEGREE * Math.cos(latitude)),
  };
}

export function createReplayPositionSource(
  options: ReplayPositionSourceOptions,
): ReplayPositionSource {
  const { fixes, noise = null } = options;
  const random = noise === null ? null : seededRandom(noise.seed);
  let observer: PositionSourceObserver | null = null;
  let stopped = false;
  let emitted = 0;
  const observations: Coordinate[] = [];
  const originMs = fixes[0]?.atMs ?? 0;
  let clockMs = originMs - 1_000;

  function emittedPosition(fix: ReplayFix): RawPosition {
    let coordinate = fix.coordinate;
    if (noise !== null && random !== null) {
      const radius = noise.meters * Math.sqrt(random());
      const angle = random() * Math.PI * 2;
      coordinate = displaced(coordinate, radius, angle);
    }
    return {
      coordinate,
      observedAt: fix.observedAt,
      accuracyMeters: Math.max(fix.accuracyMeters, noise?.meters ?? 0),
      headingDegrees: fix.headingDegrees,
      speedMps: fix.speedMps,
    };
  }

  return {
    async permission(): Promise<Exclude<PositionPermission, "unknown">> {
      return "granted";
    },

    watch(next: PositionSourceObserver): PositionWatch {
      observer = next;
      stopped = false;
      return {
        stop: (): void => {
          stopped = true;
        },
      };
    },

    nowMs(): number {
      return clockMs;
    },

    emitted(): number {
      return emitted;
    },

    observations(): readonly Coordinate[] {
      return observations;
    },

    async playEach(
      onFix: (fix: ReplayFix, index: number) => Promise<void> | void = () => undefined,
    ): Promise<void> {
      if (observer === null) throw new Error("the replay source is not being watched");
      for (const [index, fix] of fixes.entries()) {
        if (stopped) return;
        clockMs = fix.atMs;
        const position = emittedPosition(fix);
        observations.push(position.coordinate);
        observer.position(position);
        emitted += 1;
        await onFix(fix, index);
      }
    },
  };
}
