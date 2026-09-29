/**
 * The Ride Focus view model
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §2–§8, §13, §18, §24;
 * 12-DESIGN-SYSTEM-RESPONSIVE-ACCESSIBILITY §4, §15–§17;
 * 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * The surface renders this and nothing else, so every honesty rule the ride
 * surface owes the rider is decided **here**, once, where it can be tested
 * without a browser:
 *
 * - **A road name is never fabricated** (8 §2, §6). `roadName` is the session's
 *   own `instruction.roadName`, trimmed, or `null`. A blank string is `null`,
 *   because an empty road name is not a road called "".
 * - **Stale speed and heading are not shown as current** (8 §4). Both come from
 *   the navigation port, which withholds them for a stale fix; this module
 *   prints the withheld state as absent, never as the last known number and
 *   never as `0`. The stale coordinate *is* still shown — it is the best answer
 *   available and the map needs it — with the age that says what it is.
 * - **Unknown stays unknown** (§2: progress, ETA and remaining distance come
 *   from the 8.2 matching engine). With no answer the surface says so; it does
 *   not print `0 mi`, and it does not draw a progress bar it cannot justify.
 * - **Suspended ahead guidance is respected** (OGV-RID-005): while the session
 *   is not moving, or the fix is stale/unavailable, no ahead content is
 *   produced at all — not dimmed, not greyed, absent — and the reason is stated.
 * - **One sentence for the screen reader and the screen** (12 §17): `label` on a
 *   maneuver is the same words the card shows, so assistive output cannot drift
 *   from what a rider reads.
 *
 * It is deliberately a pure function of its inputs. The only thing it cannot be
 * told is *when* it is being asked — and it does not need to be: freshness
 * arrives already derived by the port's injected clock
 * (`deriveSessionNavigation`), which is why a stored `ageMs` never appears here.
 */

import { rideSummaryStats, type RideSummaryStat } from "@/application/ride-metrics/ride-summary";
import {
  UNKNOWN_VALUE,
  formatDistance,
  formatDuration,
  isKnownMeasurement,
} from "@/application/planner/measurements";
import type { Coordinate } from "@/domain/ride/types";
import { speedLimitMph, type RouteWarning } from "@/domain/route/types";
import type {
  PositionQuality,
  SessionInstruction,
} from "@/domain/ride-session/types";
import type { RecordingSummary } from "@/domain/recording/types";
import type { RecordingTelemetry } from "@/domain/recording/telemetry";
import type { LeanMetricSnapshot } from "@/domain/motion/lean";
import type { RecordingControllerSnapshot } from "./recording-controller";
import type {
  NavigationPosition,
  SessionNavigationState,
} from "@/domain/ride-session/navigation";
import { buildRideMetricStrip, type RideMetricStripModel } from "@/application/ride-metrics/strip";
import { createRiderSettings, type RiderSettings } from "@/application/ride-metrics/rider-settings";
import type {
  LocationPermissionState,
  RideFocusEnvironmentSnapshot,
} from "./ports/ride-focus-environment";

/** Feet per metre; the at-speed unit under a fifth of a mile. */
const FEET_PER_METER = 3.280839895;

/** Metres per second → miles per hour. */
const MPH_PER_MPS = 2.2369362920544;

/** Under this many feet a maneuver distance reads as an immediate action. */
const IMMEDIATE_MANEUVER_METERS = 25;

/** `6480 → "1 h 48 min"`; unknown stays unknown. Shared with the planner. */
export { UNKNOWN_VALUE };

/**
 * How much of an ahead-guidance frame the surface may show (8 §15, OGV-RID-005).
 * `waiting` is "moving with a usable fix and no maneuver issued yet".
 */
export type GuidanceSuspendReason = "not-moving" | "off-route" | "locating" | "gps-stale" | "gps-unavailable";

/** The next maneuver, already reduced to rider copy (8 §2, §6). */
export interface RideFocusManeuver {
  /** "Turn left", "Bear right", "Continue", "Arrive at your stop". */
  readonly actionText: string;
  /** The road the maneuver is onto/on, or `null` when the session did not say. */
  readonly roadName: string | null;
  readonly roadPreposition: "onto" | "on" | null;
  /** "400 ft" | "1.2 mi" | "Now" — the big number on the card (DV-06: never "in now"). */
  readonly distanceText: string;
  readonly distanceMeters: number;
  readonly glyph:
    | "left"
    | "right"
    | "slight-left"
    | "slight-right"
    | "straight"
    | "uturn"
    | "continue"
    | "arrive";
  /** The whole instruction as one sentence: what the visual card also reads. */
  readonly label: string;
}

