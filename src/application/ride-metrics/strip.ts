/**
 * The three-slot strip for one ride frame (RIDE-INSTRUMENT-STRIP §2, §12, §13).
 *
 * Pure: the same navigation frame, telemetry, recording summary, stored slots
 * and clock produce the same strip. It decides three things the renderer must
 * not decide for itself:
 *
 * - **Which mode this is.** A route makes it guided; a route-free ride that
 *   records is Record; otherwise Free Ride. Guided reads `rideMetrics`; Record
 *   and Free Ride share `recordingMetrics` (§5.1).
 * - **What each slot shows.** A stored metric this mode cannot show (a Record
 *   layout seen in Free Ride, or a metric a later slice builds) is displayed as
 *   the mode's own default for that slot — never persisted, so the rider's
 *   choice is still there when it becomes showable.
 * - **Whether the rider may change it now** (§2.2). Paused, or a *fresh* speed
 *   at or under 5 mph. A stale or missing speed never proves the rider stopped.
 */

import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { RecordingSummary } from "@/domain/recording/types";
import type { RecordingTelemetry } from "@/domain/recording/telemetry";
import {
  MOVING_SPEED_MPS,
  RIDE_METRIC_IDS,
  RIDE_METRIC_REGISTRY,
  defaultMetricSlots,
  metricAvailable,
  presetMatching,
  resolveRideMetric,
  type RideMetricContext,
  type RideMetricId,
  type RideMetricMode,
  type RideMetricPreset,
  type RideMetricReading,
  type RideMetricSlots,
  type RideMetricSources,
  type UnitPreference,
} from "./registry";
import type { RideMetricPreferenceKey, RiderSettings } from "./rider-settings";

export interface RideMetricSlotView {
  readonly index: number;
  readonly reading: RideMetricReading;
  /** The one-line caption under the value. */
  readonly caption: string;
  /** "Speed, 47 miles per hour." — the value half of the slot's accessible name. */
  readonly spokenValue: string;
}

export interface RideMetricStripModel {
  readonly mode: RideMetricMode;
  /** What this ride can feed beyond its mode (a guided ride may record). */
  readonly sources: RideMetricSources;
  readonly preferenceKey: RideMetricPreferenceKey;
  readonly slots: readonly [RideMetricSlotView, RideMetricSlotView, RideMetricSlotView];
  /** The IDs on screen, after any per-mode substitution. */
  readonly shownIds: RideMetricSlots;
  /** The preset the shown IDs spell, or `null` for a custom arrangement. */
  readonly preset: RideMetricPreset | null;
  /** §2.2: the picker opens only while this is true. */
  readonly customizable: boolean;
  /** The speed slot's over-the-limit state, carried over from the speed bubble. */
  readonly overLimit: boolean;
}

export interface RideMetricStripInput {
  readonly navigation: SessionNavigationState;
  /** The engine's answer, already withheld (`null`) for a stale or unplaced fix. */
  readonly telemetry: NonNullable<RideMetricContext["route"]>["answer"];
  readonly recordingSummary: RecordingSummary | null;
  /** The filtered telemetry of the same recording (§6); absent before slice B callers pass it. */
  readonly recordingTelemetry?: RecordingTelemetry | null;
  /**
   * A Free Ride's live telemetry (not recording): the same fold over the
   * session's fixes, kept with the session. Absent or `null` means none, and
   * the moving-time metrics are not offered.
   */
  readonly liveTelemetry?: RecordingTelemetry | null;
  readonly settings: Pick<RiderSettings, "units" | "uiPreferences">;
  readonly nowMs: number;
  readonly overLimit?: boolean;
}

export function rideMetricMode(navigation: Pick<SessionNavigationState, "plan" | "recordingId" | "activity">): RideMetricMode {
  if (navigation.activity !== "free" && navigation.plan.route !== null) return "guided";
  return navigation.recordingId === null ? "free-ride" : "recording";
}

export function preferenceKeyFor(mode: RideMetricMode): RideMetricPreferenceKey {
  return mode === "guided" ? "rideMetrics" : "recordingMetrics";
}

/**
 * The IDs a mode shows for the stored three: each stored ID it can show stays
 * in place; each one it cannot is replaced by the first of the mode's defaults
 * (then any showable metric) not already on screen.
 */
