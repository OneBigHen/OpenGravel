/**
 * A fixture position source for the Ride Focus gate and QA capture
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §3, §4; 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * The position pipeline is Task 8.2's, so most of the time there is nothing to
 * produce a fix: the surface correctly shows "No GPS fix" and says that progress
 * and ahead guidance are paused. That is the honest production state, and it is
 * also untestable end to end — a browser gate cannot press a recenter control that
 * is disabled, and a screenshot cannot show a position mark that nothing placed.
 *
 * This adapter walks the resolved route line at a constant fixture speed and
 * emits raw GPS readings through the regular position pipeline. The navigation
 * engine still owns matching, progress, off-route detection, instructions and
 * smoothing. When browser permission is granted it delegates to the real browser
 * source, so emulated GPS and fixture GPS never race each other.
 *
 * It refuses to invent a line: with no resolved route there is nothing to walk,
 * and the source emits nothing rather than a coordinate out of thin air.
 */

import type {
  PositionPermission,
  PositionSource,
  PositionSourceObserver,
  PositionWatch,
  RawPosition,
} from "@/application/ride-session/position-pipeline";
import type { Coordinate } from "@/domain/ride/types";

/** Metres in one degree of latitude (and of longitude at the equator). */
const METERS_PER_DEGREE = 111_320;

/** The fixture's own speed, so the surface's readout is not a fabricated number. */
const FIXTURE_SPEED_MPS = 12;

export interface FixturePositionSourceOptions {
  readonly browserSource: PositionSource;
  /** The line to walk; read through a getter so a late load is picked up. */
  readonly routeLine: () => readonly Coordinate[];
  /** ISO-8601 instant of the observation; defaults to the wall clock. */
  readonly now?: () => string;
  readonly intervalMs?: number;
  readonly accuracyMeters?: number;
  readonly setInterval?: (handler: () => void, ms: number) => number;
  readonly clearInterval?: (handle: number) => void;
}

/** Metres between two coordinates, near enough for a fixture's own step. */
function metersBetween(from: Coordinate, to: Coordinate): number {
  const midLatitude = ((from.lat + to.lat) / 2) * (Math.PI / 180);
  const dx = (to.lon - from.lon) * METERS_PER_DEGREE * Math.cos(midLatitude);
  const dy = (to.lat - from.lat) * METERS_PER_DEGREE;
  return Math.hypot(dx, dy);
}

/** The compass bearing of a segment, for the heading the surface reports. */
function headingBetween(from: Coordinate, to: Coordinate): number {
  const midLatitude = ((from.lat + to.lat) / 2) * (Math.PI / 180);
  const dx = (to.lon - from.lon) * Math.cos(midLatitude);
  const dy = to.lat - from.lat;
  const degrees = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * The point `distance` metres along the line, plus the heading there. Returns
 * `null` for a line that cannot be walked (fewer than two positions, or no
 * length), which is what keeps this source from inventing a position.
 */
function along(
  line: readonly Coordinate[],
  distance: number,
): { readonly coordinate: Coordinate; readonly headingDegrees: number } | null {
  if (line.length < 2) return null;
  let remaining = distance;
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1];
    const to = line[index];
    if (from === undefined || to === undefined) return null;
    const segment = metersBetween(from, to);
    if (segment <= 0) continue;
    if (remaining <= segment) {
      const t = remaining / segment;
      return {
        coordinate: { lon: lerp(from.lon, to.lon, t), lat: lerp(from.lat, to.lat, t) },
        headingDegrees: headingBetween(from, to),
      };
    }
    remaining -= segment;
  }
  const last = line[line.length - 1];
  const previous = line[line.length - 2];
  if (last === undefined || previous === undefined) return null;
  return { coordinate: last, headingDegrees: headingBetween(previous, last) };
}

export function createFixturePositionSource(
  options: FixturePositionSourceOptions,
): PositionSource {
  const {
    browserSource,
    routeLine,
    now = (): string => new Date().toISOString(),
    intervalMs = 1000,
    accuracyMeters = 8,
    setInterval: schedule = (handler, ms): number =>
      globalThis.setInterval(handler, ms) as unknown as number,
    clearInterval: unschedule = (handle): void => {
      globalThis.clearInterval(handle);
    },
  } = options;

  let selectedSource: "browser" | "fixture" | null = null;
  let travelled = 0;

  return {
    async permission(): Promise<Exclude<PositionPermission, "unknown">> {
      let permission: Exclude<PositionPermission, "unknown"> = "prompt";
      try {
        permission = await browserSource.permission();
      } catch {
        // The regular pipeline owns the same honest unavailable state as the
        // browser adapter. Fixture mode only supplies a line when permission is
        // still a prompt; an explicit denial must remain a denial.
      }
      selectedSource = permission === "prompt" ? "fixture" : "browser";
      return permission;
    },

    watch(observer: PositionSourceObserver): PositionWatch {
      if (selectedSource !== "fixture") return browserSource.watch(observer);
      const tick = (): void => {
        const line = routeLine();
        const at = along(line, travelled);
        if (at === null) return;
        travelled += (FIXTURE_SPEED_MPS * intervalMs) / 1000;
        const position: RawPosition = {
          coordinate: at.coordinate,
          observedAt: now(),
          accuracyMeters,
          headingDegrees: at.headingDegrees,
          speedMps: FIXTURE_SPEED_MPS,
        };
        observer.position(position);
      };
      const handle = schedule(tick, intervalMs);
      return { stop: (): void => unschedule(handle) };
    },
  };
}