export type RideFocusGuidance =
  | { readonly kind: "maneuver"; readonly maneuver: RideFocusManeuver }
  | {
      readonly kind: "suspended";
      readonly reason: GuidanceSuspendReason;
      readonly text: string;
    }
  | { readonly kind: "waiting"; readonly text: string };

export interface RideFocusSpeedLimit {
  readonly mph: number;
  /** True when a fresh speed is more than {@link OVER_LIMIT_MPH} over the sign. */
  readonly over: boolean;
}

/** Slack before the speed bubble warns: GPS speed and speedometers disagree. */
export const OVER_LIMIT_MPH = 5;

function speedLimitOf(
  telemetry: RideFocusTelemetryInput | null,
  position: SessionNavigationState["position"],
): RideFocusSpeedLimit | null {
  const kmh = telemetry?.speedLimitKmh ?? null;
  if (kmh === null || !(kmh > 0)) return null;
  const mph = speedLimitMph(kmh);
  const speed = position.quality === "fresh-good" || position.quality === "fresh-poor" ? position.speedMps : null;
  const over = speed !== null && isKnownMeasurement(speed) && speed * MPH_PER_MPS > mph + OVER_LIMIT_MPH;
  return { mph, over };
}

/** The four §4 freshness labels, as rider copy plus a tone for the chrome. */
export interface RideFocusPosition {
  readonly quality: PositionQuality;
  readonly qualityLabel: string;
  readonly tone: "good" | "degraded" | "bad";
  readonly hasCoordinate: boolean;
  /** "updated 3 s ago" (fresh) | "last fix 4 min ago" (stale) | `null`. */
  readonly ageText: string | null;
  readonly accuracyText: string | null;
  /** Present only while the fix is fresh — a stale speed is a claim about now. */
  readonly speedText: string | null;
  readonly headingText: string | null;
}

export interface RideFocusWarning {
  readonly id: string;
  readonly severity: "critical" | "caution";
  readonly text: string;
}

export interface RideFocusProgress {
  /** `null` when the progress matcher has not answered (8 §5). */
  readonly fraction: number | null;
  readonly fractionText: string;
  /** "Stop 2 of 3", from the session's own pending objective; else `null`. */
  readonly stopsText: string | null;
}

export interface RideFocusSecondary {
  readonly etaText: string;
  readonly remainingText: string;
  /** The slim ride strip's three parts (DV-10); `null` when unknown. */
  readonly arrivalText: string | null;
  readonly timeLeftText: string | null;
  readonly distanceLeftText: string | null;
}

export interface RideFocusRecordingHud {
  readonly distanceText: string;
  readonly movingTimeText: string;
  readonly elapsedTimeText: string;
  readonly currentSpeedText: string;
  readonly averageSpeedText: string;
  readonly waitingForFix: boolean;
  readonly saveWarningText: string | null;
  readonly canRetrySave: boolean;
}

/** One control's availability, with the reason it is unavailable. */
export interface RideFocusControl {
  readonly enabled: boolean;
  readonly reason: string | null;
}

export interface RideFocusControls {
  readonly pause: RideFocusControl;
  readonly resume: RideFocusControl;
  readonly recenter: RideFocusControl;
  readonly follow: RideFocusControl;
  readonly finish: RideFocusControl;
  readonly discard: RideFocusControl;
  readonly retryLocation: RideFocusControl;
}

export type RideFocusTerminal =
  | {
      readonly reason: "completed";
      readonly title: string;
      readonly text: string;
      /** The ride in numbers (distance, moving time, speeds, climb); empty for a ride too short to sum up. */
      readonly stats?: readonly RideSummaryStat[];
    }
  | {
      readonly reason: "abandoned";
      readonly title: string;
      readonly text: string;
    };

