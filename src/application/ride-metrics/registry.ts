/**
 * The ride metric registry (RIDE-INSTRUMENT-STRIP §3, §4, §4.1).
 *
 * One canonical ID union, one definition per ID, and one resolver per
 * definition, so mode support and formatting live here rather than in JSX or in
 * parallel switch statements. The union already names every metric the spec
 * plans, so a stored choice never needs another migration when a later slice
 * builds it; `availability: "planned"` marks the ones slice A does not build.
 * A planned metric resolves `unsupported`, is not offered in the picker, and a
 * strip slot holding one shows the mode's default instead (see `strip.ts`).
 *
 * Slice A built what was already credible in VNext: GPS speed and heading
 * (the navigation port withholds both on a stale fix), GPS accuracy, the
 * navigation engine's remaining distance/time/ETA/progress, the mapped speed
 * limit, and the recording's distance and active clock.
 *
 * Slice B (telemetry quality, §6) adds what the filtered recording telemetry
 * now makes honest: moving time, time since the last stop, moving average and
 * max speed, and elevation gain/loss, all from `domain/recording/telemetry`;
 * and the current GPS altitude. The recording-backed ones need a recording
 * (`needsRecording`): a guided ride that records shows them, one that does
 * not is offered none of them. Elevation resolves as waiting — a dash, never
 * a fake 0 — on a device that reports no altitude.
 *
 * Free Ride live telemetry: a Free Ride that is not recording folds its fixes
 * into the same accumulator, kept durably with the session
 * (`application/ride-session/free-ride-telemetry`). Moving time, since stop,
 * average and max speed, and elevation gain and loss (`freeRideTelemetry`)
 * read it there.
 */

import { METERS_PER_MILE } from "@/application/planner/measurements";
import { speedLimitMph } from "@/domain/route/types";
import type { PositionQuality } from "@/domain/ride-session/types";
import type { RecordingSummary } from "@/domain/recording/types";
import { movingAverageSpeedMps, type RecordingTelemetry } from "@/domain/recording/telemetry";

export type RideMetricMode = "guided" | "recording" | "free-ride";

export const RIDE_METRIC_IDS = [
  "speed.current",
  "speed.average",
  "speed.max",
  "distance.recorded",
  "time.recorded",
  "time.moving",
  "time.sinceStop",
  "elevation.current",
  "elevation.gain",
  "elevation.loss",
  "heading",
  "gps.accuracy",
  "route.distanceRemaining",
  "route.timeRemaining",
  "route.eta",
  "route.progress",
  "route.speedLimit",
  "terrain.grade",
  "terrain.climbRemaining",
  "road.surfaceAhead",
  "road.gravelAhead",
  "road.gravelRemaining",
  "road.curvesAhead",
  "context.daylightRemaining",
  "context.smart",
  "motion.lean",
  "motion.tilt",
  "motion.lateralG",
] as const;

export type RideMetricId = (typeof RIDE_METRIC_IDS)[number];

/** Exactly three primary slots, on every screen size (§0, §2.1). */
export const RIDE_METRIC_SLOT_COUNT = 3;

export type RideMetricSlots = readonly [RideMetricId, RideMetricId, RideMetricId];

const METRIC_ID_SET: ReadonlySet<string> = new Set(RIDE_METRIC_IDS);

export function isRideMetricId(value: unknown): value is RideMetricId {
  return typeof value === "string" && METRIC_ID_SET.has(value);
}

export type RideMetricState = "ready" | "waiting" | "stale" | "unsupported";
export type RideMetricQuality = "high" | "medium" | "low";
export type RideMetricSource =
  | "navigation"
  | "recording"
  | "route-evidence"
  | "weather"
  | "astronomy"
  | "device-motion"
  | "derived";
export type RideMetricCategory = "ride" | "route" | "terrain" | "context" | "motion" | "diagnostic";
/**
 * Where a live sample sits in its freshness window (§4.1): `current` inside
 * the live window, `held` shown but marked stale, `expired` past the hold and
 * shown as `—`. `null` for values that do not age (route answers, aggregates).
 */
export type RideMetricFreshness = "current" | "held" | "expired";