export function shownMetricIds(
  stored: RideMetricSlots,
  mode: RideMetricMode,
  sources?: RideMetricSources,
): RideMetricSlots {
  const shown: (RideMetricId | null)[] = stored.map((id) => (metricAvailable(id, mode, sources) ? id : null));
  const spare = [...defaultMetricSlots(mode), ...RIDE_METRIC_IDS].filter((id) => metricAvailable(id, mode, sources));
  for (const [index, id] of shown.entries()) {
    if (id !== null) continue;
    shown[index] = spare.find((candidate) => !shown.includes(candidate)) ?? stored[index]!;
  }
  return [shown[0]!, shown[1]!, shown[2]!];
}

function contextOf(input: RideMetricStripInput, mode: RideMetricMode): RideMetricContext {
  const { navigation } = input;
  // Freshness comes from the port's own derived age, not a second clock read.
  const age = navigation.position.ageMs;
  const live = liveTelemetryOf(input, mode);
  return {
    mode,
    units: input.settings.units satisfies UnitPreference,
    nowMs: input.nowMs,
    position: {
      quality: navigation.position.quality,
      speedMps: navigation.position.speedMps,
      headingDegrees: navigation.position.headingDegrees,
      accuracyMeters: navigation.position.accuracyMeters,
      observedAtMs: age === null || !Number.isFinite(age) ? null : input.nowMs - age,
      altitudeMeters: navigation.position.altitudeMeters ?? null,
      altitudeAccuracyMeters: navigation.position.altitudeAccuracyMeters ?? null,
    },
    paused: navigation.activity === "paused",
    route: navigation.plan.route === null ? null : { answer: input.telemetry },
    recording:
      navigation.recordingId === null
        ? null
        : { summary: input.recordingSummary, telemetry: input.recordingTelemetry ?? null },
    ...(live === null ? {} : { liveTelemetry: live }),
  };
}

/** Free Ride's live telemetry, only in Free Ride: a recording, or a route, has its own sources. */
function liveTelemetryOf(input: RideMetricStripInput, mode: RideMetricMode): RecordingTelemetry | null {
  return mode === "free-ride" ? input.liveTelemetry ?? null : null;
}

function customizableNow(navigation: SessionNavigationState, speed: RideMetricReading): boolean {
  if (navigation.activity === "completed") return false;
  if (navigation.activity === "paused") return true;
  return speed.state === "ready" && typeof speed.rawValue === "number" && speed.rawValue <= MOVING_SPEED_MPS;
}

export function buildRideMetricStrip(input: RideMetricStripInput): RideMetricStripModel {
  const mode = rideMetricMode(input.navigation);
  const preferenceKey = preferenceKeyFor(mode);
  const sources: RideMetricSources = {
    recording: input.navigation.recordingId !== null,
    ...(liveTelemetryOf(input, mode) === null ? {} : { liveTelemetry: true }),
  };
  const shownIds = shownMetricIds(input.settings.uiPreferences[preferenceKey], mode, sources);
  const context = contextOf(input, mode);
  const slot = (index: number): RideMetricSlotView => {
    const reading = resolveRideMetric(shownIds[index]!, context);
    return {
      index,
      reading,
      caption: RIDE_METRIC_REGISTRY[reading.id].shortLabel,
      spokenValue: `${reading.label}, ${reading.accessibleDetail}.`,
    };
  };
  // The lock reads a fresh speed whether or not the rider shows speed.
  const speed = resolveRideMetric("speed.current", context);
  return {
    mode,
    sources,
    preferenceKey,
    slots: [slot(0), slot(1), slot(2)],
    shownIds,
    preset: presetMatching(shownIds),
    customizable: customizableNow(input.navigation, speed),
    overLimit: input.overLimit === true && shownIds.includes("speed.current"),
  };
}

/**
 * The stored three after the rider puts `id` in slot `index` (§2.2: only that
 * slot changes). The choice is made against what is on screen: if `id` is
 * already shown in another slot the two swap, so the three stay distinct. Only
 * the slots whose shown metric changed are written back, so a Record choice
 * that Free Ride displays as a substitute survives a change made in Free Ride.
 */
export function storedAfterChoice(
  stored: RideMetricSlots,
  shown: RideMetricSlots,
  index: number,
  id: RideMetricId,
): RideMetricSlots {
  const next = [...shown];
  const previous = next[index]!;
  const existing = next.indexOf(id);
  if (existing !== -1 && existing !== index) next[existing] = previous;
  next[index] = id;
  const result = stored.map((storedId, slot) => (next[slot] === shown[slot] ? storedId : next[slot]!));
  return [result[0]!, result[1]!, result[2]!];
}