export interface RideFocusViewModel {
  readonly activity: SessionNavigationState["activity"];
  readonly activityLabel: string;
  /** True while the session is physically moving (8 §1). */
  readonly moving: boolean;
  readonly guidance: RideFocusGuidance;
  readonly position: RideFocusPosition;
  readonly progress: RideFocusProgress;
  readonly secondary: RideFocusSecondary;
  readonly recording: RideFocusRecordingHud | null;
  readonly warnings: readonly RideFocusWarning[];
  readonly controls: RideFocusControls;
  /** Non-`null` only once the ride reached its terminal activity (8 §13). */
  readonly terminal: RideFocusTerminal | null;
  /** The posted limit here, only where OpenStreetMap maps one (NV-04). */
  readonly speedLimit: RideFocusSpeedLimit | null;
  /** The coordinate the map should mark, or `null` when there is none. */
  readonly mapPosition: { readonly coordinate: Coordinate; readonly quality: PositionQuality } | null;
  /** The three-slot instrument strip (RIDE-INSTRUMENT-STRIP §12). */
  readonly metrics: RideMetricStripModel;
}

/**
 * Everything the 8.2 engine will answer and this surface must not invent.
 *
 * `null` is the honest value today: the matching engine is a parallel lane, so
 * the surface says "Unavailable" rather than guessing a position along a line.
 */
export interface RideFocusTelemetryInput {
  /** Progress along the route in `0..1`, as the matcher reported it. */
  readonly routeProgress: number | null;
  readonly remainingDistanceMeters: number | null;
  readonly remainingDurationSeconds: number | null;
  readonly etaIso: string | null;
  /** The posted limit where the matcher places the rider (NV-04); absent = unknown. */
  readonly speedLimitKmh?: number | null;
}

export type RideFocusTelemetryProvider = (now: string) => RideFocusTelemetryInput | null;

export interface RideFocusViewModelInput {
  readonly navigation: SessionNavigationState;
  readonly environment: RideFocusEnvironmentSnapshot;
  /** `null` while the engine has no telemetry yet — not an empty answer. */
  readonly telemetry?: RideFocusTelemetryInput | null;
  /** Streamed trace summary; only present when RideSession references a recording. */
  readonly recordingSummary?: RecordingSummary | null;
  /** The filtered telemetry of that trace (RIDE-INSTRUMENT-STRIP §6), for the strip. */
  readonly recordingTelemetry?: RecordingTelemetry | null;
  /** A Free Ride's live telemetry when it is not recording (§6, §11); absent means none. */
  readonly liveTelemetry?: RecordingTelemetry | null;
  /** The device-motion beta's lean reading (§ motion.lean); absent means no motion source is wired up. */
  readonly lean?: LeanMetricSnapshot | null;
  readonly recordingStatus?: RecordingControllerSnapshot["status"] | null;
  readonly bufferedRecordingPointCount?: number;
  readonly recordingLibraryCommitted?: boolean;
  readonly recordingSourceDeleted?: boolean;
  /** Query instant used for the live moving timer. */
  readonly now?: string;
  /** `null` when the route line does not resolve, or when there is no route. */
  readonly routeGeometry?: readonly Coordinate[] | null;
  /**
   * Route-level cavesats the ride actually carries (closures, weather, surface
   * confidence). Empty when nothing is known — never a fabricated warning.
   */
  readonly routeWarnings?: readonly RouteWarning[];
  /** Whether the map renderer is up; recenter/follow cannot work without it. */
  readonly mapReady?: boolean;
  /** The rider's stored strip choices; absent means the defaults. */
  readonly riderSettings?: Pick<RiderSettings, "units" | "uiPreferences">;
}

/** `1234 → "0.8 mi"`; under a fifth of a mile the at-speed unit is feet. */
export function formatManeuverDistance(meters: number): string {
  if (!isKnownMeasurement(meters)) return UNKNOWN_VALUE;
  if (meters < IMMEDIATE_MANEUVER_METERS) return "now";
  const feet = meters * FEET_PER_METER;
  if (feet < 1000) {
    const rounded = Math.max(50, Math.round(feet / 50) * 50);
    return `${rounded} ft`;
  }
  return formatDistance(meters);
}

/** `8.3 → "19 mph"`; an unknown speed is unknown, never `0`. */
export function formatSpeed(mps: number | null): string | null {
  if (mps === null || !isKnownMeasurement(mps)) return null;
  return `${Math.round(mps * MPH_PER_MPS)} mph`;
}