export interface RideMetricReading {
  readonly id: RideMetricId;
  readonly label: string;
  /** The value only ("47", "18.2", "—"); the unit is separate so it can be set small. */
  readonly displayValue: string;
  readonly unit: string | null;
  readonly rawValue: number | string | null;
  readonly state: RideMetricState;
  readonly quality: RideMetricQuality | null;
  /** Epoch ms of the sample the value came from, when it has one. */
  readonly sampledAt: number | null;
  /** Epoch ms after which a held value is no longer shown. */
  readonly expiresAt: number | null;
  readonly source: RideMetricSource;
  /** Spoken form of the value and any degraded state ("47 miles per hour"). */
  readonly accessibleDetail: string;
  readonly freshness: RideMetricFreshness | null;
}

/** The value shown for anything unavailable: a dash, never a fake zero (§2.1). */
export const NO_VALUE = "—";

/**
 * Freshness, centralized (§4.1). A live GPS value is current up to
 * `stalesAfterMs`, held (marked stale) until `expiresAfterMs`, then `—`.
 */
export const METRIC_FRESHNESS = {
  gps: { stalesAfterMs: 5_000, expiresAfterMs: 15_000 },
} as const;

export type FreshnessPolicy = { readonly stalesAfterMs: number; readonly expiresAfterMs: number };

/** The one freshness rule: current, then held as stale, then expired. */
export function freshnessOf(ageMs: number, policy: FreshnessPolicy = METRIC_FRESHNESS.gps): RideMetricFreshness {
  if (ageMs > policy.expiresAfterMs) return "expired";
  return ageMs > policy.stalesAfterMs ? "held" : "current";
}

/** Altitude with a vertical accuracy worse than this is not shown (§6.4). */
export const MAX_SHOWN_ALTITUDE_ACCURACY_METERS = 25;

/** Moving lock (§2.2): a fresh speed above this means the rider is moving. */
export const MOVING_SPEED_MPS = 5 * (METERS_PER_MILE / 3600);

const FEET_PER_METER = 3.280839895;
const MPH_PER_MPS = 3600 / METERS_PER_MILE;
const KMH_PER_MPS = 3.6;

export type UnitPreference = "imperial" | "metric";

/** Everything a resolver may read. Built once per frame by `strip.ts`. */
export interface RideMetricContext {
  readonly mode: RideMetricMode;
  readonly units: UnitPreference;
  readonly nowMs: number;
  readonly position: {
    readonly quality: PositionQuality;
    /** Already `null` for a stale fix: the navigation port withholds it. */
    readonly speedMps: number | null;
    readonly headingDegrees: number | null;
    readonly accuracyMeters: number | null;
    /** Epoch ms of the fix, or `null` without one. */
    readonly observedAtMs: number | null;
    /** Device altitude in metres; `null`/absent when the device reports none or the fix is stale. */
    readonly altitudeMeters?: number | null;
    readonly altitudeAccuracyMeters?: number | null;
  };
  /** The ride is paused: a paused rider is stopped. */
  readonly paused?: boolean;
  /** `null` on a route-free ride; `answer` is `null` until the engine answers. */
  readonly route: {
    readonly answer: {
      readonly routeProgress: number | null;
      readonly remainingDistanceMeters: number | null;
      readonly remainingDurationSeconds: number | null;
      readonly etaIso: string | null;
      readonly speedLimitKmh?: number | null;
    } | null;
  } | null;
  /**
   * `null` when this ride records nothing; `summary` is `null` before the first
   * fix. `telemetry` is the filtered view of the same points (§6).
   */
  readonly recording: {
    readonly summary: RecordingSummary | null;
    readonly telemetry?: RecordingTelemetry | null;
  } | null;
  /**
   * A Free Ride's live telemetry: the same fold as a recording's, over the
   * session's fixes, with no stored track. Absent when the ride has no such
   * source; read only in Free Ride, by metrics marked `freeRideTelemetry`.
   */
  readonly liveTelemetry?: RecordingTelemetry | null;
}

export interface RideMetricDefinition {
  readonly id: RideMetricId;
  /** Picker and accessible label ("Distance left"). */
  readonly label: string;
  /** The one-line strip caption ("Dist left"). */
  readonly shortLabel: string;
  readonly modes: readonly RideMetricMode[];
  readonly category: RideMetricCategory;
  readonly availability: "live" | "planned";
  /** Reads the recording's filtered telemetry, so it is shown only on a ride that records. */
  readonly needsRecording?: boolean;
  /** In Free Ride, a `needsRecording` metric that reads the ride's live telemetry instead. */
  readonly freeRideTelemetry?: boolean;
  resolve(context: RideMetricContext): RideMetricReading;
}

// ---- Formatting: one formatter, honoring units ---------------------------

