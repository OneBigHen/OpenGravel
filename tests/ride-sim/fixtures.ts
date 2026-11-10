/**
 * Fixture loading for the ride simulation.
 *
 * Two files describe one track:
 *
 * - `tests/fixtures/route-plan/ride-sim/<id>.json` — a normal route-plan
 *   fixture candidate: geometry plus provider instructions. It is the route the
 *   navigation engine is handed, after `buildGuidedNavigationRoute` turns those
 *   instructions into maneuvers.
 * - `tests/fixtures/ride-sim/<id>.json` — the replay track: recorded speed,
 *   sample interval, a noise seed and the anchors the five scenarios need.
 *
 * The files are committed and read synchronously here. No test reaches the
 * network, a route planner or a device.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { Coordinate } from "@/domain/ride/types";
import type { RouteInstruction } from "@/domain/route/types";

export interface RideSimTrackScenarios {
  /** The turn (a geometry vertex) this scenario ignores. */
  readonly missedTurn: {
    readonly instructionIndex: number;
    readonly escapeMeters: number;
  };
  /** A 30 s window with no fixes at all, starting at this route distance. */
  readonly noGps: {
    readonly startMeters: number;
    readonly durationSeconds: number;
  };
  /** A stationary rider, expressed as 1 Hz fixes at one coordinate. */
  readonly stop: {
    readonly startMeters: number;
    readonly durationSeconds: number;
  };
}

export interface RideSimTrack {
  readonly id: string;
  readonly name: string;
  readonly routeFixture: string;
  /** Metres per second the replay rides at. A real gravel pace, not a demo. */
  readonly speedMps: number;
  readonly sampleIntervalMs: number;
  readonly noiseSeed: number;
  readonly scenarios: RideSimTrackScenarios;
}

export interface RideSimRoute {
  readonly geometry: readonly Coordinate[];
  readonly instructions: readonly RouteInstruction[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

export const FIXTURE_ROOT = path.join(process.cwd(), "tests/fixtures");
const TRACK_ROOT = path.join(FIXTURE_ROOT, "ride-sim");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(
  record: Record<string, unknown>,
  field: string,
  file: string,
): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${file}: ${field} must be a finite number`);
  }
  return value;
}

function positiveField(
  record: Record<string, unknown>,
  field: string,
  file: string,
): number {
  const value = numberField(record, field, file);
  if (value <= 0) throw new Error(`${file}: ${field} must be positive`);
  return value;
}

function stringField(
  record: Record<string, unknown>,
  field: string,
  file: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${file}: ${field} must be a non-empty string`);
  }
  return value;
}

function objectField(
  record: Record<string, unknown>,
  field: string,
  file: string,
): Record<string, unknown> {
  const value = record[field];
  if (!isRecord(value)) throw new Error(`${file}: ${field} must be an object`);
  return value;
}

function parseTrack(value: unknown, file: string): RideSimTrack {
  if (!isRecord(value)) throw new Error(`${file}: expected an object`);
  if (value["fixture"] !== true) throw new Error(`${file}: not marked as a fixture`);
  const scenarios = objectField(value, "scenarios", file);
  const missedTurn = objectField(scenarios, "missedTurn", file);
  const noGps = objectField(scenarios, "noGps", file);
  const stop = objectField(scenarios, "stop", file);
  return {
    id: stringField(value, "id", file),
    name: stringField(value, "name", file),
    routeFixture: stringField(value, "routeFixture", file),
    speedMps: positiveField(value, "speedMps", file),
    sampleIntervalMs: positiveField(value, "sampleIntervalMs", file),
    noiseSeed: numberField(value, "noiseSeed", file),
    scenarios: {
      missedTurn: {
        instructionIndex: numberField(missedTurn, "instructionIndex", file),
        escapeMeters: positiveField(missedTurn, "escapeMeters", file),
      },
      noGps: {
        startMeters: numberField(noGps, "startMeters", file),
        durationSeconds: positiveField(noGps, "durationSeconds", file),
      },
      stop: {
        startMeters: numberField(stop, "startMeters", file),
        durationSeconds: positiveField(stop, "durationSeconds", file),
      },
    },
  };
}