/** `[N, NE, E, SE, S, SW, W, NW]`, the 8-way reading of a reported heading. */
const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** `212 → "SW"`; a heading the fix did not report is absent, not "N". */
export function formatHeading(degrees: number | null): string | null {
  if (degrees === null || !Number.isFinite(degrees)) return null;
  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % COMPASS_POINTS.length;
  return COMPASS_POINTS[index] ?? null;
}

/** `8300 → "8 s"`, `212000 → "3 min"`; unknown stays unknown. */
export function formatAge(ageMs: number | null): string | null {
  if (ageMs === null || !isKnownMeasurement(ageMs)) return null;
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return formatDuration(minutes * 60);
}

/** `12.4 → "±12 m"`; an unreported accuracy is absent, not a good one. */
function formatAccuracy(meters: number | null): string | null {
  if (meters === null || !isKnownMeasurement(meters)) return null;
  return `±${Math.round(meters)} m`;
}

/** `"   "` is not a road name. */
function roadNameOf(instruction: SessionInstruction): string | null {
  const name = instruction.roadName?.trim() ?? "";
  return name.length === 0 ? null : name;
}

const MANEUVER_ACTION: Readonly<
  Record<NonNullable<SessionInstruction["maneuver"]>, string>
> = {
  left: "Turn left",
  right: "Turn right",
  "slight-left": "Bear left",
  "slight-right": "Bear right",
  straight: "Keep straight",
  uturn: "Make a U-turn",
};

/**
 * The rider sentence for one issued maneuver (8 §6: the domain states the
 * maneuver, the surface owns the sentence — VNX-007). A `turn` always names its
 * direction; a `continue` never claims one.
 */
function maneuverCopy(
  instruction: SessionInstruction,
): { actionText: string; roadPreposition: "onto" | "on" | null } {
  switch (instruction.kind) {
    case "arrive":
      return {
        actionText:
          instruction.targetStopId === null ? "Arrive at your destination" : "Arrive at your stop",
        roadPreposition: null,
      };
    case "continue":
      return { actionText: "Continue", roadPreposition: "on" };
    case "turn": {
      const action =
        instruction.maneuver === null
          ? "Turn"
          : MANEUVER_ACTION[instruction.maneuver] ?? "Turn";
      return { actionText: action, roadPreposition: "onto" };
    }
  }
}

/**
 * The spoken form of an issued maneuver: the banner's own words, as one
 * sentence a rider hears in a helmet ("In 800 feet, turn left onto 1st
 * Avenue."). Units are spelled out, because a speech engine reads "mi" as
 * letters.
 */
export function spokenManeuver(instruction: SessionInstruction): string {
  const copy = maneuverCopy(instruction);
  const roadName = roadNameOf(instruction);
  const road = roadName === null ? "" : ` ${copy.roadPreposition ?? "on"} ${roadName}`;
  const distance = formatManeuverDistance(instruction.distanceMeters);
  if (distance === "now" || distance === UNKNOWN_VALUE) return `${copy.actionText}${road}${distance === "now" ? " now" : ""}.`;
  const spokenDistance = distance
    .replace(/^1 mi$/, "1 mile")
    .replace(/ mi$/, " miles")
    .replace(/ ft$/, " feet");
  const action = copy.actionText.charAt(0).toLowerCase() + copy.actionText.slice(1);
  return `In ${spokenDistance}, ${action}${road}.`;
}

function maneuverOf(instruction: SessionInstruction): RideFocusManeuver {
  const copy = maneuverCopy(instruction);
  const roadName = roadNameOf(instruction);
  const formatted = formatManeuverDistance(instruction.distanceMeters);
  const immediate = formatted === "now";
  const distanceText = immediate ? "Now" : formatted;
  const road = roadName === null ? "" : ` ${copy.roadPreposition ?? "on"} ${roadName}`;
  const distance = immediate ? " now" : formatted === UNKNOWN_VALUE ? "" : ` in ${formatted}`;
  return {
    actionText: copy.actionText,
    roadName,
    roadPreposition: roadName === null ? null : copy.roadPreposition,
    distanceText,
    distanceMeters: instruction.distanceMeters,
    glyph:
      instruction.kind === "arrive"
        ? "arrive"
        : instruction.kind === "continue"
          ? "continue"
          : instruction.maneuver ?? "straight",
    label: `${copy.actionText}${road}${distance}`,
  };
}