const SPOKEN_UNITS: Readonly<Record<string, string>> = {
  mph: "miles per hour",
  "km/h": "kilometres per hour",
  mi: "miles",
  km: "kilometres",
  ft: "feet",
  m: "metres",
  min: "minutes",
  h: "hours",
  "%": "percent",
  AM: "AM",
  PM: "PM",
};

function spoken(displayValue: string, unit: string | null): string {
  if (displayValue === NO_VALUE) return "unavailable";
  const value = displayValue.replace(/^±/, "plus or minus ");
  if (unit === "h") {
    const [hours, minutes] = displayValue.split(":");
    return `${Number(hours)} ${Number(hours) === 1 ? "hour" : "hours"} ${Number(minutes)} minutes`;
  }
  return unit === null ? value : `${value} ${SPOKEN_UNITS[unit] ?? unit}`;
}

function speedParts(mps: number, units: UnitPreference): { value: string; unit: string } {
  return units === "metric"
    ? { value: String(Math.round(mps * KMH_PER_MPS)), unit: "km/h" }
    : { value: String(Math.round(mps * MPH_PER_MPS)), unit: "mph" };
}

/** Sub-10 values keep one decimal, like the planner's `formatDistance`. */
function distanceParts(meters: number, units: UnitPreference): { value: string; unit: string } {
  const amount = units === "metric" ? meters / 1000 : meters / METERS_PER_MILE;
  const value = amount >= 10 ? String(Math.round(amount)) : amount.toFixed(1);
  return { value, unit: units === "metric" ? "km" : "mi" };
}

/** `1560 → 26 min`, `6480 → 1:48 h`: compact enough for a slot. */
function durationParts(seconds: number): { value: string; unit: string } {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return { value: String(totalMinutes), unit: "min" };
  const hours = Math.floor(totalMinutes / 60);
  return { value: `${hours}:${String(totalMinutes % 60).padStart(2, "0")}`, unit: "h" };
}