/** Every committed replay track, in stable filename order. */
export function loadTracks(): readonly RideSimTrack[] {
  return readdirSync(TRACK_ROOT)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => {
      const file = path.join(TRACK_ROOT, entry);
      return parseTrack(JSON.parse(readFileSync(file, "utf8")) as unknown, file);
    });
}

function parseCoordinate(value: unknown, file: string): Coordinate {
  if (!isRecord(value)) throw new Error(`${file}: a geometry entry is not an object`);
  const lon = value["lon"];
  const lat = value["lat"];
  if (
    typeof lon !== "number" ||
    typeof lat !== "number" ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat)
  ) {
    throw new Error(`${file}: a geometry entry is not a finite lon/lat pair`);
  }
  return { lon, lat };
}

function parseInstruction(value: unknown, file: string): RouteInstruction {
  if (!isRecord(value)) throw new Error(`${file}: an instruction is not an object`);
  const text = stringField(value, "text", file);
  const type = stringField(value, "type", file);
  const distanceMeters = numberField(value, "distanceMeters", file);
  const durationSeconds = numberField(value, "durationSeconds", file);
  const maneuver = value["maneuver"];
  const roadName = value["roadName"];
  const geometryIndex = value["geometryIndex"];
  const exitNumber = value["exitNumber"];
  if (
    maneuver !== undefined &&
    maneuver !== "left" &&
    maneuver !== "right" &&
    maneuver !== "slight-left" &&
    maneuver !== "slight-right" &&
    maneuver !== "straight" &&
    maneuver !== "uturn"
  ) {
    throw new Error(`${file}: unsupported maneuver ${String(maneuver)}`);
  }
  if (roadName !== undefined && typeof roadName !== "string") {
    throw new Error(`${file}: roadName must be a string when present`);
  }
  if (
    geometryIndex !== undefined &&
    (typeof geometryIndex !== "number" || !Number.isSafeInteger(geometryIndex))
  ) {
    throw new Error(`${file}: geometryIndex must be an integer when present`);
  }
  if (
    exitNumber !== undefined &&
    (typeof exitNumber !== "number" || !Number.isSafeInteger(exitNumber))
  ) {
    throw new Error(`${file}: exitNumber must be an integer when present`);
  }
  return {
    text,
    type,
    distanceMeters,
    durationSeconds,
    ...(maneuver === undefined
      ? {}
      : {
          maneuver: maneuver as NonNullable<RouteInstruction["maneuver"]>,
        }),
    ...(roadName === undefined ? {} : { roadName }),
    ...(typeof geometryIndex === "number" ? { geometryIndex } : {}),
    ...(typeof exitNumber === "number" ? { exitNumber } : {}),
  };
}

/** One route-plan fixture, reduced to the candidate fields guidance reads. */
export function loadRoute(routeFixture: string): RideSimRoute {
  const file = path.join(process.cwd(), routeFixture);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed)) throw new Error(`${file}: expected an object`);
  if (parsed["fixture"] !== true) throw new Error(`${file}: not marked as a fixture`);
  const candidates = parsed["candidates"];
  if (!Array.isArray(candidates) || candidates.length !== 1) {
    throw new Error(`${file}: a ride-sim route fixture must hold exactly one candidate`);
  }
  const candidate = candidates[0];
  if (!isRecord(candidate)) throw new Error(`${file}: the candidate is not an object`);
  const geometryValue = candidate["geometry"];
  if (!Array.isArray(geometryValue) || geometryValue.length < 2) {
    throw new Error(`${file}: the candidate needs at least two geometry points`);
  }
  const instructionsValue = candidate["instructions"];
  if (!Array.isArray(instructionsValue)) {
    throw new Error(`${file}: the candidate needs an instructions array`);
  }
  return {
    geometry: geometryValue.map((entry) => parseCoordinate(entry, file)),
    instructions: instructionsValue.map((entry) => parseInstruction(entry, file)),
    distanceMeters: positiveField(candidate, "distanceMeters", file),
    durationSeconds: numberField(candidate, "durationSeconds", file),
  };
}