function timerText(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function recordingOf(
  navigation: SessionNavigationState,
  position: RideFocusPosition,
  summary: RecordingSummary | null,
  recordingStatus: RecordingControllerSnapshot["status"] | null,
  bufferedPointCount: number,
  libraryCommitted: boolean,
  sourceDeleted: boolean,
): RideFocusRecordingHud | null {
  if (navigation.recordingId === null) return null;
  // RM-02: once the ride ended with the recording in My rides, the terminal
  // "Recorded ride saved" is the whole story; session cleanup is not the rider's.
  const saveWarningText = libraryCommitted && navigation.activity === "completed"
    ? null
    : libraryCommitted
    ? sourceDeleted
      ? "Saved to My rides. Ride Focus is finishing session recovery; use Finish ride to retry."
      : "Saved to My rides. The source trace still needs cleanup; use Finish ride to retry."
    : recordingStatus === "storage-full"
    ? `Device storage is full. ${bufferedPointCount} GPS ${bufferedPointCount === 1 ? "point is" : "points are"} waiting to be saved. Free space, then retry.`
    : recordingStatus === "storage-failed"
      ? "The latest GPS points could not be saved. They remain in a bounded buffer on this device. Retry saving before you leave."
      : recordingStatus === "corrupt"
        ? "This recording has an unreadable section. Its readable points remain stored, but it cannot be resumed or saved as a complete ride. You can discard it."
        : null;
  const canRetrySave = recordingStatus === "storage-full" || recordingStatus === "storage-failed";
  const waitingForFix = summary === null || summary.pointCount === 0;
  if (waitingForFix || summary === null) {
    return {
      distanceText: UNKNOWN_VALUE,
      movingTimeText: "0:00",
      elapsedTimeText: "0:00",
      currentSpeedText: position.speedText ?? "—",
      averageSpeedText: "—",
      waitingForFix: true,
      saveWarningText,
      canRetrySave,
    };
  }
  // Duration and average speed stay aligned to the last accepted fix. Advancing
  // the moving timer from the UI clock would keep counting through a stale-GPS
  // gap, eventually making moving time exceed the trace's total elapsed time.
  const movingSeconds = summary.movingSeconds;
  const averageMps = movingSeconds === 0 ? null : summary.distanceMeters / movingSeconds;
  return {
    distanceText: formatDistance(summary.distanceMeters),
    movingTimeText: timerText(movingSeconds),
    elapsedTimeText: timerText(summary.elapsedSeconds),
    currentSpeedText: position.speedText ?? "—",
    averageSpeedText: averageMps === null ? "—" : (formatSpeed(averageMps) ?? "—"),
    waitingForFix: false,
    saveWarningText,
    canRetrySave,
  };
}

/**
 * The §4 freshness frame. `presentable` is the port's own decision — a stale fix
 * arrives here with `speedMps`/`headingDegrees` already `null`, so nothing in
 * this function has to re-derive or remember the rule.
 */
function positionOf(position: NavigationPosition): RideFocusPosition {
  const age = formatAge(position.ageMs);
  const label: Readonly<Record<PositionQuality, string>> = {
    "fresh-good": "Good GPS fix",
    "fresh-poor": "Weak GPS fix",
    stale: "Stale GPS",
    unavailable: "No GPS fix",
  };
  const tone: Readonly<Record<PositionQuality, "good" | "degraded" | "bad">> = {
    "fresh-good": "good",
    "fresh-poor": "degraded",
    stale: "bad",
    unavailable: "bad",
  };
  const ageText =
    age === null
      ? null
      : position.quality === "stale"
        ? `last fix ${age} ago`
        : `updated ${age} ago`;
  return {
    quality: position.quality,
    qualityLabel: label[position.quality],
    tone: tone[position.quality],
    hasCoordinate: position.coordinate !== null,
    ageText,
    accuracyText: formatAccuracy(position.accuracyMeters),
    speedText: formatSpeed(position.speedMps),
    headingText: formatHeading(position.headingDegrees),
  };
}

function guidanceOf(navigation: SessionNavigationState): RideFocusGuidance {
  if (navigation.aheadGuidanceSuspended) {
    // Name the real cause (UX rework phase 6): a rider who is moving but off
    // the line must not be told the ride is stopped.
    const onRouteActivity = navigation.activity === "guided" || navigation.activity === "track";
    const reason: GuidanceSuspendReason =
      navigation.position.quality === "stale"
        ? "gps-stale"
        : navigation.position.quality === "unavailable"
          ? "gps-unavailable"
          : onRouteActivity && (navigation.offRouteState === "off-route" || navigation.offRouteState === "rejoining")
            ? "off-route"
            : onRouteActivity && navigation.offRouteState === "uncertain"
              ? "locating"
              : "not-moving";
    // One short line a glance can take (DV-10); the sheet has the detail.
    const text: Readonly<Record<GuidanceSuspendReason, string>> = {
      "not-moving": "Ride paused",
      "off-route": "Off the route. Head back to the line.",
      locating: "Finding you on the route…",
      "gps-stale": "GPS is stale. Waiting for a fresh fix…",
      "gps-unavailable": "No GPS fix yet. Looking…",
    };
    return { kind: "suspended", reason, text: text[reason] };
  }
  const instruction = navigation.instruction;
  if (instruction === null) {
    // A Free Ride or a recording has no route to follow: name the ride instead.
    const onRoute = navigation.activity === "guided" || navigation.activity === "track";
    return { kind: "waiting", text: onRoute ? "Follow the route" : activityLabelOf(navigation) };
  }
  return { kind: "maneuver", maneuver: maneuverOf(instruction) };
}

function progressOf(
  navigation: SessionNavigationState,
  telemetry: RideFocusTelemetryInput | null,
): RideFocusProgress {
  const completed = navigation.completedStopIds.length;
  const total = completed + navigation.remainingStopIds.length;
  const stopsText = total === 0 ? null : `Stop ${completed} of ${total}`;
  const fraction = telemetry?.routeProgress ?? null;
  if (fraction === null || !Number.isFinite(fraction)) {
    return {
      fraction: null,
      // 8 §5: progress matching is the engine's; without its answer the honest
      // label is the stop objective that *is* known, and no bar is drawn.
      fractionText: stopsText === null ? "Route progress unavailable" : stopsText,
      stopsText,
    };
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  return {
    fraction: clamped,
    fractionText: `${Math.round(clamped * 100)}% along the route`,
    stopsText,
  };
}

/** `"14:20"`, or `null` for an instant that does not parse. */
function formatClockTime(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function secondaryOf(telemetry: RideFocusTelemetryInput | null): RideFocusSecondary {
  if (telemetry === null) {
    return {
      etaText: UNKNOWN_VALUE,
      remainingText: UNKNOWN_VALUE,
      arrivalText: null,
      timeLeftText: null,
      distanceLeftText: null,
    };
  }
  const eta = telemetry.etaIso === null ? null : formatClockTime(telemetry.etaIso);
  const distance =
    telemetry.remainingDistanceMeters === null
      ? null
      : formatDistance(telemetry.remainingDistanceMeters);
  const duration =
    telemetry.remainingDurationSeconds === null
      ? null
      : formatDuration(telemetry.remainingDurationSeconds);
  const remaining =
    distance === null && duration === null
      ? null
      : [distance, duration].filter((part): part is string => part !== null).join(" · ");
  return {
    etaText: eta ?? UNKNOWN_VALUE,
    remainingText: remaining ?? UNKNOWN_VALUE,
    arrivalText: eta,
    timeLeftText: duration,
    distanceLeftText: distance,
  };
}

/** The §24 conditions this surface can honestly attest to. */
function warningsOf(
  environment: RideFocusEnvironmentSnapshot,
  routeWarnings: readonly RouteWarning[],
  position: RideFocusPosition,
  ended: boolean,
): readonly RideFocusWarning[] {
  // RM-01: a finished ride has no GPS, screen or voice to warn about; "the
  // ride continues" under "Ride finished" contradicts it.
  if (ended) return [];
  const warnings: RideFocusWarning[] = [];
  if (position.quality === "unavailable") {
    warnings.push({
      id: "gps-unavailable",
      severity: "critical",
      text: "No GPS fix. Progress and ahead guidance are paused.",
    });
  } else if (position.quality === "stale") {
    warnings.push({
      id: "gps-stale",
      severity: "caution",
      text: `GPS is stale (${position.ageText ?? "no recent fix"}). Speed, heading and route estimates are paused.`,
    });
  }
  if (environment.locationPermission === "denied") {
    warnings.push({
      id: "location-denied",
      severity: "critical",
      text: "Location is blocked, so there is no position. You can retry, finish the ride, or discard it.",
    });
  }
  if (environment.wakeLock === "failed" || environment.wakeLock === "unsupported") {
    warnings.push({
      id: "wake-lock",
      severity: "caution",
      text:
        environment.wakeLock === "unsupported"
          ? "This browser can't keep the screen awake. The ride continues — keep the screen on."
          : "The screen couldn't be kept awake. The ride continues — keep the screen on.",
    });
  }
  if (environment.speech === "failed") {
    warnings.push({
      id: "speech",
      severity: "caution",
      text: "Voice announcements failed. The ride continues; guidance stays on screen.",
    });
  }
  for (const warning of routeWarnings) {
    // `info` is deliberately not at-speed content: 8 §24 asks for concise
    // critical conditions, and a ride that shouts every note shouts nothing.
    if (warning.severity === "info") continue;
    warnings.push({
      id: `route:${warning.id}`,
      severity: warning.severity === "blocking" ? "critical" : "caution",
      text: warning.message,
    });
  }
  return warnings;
}

/** The reasons the map-bound controls are unavailable, as one source of truth. */
function mapControlReasons(
  position: RideFocusPosition,
  mapReady: boolean,
): string | null {
  if (!mapReady) return "The map isn't loaded yet.";
  if (!position.hasCoordinate) return "There is no position to center on yet.";
  return null;
}

const AVAILABLE: RideFocusControl = { enabled: true, reason: null };

function control(enabled: boolean, reason: string | null): RideFocusControl {
  return enabled ? AVAILABLE : { enabled: false, reason };
}

function controlsOf(
  navigation: SessionNavigationState,
  environment: RideFocusEnvironmentSnapshot,
  position: RideFocusPosition,
  mapReady: boolean,
  recordingStatus: RecordingControllerSnapshot["status"] | null,
  libraryCommitted: boolean,
  sourceDeleted: boolean,
): RideFocusControls {
  const ended = navigation.activity === "completed";
  const moving = navigation.activity !== "paused" && !ended;
  const mapReason = mapControlReasons(position, mapReady);
  const permissionSupported = environment.locationPermission !== "unsupported";
  return {
    pause: control(moving, ended ? "The ride has ended." : "The ride is already paused."),
    resume: control(
      navigation.activity === "paused" &&
        recordingStatus !== "corrupt" &&
        recordingStatus !== "sealed" &&
        !libraryCommitted,
      recordingStatus === "corrupt"
        ? "This recording has an unreadable section and cannot resume. You can discard it."
        : recordingStatus === "sealed" || libraryCommitted
          ? "This recording is sealed. Finish saving it or discard it; it cannot resume."
        : ended ? "The ride has ended." : "The ride is already moving.",
    ),
    recenter: control(mapReason === null, mapReason),
    follow: control(mapReason === null, mapReason),
    finish: control(
      !ended && recordingStatus !== "corrupt",
      recordingStatus === "corrupt"
        ? "This recording has an unreadable section and cannot be saved as a complete ride."
        : "The ride has already ended.",
    ),
    discard: control(
      !ended && !libraryCommitted,
      libraryCommitted
        ? sourceDeleted
          ? "This recorded ride is saved in My rides and its source trace was removed."
          : "This recorded ride is already saved in My rides; Finish retries source cleanup."
        : "The ride has already ended.",
    ),
    retryLocation: control(
      permissionSupported,
      "This browser has no location support.",
    ),
  };
}

const ACTIVITY_LABEL: Readonly<Record<SessionNavigationState["activity"], string>> = {
  guided: "Guided ride",
  free: "Free ride",
  track: "Following a track",
  paused: "Paused",
  completed: "Ride ended",
};

function activityLabelOf(navigation: SessionNavigationState): string {
  if (navigation.activity === "paused") return ACTIVITY_LABEL.paused;
  if (navigation.recordingId === null) return ACTIVITY_LABEL[navigation.activity];
  return navigation.activity === "completed" ? "Recorded ride" : "Recording";
}

function terminalOf(
  navigation: SessionNavigationState,
  recordingStatus: RecordingControllerSnapshot["status"] | null,
): RideFocusTerminal | null {
  if (navigation.activity !== "completed") return null;
  if (navigation.recordingId !== null) {
    return navigation.endReason === "abandoned"
      ? { reason: "abandoned", title: "Recording discarded", text: "The recording was discarded and removed." }
      : { reason: "completed", title: "Recorded ride saved", text: "Your recorded ride is in My rides." };
  }
  if (recordingStatus === "discarded") {
    return { reason: "abandoned", title: "Recording discarded", text: "The recording was discarded and removed." };
  }
  return navigation.endReason === "abandoned"
    ? {
        reason: "abandoned",
        title: "Ride discarded",
        text: "The ride was discarded. The route is still in the planner.",
      }
    : {
        reason: "completed",
        title: "Ride finished",
        text: "The ride is finished. The route is still in the planner.",
      };
}

/** A finished ride carries its numbers; a discarded one does not. */
function withSummary(
  terminal: RideFocusTerminal | null,
  telemetry: RecordingTelemetry | null,
  units: "imperial" | "metric",
): RideFocusTerminal | null {
  if (terminal === null || terminal.reason !== "completed") return terminal;
  const stats = rideSummaryStats(telemetry, units);
  return stats.length === 0 ? terminal : { ...terminal, stats };
}

/** Projects one navigation frame into the whole rider-facing surface. */
export function buildRideFocusViewModel(
  input: RideFocusViewModelInput,
): RideFocusViewModel {
  const { navigation, environment } = input;
  const telemetry = input.telemetry ?? null;
  const position = positionOf(navigation.position);
  // A rider the matcher has not placed on the line yet has no honest
  // "miles left": its projection can land anywhere, even on the finish.
  const unplaced = navigation.offRouteState === "uncertain" && navigation.aheadGuidanceSuspended;
  const currentTelemetry =
    position.quality === "stale" || position.quality === "unavailable" || unplaced ? null : telemetry;
  const now = input.now ?? new Date().toISOString();
  const mapReady = input.mapReady ?? true;
  const speedLimit = navigation.activity === "guided" ? speedLimitOf(currentTelemetry, navigation.position) : null;
  return {
    activity: navigation.activity,
    activityLabel: activityLabelOf(navigation),
    moving: navigation.activity === "guided" || navigation.activity === "free" || navigation.activity === "track",
    guidance: guidanceOf(navigation),
    position,
    progress: progressOf(navigation, currentTelemetry),
    secondary: secondaryOf(currentTelemetry),
    recording: recordingOf(
      navigation,
      position,
      input.recordingSummary ?? null,
      input.recordingStatus ?? null,
      input.bufferedRecordingPointCount ?? 0,
      input.recordingLibraryCommitted ?? false,
      input.recordingSourceDeleted ?? false,
    ),
    warnings: warningsOf(environment, input.routeWarnings ?? [], position, navigation.activity === "completed"),
    controls: controlsOf(
      navigation,
      environment,
      position,
      mapReady,
      input.recordingStatus ?? null,
      input.recordingLibraryCommitted ?? false,
      input.recordingSourceDeleted ?? false,
    ),
    terminal: withSummary(
      terminalOf(navigation, input.recordingStatus ?? null),
      input.recordingTelemetry ?? input.liveTelemetry ?? null,
      input.riderSettings?.units ?? "imperial",
    ),
    speedLimit,
    mapPosition:
      navigation.position.coordinate === null
        ? null
        : {
            coordinate: navigation.position.coordinate,
            quality: navigation.position.quality,
          },
    metrics: buildRideMetricStrip({
      navigation,
      telemetry: currentTelemetry,
      recordingSummary: input.recordingSummary ?? null,
      recordingTelemetry: input.recordingTelemetry ?? null,
      liveTelemetry: input.liveTelemetry ?? null,
      lean: input.lean ?? null,
      settings: input.riderSettings ?? createRiderSettings(),
      nowMs: Date.parse(now),
      overLimit: speedLimit?.over === true,
    }),
  };
}

/** Exported for the surface's own status line (12 §17) without new wording. */
export function permissionLabel(state: LocationPermissionState): string {
  switch (state) {
    case "granted":
      return "Location allowed";
    case "denied":
      return "Location blocked";
    case "prompt":
      return "Location not decided";
    case "unsupported":
      return "Location unsupported";
    case "unknown":
      return "Location state unknown";
  }
}