/** A running clock: `12:05`, `1:02:33`. */
function clockText(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = String(value % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function arrivalParts(iso: string): { value: string; unit: string | null } | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).formatToParts(new Date(parsed));
  const period = parts.find((part) => part.type === "dayPeriod")?.value ?? null;
  const value = parts
    .filter((part) => part.type === "hour" || part.type === "minute" || part.type === "literal")
    .map((part) => part.value)
    .join("")
    .trim();
  return { value, unit: period };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function known(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0;
}

// ---- Readings -------------------------------------------------------------

interface ReadingBase {
  readonly id: RideMetricId;
  readonly label: string;
  readonly source: RideMetricSource;
}

function unsupported(base: ReadingBase, why: string): RideMetricReading {
  return {
    ...base,
    displayValue: NO_VALUE,
    unit: null,
    rawValue: null,
    state: "unsupported",
    quality: null,
    sampledAt: null,
    expiresAt: null,
    accessibleDetail: why,
    freshness: null,
  };
}

function waiting(base: ReadingBase, why: string): RideMetricReading {
  return { ...unsupported(base, why), state: "waiting" };
}

function ready(
  base: ReadingBase,
  value: { readonly value: string; readonly unit: string | null },
  rawValue: number | string,
  extra: Partial<Pick<RideMetricReading, "quality" | "sampledAt" | "expiresAt" | "freshness">> = {},
): RideMetricReading {
  return {
    ...base,
    displayValue: value.value,
    unit: value.unit,
    rawValue,
    state: "ready",
    quality: extra.quality ?? "high",
    sampledAt: extra.sampledAt ?? null,
    expiresAt: extra.expiresAt ?? null,
    accessibleDetail: spoken(value.value, value.unit),
    freshness: extra.freshness ?? null,
  };
}

function secondsText(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

/** An expired live value: a dash, and the spoken reason says how long it has been gone (§4.1). */
function expired(base: ReadingBase, sampledAt: number, ageMs: number, what = "GPS"): RideMetricReading {
  return {
    ...waiting(base, `unavailable, no ${what} reading for ${secondsText(ageMs)}`),
    state: "stale",
    sampledAt,
    expiresAt: sampledAt + METRIC_FRESHNESS.gps.expiresAfterMs,
    freshness: "expired",
  };
}

/** A held live value: still shown, marked stale, and the spoken form says how old it is. */
function held(reading: RideMetricReading, ageMs: number): RideMetricReading {
  return {
    ...reading,
    state: "stale",
    quality: "low",
    freshness: "held",
    accessibleDetail: `${reading.accessibleDetail}, last reading ${secondsText(ageMs)} ago`,
  };
}

/**
 * A GPS-sampled value under the §4.1 policy: current, then held as stale, then
 * `—`. A value the port already withheld (`null`) is waiting or stale, never 0.
 */
function gpsReading(
  base: ReadingBase,
  context: RideMetricContext,
  raw: number | null,
  format: (raw: number) => { value: string; unit: string | null },
  missing = "this device has not reported it yet",
): RideMetricReading {
  const { position, nowMs } = context;
  const sampledAt = position.observedAtMs;
  if (sampledAt === null) return waiting(base, "waiting for a GPS fix");
  const age = Math.max(0, nowMs - sampledAt);
  const freshness = freshnessOf(age);
  const expiresAt = sampledAt + METRIC_FRESHNESS.gps.expiresAfterMs;
  if (freshness === "expired" || position.quality === "stale") return expired(base, sampledAt, age);
  if (raw === null || !Number.isFinite(raw)) return waiting(base, missing);
  const reading = ready(base, format(raw), raw, {
    quality: position.quality === "fresh-good" ? "high" : "medium",
    sampledAt,
    expiresAt,
    freshness,
  });
  return freshness === "held" ? held(reading, age) : reading;
}

function routeAnswer(
  base: ReadingBase,
  context: RideMetricContext,
  pick: (answer: NonNullable<NonNullable<RideMetricContext["route"]>["answer"]>) => RideMetricReading | null,
): RideMetricReading {
  if (context.route === null) return unsupported(base, "this ride has no route");
  const answer = context.route.answer;
  if (answer === null) {
    return positionStale(context)
      ? { ...waiting(base, "GPS is stale"), state: "stale" }
      : waiting(base, "waiting for your place on the route");
  }
  return pick(answer) ?? waiting(base, "waiting for your place on the route");
}

function positionStale(context: RideMetricContext): boolean {
  return context.position.quality === "stale";
}

function recordingSummary(
  base: ReadingBase,
  context: RideMetricContext,
  pick: (summary: RecordingSummary) => RideMetricReading,
): RideMetricReading {
  if (context.recording === null) return unsupported(base, "this ride is not being recorded");
  const summary = context.recording.summary;
  if (summary === null || summary.pointCount === 0) return waiting(base, "waiting for the first GPS fix");
  return pick(summary);
}

/** A metric read from filtered telemetry (§6): the recording's, or a Free Ride's live fold. */
function recordingTelemetry(
  base: ReadingBase,
  context: RideMetricContext,
  pick: (telemetry: RecordingTelemetry) => RideMetricReading,
): RideMetricReading {
  const read = (telemetry: RecordingTelemetry | null): RideMetricReading =>
    telemetry === null || telemetry.lastSampleAtMs === null
      ? waiting(base, "waiting for a credible GPS fix")
      : pick(telemetry);
  if (context.recording === null && liveTelemetryReadable(context)) return read(context.liveTelemetry ?? null);
  return recordingSummary(base, context, () => read(context.recording?.telemetry ?? null));
}

/** A Free Ride with a live telemetry source (not recording: a recording is the source then). */
function liveTelemetryReadable(context: RideMetricContext): boolean {
  return context.mode === "free-ride" && context.recording === null && context.liveTelemetry !== undefined;
}

function elevationParts(meters: number, units: UnitPreference): { value: string; unit: string } {
  return units === "metric"
    ? { value: String(Math.round(meters)), unit: "m" }
    : { value: String(Math.round(meters * FEET_PER_METER)), unit: "ft" };
}

function clockReading(base: ReadingBase, seconds: number, spokenSuffix: string): RideMetricReading {
  const reading = ready(base, { value: clockText(seconds), unit: null }, seconds);
  const minutes = Math.floor(seconds / 60);
  return { ...reading, accessibleDetail: `${minutes} ${minutes === 1 ? "minute" : "minutes"} ${spokenSuffix}` };
}

// ---- Definitions ----------------------------------------------------------

const ALL_MODES: readonly RideMetricMode[] = ["guided", "recording", "free-ride"];
const RECORDING_MODES: readonly RideMetricMode[] = ["recording"];
const GUIDED: readonly RideMetricMode[] = ["guided"];
/** Recording-backed, and in Free Ride backed by its live telemetry (see `freeRideTelemetry`). */
const MOVEMENT_MODES: readonly RideMetricMode[] = ["guided", "recording", "free-ride"];

type LiveSpec = Omit<RideMetricDefinition, "availability" | "resolve"> & {
  readonly source: RideMetricSource;
  resolve(base: ReadingBase, context: RideMetricContext): RideMetricReading;
};

function live(spec: LiveSpec): RideMetricDefinition {
  const { source, resolve, ...definition } = spec;
  return {
    ...definition,
    availability: "live",
    resolve(context) {
      const base = { id: spec.id, label: spec.label, source };
      if (!spec.modes.includes(context.mode)) return unsupported(base, "not available on this kind of ride");
      const liveSource = spec.freeRideTelemetry === true && liveTelemetryReadable(context);
      if (spec.needsRecording === true && context.recording === null && !liveSource) {
        return unsupported(base, "this ride is not being recorded");
      }
      return resolve(base, context);
    },
  };
}

function planned(
  id: RideMetricId,
  label: string,
  shortLabel: string,
  category: RideMetricCategory,
  source: RideMetricSource,
  modes: readonly RideMetricMode[] = ALL_MODES,
): RideMetricDefinition {
  return {
    id,
    label,
    shortLabel,
    modes,
    category,
    availability: "planned",
    resolve: () => unsupported({ id, label, source }, "not available yet"),
  };
}

const DEFINITIONS: readonly RideMetricDefinition[] = [
  live({
    id: "speed.current",
    label: "Speed",
    shortLabel: "Speed",
    modes: ALL_MODES,
    category: "ride",
    source: "navigation",
    resolve: (base, context) =>
      gpsReading(base, context, context.position.speedMps, (mps) => speedParts(mps, context.units)),
  }),
  live({
    id: "heading",
    label: "Heading",
    shortLabel: "Heading",
    modes: ALL_MODES,
    category: "ride",
    source: "navigation",
    resolve: (base, context) =>
      gpsReading(base, context, context.position.headingDegrees, (degrees) => {
        const normalized = ((degrees % 360) + 360) % 360;
        return { value: COMPASS[Math.round(normalized / 45) % COMPASS.length] ?? NO_VALUE, unit: null };
      }),
  }),
  live({
    id: "gps.accuracy",
    label: "GPS accuracy",
    shortLabel: "GPS",
    modes: ALL_MODES,
    category: "diagnostic",
    source: "navigation",
    resolve: (base, context) =>
      gpsReading(base, context, context.position.accuracyMeters, (meters) =>
        context.units === "metric"
          ? { value: `±${Math.round(meters)}`, unit: "m" }
          : { value: `±${Math.round(meters * FEET_PER_METER)}`, unit: "ft" },
      ),
  }),
  live({
    id: "distance.recorded",
    label: "Distance",
    shortLabel: "Distance",
    modes: RECORDING_MODES,
    category: "ride",
    source: "recording",
    resolve: (base, context) =>
      recordingSummary(base, context, (summary) =>
        ready(base, distanceParts(summary.distanceMeters, context.units), summary.distanceMeters),
      ),
  }),
  live({
    id: "time.recorded",
    label: "Rec time",
    shortLabel: "Rec time",
    modes: RECORDING_MODES,
    category: "ride",
    source: "recording",
    // The active recording clock: wall time between accepted fixes less pauses.
    resolve: (base, context) =>
      recordingSummary(base, context, (summary) => {
        const reading = ready(base, { value: clockText(summary.movingSeconds), unit: null }, summary.movingSeconds);
        const minutes = Math.floor(summary.movingSeconds / 60);
        return { ...reading, accessibleDetail: `${minutes} ${minutes === 1 ? "minute" : "minutes"} recorded` };
      }),
  }),
  live({
    id: "route.distanceRemaining",
    label: "Distance left",
    shortLabel: "Dist left",
    modes: GUIDED,
    category: "route",
    source: "navigation",
    resolve: (base, context) =>
      routeAnswer(base, context, (answer) =>
        known(answer.remainingDistanceMeters)
          ? ready(base, distanceParts(answer.remainingDistanceMeters, context.units), answer.remainingDistanceMeters)
          : null,
      ),
  }),
  live({
    id: "route.timeRemaining",
    label: "Time left",
    shortLabel: "Time left",
    modes: GUIDED,
    category: "route",
    source: "navigation",
    resolve: (base, context) =>
      routeAnswer(base, context, (answer) =>
        known(answer.remainingDurationSeconds)
          ? ready(base, durationParts(answer.remainingDurationSeconds), answer.remainingDurationSeconds)
          : null,
      ),
  }),
  live({
    id: "route.eta",
    label: "Arrival",
    shortLabel: "Arrive",
    modes: GUIDED,
    category: "route",
    source: "navigation",
    resolve: (base, context) =>
      routeAnswer(base, context, (answer) => {
        if (answer.etaIso === null) return null;
        const parts = arrivalParts(answer.etaIso);
        return parts === null ? null : ready(base, parts, answer.etaIso);
      }),
  }),
  live({
    id: "route.progress",
    label: "Progress",
    shortLabel: "Progress",
    modes: GUIDED,
    category: "route",
    source: "navigation",
    resolve: (base, context) =>
      routeAnswer(base, context, (answer) => {
        const fraction = answer.routeProgress;
        if (fraction === null || !Number.isFinite(fraction)) return null;
        const clamped = Math.min(1, Math.max(0, fraction));
        return ready(base, { value: String(Math.round(clamped * 100)), unit: "%" }, clamped);
      }),
  }),
  live({
    id: "route.speedLimit",
    label: "Speed limit",
    shortLabel: "Limit",
    modes: GUIDED,
    category: "route",
    source: "route-evidence",
    resolve: (base, context) =>
      routeAnswer(base, context, (answer) => {
        const kmh = answer.speedLimitKmh ?? null;
        if (kmh === null || !(kmh > 0)) {
          // Most roads have no mapped limit; that is a known absence, not a wait.
          return { ...waiting(base, "no posted limit is mapped here"), quality: null };
        }
        return context.units === "metric"
          ? ready(base, { value: String(Math.round(kmh)), unit: "km/h" }, kmh)
          : ready(base, { value: String(speedLimitMph(kmh)), unit: "mph" }, kmh);
      }),
  }),
  live({
    id: "time.moving",
    label: "Moving time",
    shortLabel: "Moving",
    modes: MOVEMENT_MODES,
    needsRecording: true,
    freeRideTelemetry: true,
    category: "ride",
    source: "derived",
    // Only time the movement classifier credits as moving (§6.3); stops and pauses are left out.
    resolve: (base, context) =>
      recordingTelemetry(base, context, (telemetry) => clockReading(base, Math.floor(telemetry.movingMs / 1000), "moving")),
  }),
  live({
    id: "time.sinceStop",
    label: "Since stop",
    shortLabel: "Since stop",
    modes: MOVEMENT_MODES,
    needsRecording: true,
    freeRideTelemetry: true,
    category: "ride",
    source: "derived",
    // A running clock from the start of the current moving stretch; a true zero while stopped or paused.
    resolve: (base, context) =>
      recordingTelemetry(base, context, (telemetry) => {
        if (context.paused === true) {
          return { ...clockReading(base, 0, "since the last stop"), accessibleDetail: "stopped, the ride is paused" };
        }
        if (telemetry.movement === "stopped" || telemetry.movingSinceMs === null) {
          return { ...clockReading(base, 0, "since the last stop"), accessibleDetail: "stopped" };
        }
        const sampledAt = telemetry.lastSampleAtMs ?? telemetry.movingSinceMs;
        const age = Math.max(0, context.nowMs - sampledAt);
        const freshness = freshnessOf(age);
        if (freshness === "expired") return expired(base, sampledAt, age);
        // A held clock stops at the last fix: it cannot know the rider kept moving.
        const until = freshness === "current" ? context.nowMs : sampledAt;
        const reading = {
          ...clockReading(base, Math.floor(Math.max(0, until - telemetry.movingSinceMs) / 1000), "since the last stop"),
          sampledAt,
          expiresAt: sampledAt + METRIC_FRESHNESS.gps.expiresAfterMs,
          freshness,
        };
        return freshness === "held" ? held(reading, age) : reading;
      }),
  }),
  live({
    id: "speed.average",
    label: "Avg speed",
    shortLabel: "Avg speed",
    modes: MOVEMENT_MODES,
    needsRecording: true,
    freeRideTelemetry: true,
    category: "ride",
    source: "recording",
    // Moving average = accepted distance ÷ moving time (§6.2). Not a mean of GPS samples.
    resolve: (base, context) =>
      recordingTelemetry(base, context, (telemetry) => {
        const average = movingAverageSpeedMps(telemetry);
        if (average === null) return waiting(base, "not enough moving time yet");
        const reading = ready(base, speedParts(average, context.units), average);
        return { ...reading, accessibleDetail: `${reading.accessibleDetail} while moving` };
      }),
  }),
  live({
    id: "speed.max",
    label: "Max speed",
    shortLabel: "Max speed",
    modes: MOVEMENT_MODES,
    needsRecording: true,
    freeRideTelemetry: true,
    category: "ride",
    source: "recording",
    // From filtered samples only: a one-sample spike never sets it (§6.1).
    resolve: (base, context) =>
      recordingTelemetry(base, context, (telemetry) =>
        telemetry.maxSpeedMps === null
          ? waiting(base, "no sustained speed recorded yet")
          : ready(base, speedParts(telemetry.maxSpeedMps, context.units), telemetry.maxSpeedMps),
      ),
  }),
  live({
    id: "elevation.current",
    label: "Elevation",
    shortLabel: "Elevation",
    modes: ALL_MODES,
    category: "terrain",
    source: "navigation",
    // GPS altitude under the GPS freshness policy; too uncertain or absent is a dash, never 0.
    resolve: (base, context) => {
      const altitude = context.position.altitudeMeters ?? null;
      const accuracy = context.position.altitudeAccuracyMeters ?? null;
      const usable = accuracy === null || accuracy <= MAX_SHOWN_ALTITUDE_ACCURACY_METERS ? altitude : null;
      const missing = altitude === null ? "this device reports no altitude" : "altitude is too uncertain";
      return gpsReading(base, context, usable, (meters) => elevationParts(meters, context.units), missing);
    },
  }),
  live({
    id: "elevation.gain",
    label: "Gain",
    shortLabel: "Gain",
    modes: MOVEMENT_MODES,
    needsRecording: true,
    freeRideTelemetry: true,
    category: "terrain",
    source: "recording",
    resolve: (base, context) =>
      recordingTelemetry(base, context, (telemetry) =>
        telemetry.elevation.sampleCount === 0
          ? waiting(base, "this device reports no altitude")
          : ready(base, elevationParts(telemetry.elevation.gainMeters, context.units), telemetry.elevation.gainMeters),
      ),
  }),
  live({
    id: "elevation.loss",
    label: "Loss",
    shortLabel: "Loss",
    modes: MOVEMENT_MODES,
    needsRecording: true,
    freeRideTelemetry: true,
    category: "terrain",
    source: "recording",
    resolve: (base, context) =>
      recordingTelemetry(base, context, (telemetry) =>
        telemetry.elevation.sampleCount === 0
          ? waiting(base, "this device reports no altitude")
          : ready(base, elevationParts(telemetry.elevation.lossMeters, context.units), telemetry.elevation.lossMeters),
      ),
  }),
  planned("terrain.grade", "Grade", "Grade", "terrain", "route-evidence", GUIDED),
  planned("terrain.climbRemaining", "Climb left", "Climb left", "terrain", "route-evidence", GUIDED),
  planned("road.surfaceAhead", "Surface ahead", "Surface", "route", "route-evidence", GUIDED),
  planned("road.gravelAhead", "Gravel ahead", "Gravel", "route", "route-evidence", GUIDED),
  planned("road.gravelRemaining", "Gravel left", "Gravel left", "route", "route-evidence", GUIDED),
  planned("road.curvesAhead", "Curves ahead", "Curves", "route", "route-evidence", GUIDED),
  planned("context.daylightRemaining", "Daylight", "Daylight", "context", "astronomy"),
  planned("context.smart", "Smart", "Smart", "context", "derived"),
  planned("motion.lean", "Lean β", "Lean β", "motion", "device-motion"),
  planned("motion.tilt", "Tilt β", "Tilt β", "motion", "device-motion"),
  planned("motion.lateralG", "Lateral G β", "Lat G β", "motion", "device-motion"),
];

export const RIDE_METRIC_REGISTRY: Readonly<Record<RideMetricId, RideMetricDefinition>> = Object.fromEntries(
  DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<RideMetricId, RideMetricDefinition>;

/** What the ride has beyond its mode. Absent: a recording exactly when the mode is Record. */
export interface RideMetricSources {
  readonly recording: boolean;
  /** A Free Ride's durable live telemetry; absent means none. */
  readonly liveTelemetry?: boolean;
}

function sourcesFor(mode: RideMetricMode, sources?: RideMetricSources): RideMetricSources {
  return sources ?? { recording: mode === "recording" };
}

/** Whether a metric can fill a slot in this mode (and on this ride's sources) today. */
export function metricAvailable(id: RideMetricId, mode: RideMetricMode, sources?: RideMetricSources): boolean {
  const definition = RIDE_METRIC_REGISTRY[id];
  if (definition.availability !== "live" || !definition.modes.includes(mode)) return false;
  if (definition.needsRecording !== true) return true;
  const available = sourcesFor(mode, sources);
  if (available.recording) return true;
  return mode === "free-ride" && definition.freeRideTelemetry === true && available.liveTelemetry === true;
}

export function resolveRideMetric(id: RideMetricId, context: RideMetricContext): RideMetricReading {
  return RIDE_METRIC_REGISTRY[id].resolve(context);
}

// ---- Defaults and presets (§2.1, §2.3) ------------------------------------

/**
 * Mode defaults.
 *
 * - Record (slice B): Speed · Distance · Moving time. The spec's example is
 *   Speed · Elevation · Rec time, but altitude is absent on many devices, so a
 *   default elevation slot would often be a dash; moving time is now filtered
 *   and honest everywhere. A stored Record layout is kept as stored.
 * - Free Ride keeps Speed · Heading · GPS. Speed is now real on devices that
 *   report none (derived from credible fixes). Moving time, since stop,
 *   average and max speed are offered from its live telemetry but not put in
 *   the default: a stored choice is the rider's, and the defaults stay the
 *   instruments that work from the very first fix.
 */
const MODE_DEFAULTS: Readonly<Record<RideMetricMode, RideMetricSlots>> = {
  guided: ["speed.current", "route.distanceRemaining", "route.timeRemaining"],
  recording: ["speed.current", "distance.recorded", "time.moving"],
  "free-ride": ["speed.current", "heading", "gps.accuracy"],
};

export function defaultMetricSlots(mode: RideMetricMode): RideMetricSlots {
  return MODE_DEFAULTS[mode];
}

export type RideMetricPresetId = "navigate" | "explore" | "tour" | "off-road" | "instrument" | "record";

export interface RideMetricPreset {
  readonly id: RideMetricPresetId;
  readonly label: string;
  readonly slots: RideMetricSlots;
}

/** Templates over the three IDs; never persisted as a separate object. */
export const RIDE_METRIC_PRESETS: readonly RideMetricPreset[] = [
  { id: "navigate", label: "Navigate", slots: ["speed.current", "route.distanceRemaining", "route.timeRemaining"] },
  { id: "explore", label: "Explore", slots: ["speed.current", "elevation.current", "context.smart"] },
  { id: "tour", label: "Tour", slots: ["speed.current", "time.moving", "context.daylightRemaining"] },
  { id: "off-road", label: "Off-road", slots: ["speed.current", "terrain.grade", "context.smart"] },
  { id: "instrument", label: "Instrument", slots: ["speed.current", "motion.lean", "heading"] },
  // The Record default (slice B): moving time replaced the active clock.
  { id: "record", label: "Record", slots: ["speed.current", "distance.recorded", "time.moving"] },
];

/** Presets whose every metric this mode can show today; the rest are hidden. */
export function presetsFor(mode: RideMetricMode, sources?: RideMetricSources): readonly RideMetricPreset[] {
  return RIDE_METRIC_PRESETS.filter((preset) => preset.slots.every((id) => metricAvailable(id, mode, sources)));
}

/** The preset the three IDs spell exactly, or `null` for a custom arrangement. */
export function presetMatching(slots: readonly RideMetricId[]): RideMetricPreset | null {
  return RIDE_METRIC_PRESETS.find((preset) => preset.slots.every((id, index) => slots[index] === id)) ?? null;
}

const CATEGORY_LABEL: Readonly<Record<RideMetricCategory, string>> = {
  ride: "Ride",
  route: "Route",
  terrain: "Terrain",
  context: "Context",
  motion: "Motion",
  diagnostic: "GPS",
};

/** The picker's metric list: live metrics for this mode, grouped by category. */
export function metricChoices(
  mode: RideMetricMode,
  sources?: RideMetricSources,
): readonly { readonly category: string; readonly metrics: readonly RideMetricDefinition[] }[] {
  const groups = new Map<RideMetricCategory, RideMetricDefinition[]>();
  for (const definition of DEFINITIONS) {
    if (!metricAvailable(definition.id, mode, sources)) continue;
    const list = groups.get(definition.category) ?? [];
    list.push(definition);
    groups.set(definition.category, list);
  }
  return [...groups].map(([category, metrics]) => ({ category: CATEGORY_LABEL[category], metrics }));
}
