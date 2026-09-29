/**
 * RiderSettings — the one versioned preference record for the ride instrument
 * strip (RIDE-INSTRUMENT-STRIP §0, §5).
 *
 * SwitchBack kept these choices in `RiderSettings.uiPreferences` at version 2
 * with short IDs (`eta`, `speed`, …). VNext had no equivalent record, so V3 is
 * introduced here as the sole authority for the strip's metric choices, and a
 * V2-shaped record (an imported SwitchBack preference, or a future device
 * migration) is read losslessly: every legacy ID maps to its canonical ID in
 * order, and nothing else about the record is reset because one slot is bad.
 *
 * Presets are not persisted: `presetMatching` derives a name from the three
 * stored IDs (§2.3). Units stay imperial in the UI until kilometres ship
 * (OGV-D-267); the field exists so the formatter has one place to ask.
 */

import {
  RIDE_METRIC_IDS,
  RIDE_METRIC_SLOT_COUNT,
  defaultMetricSlots,
  isRideMetricId,
  type RideMetricId,
  type RideMetricSlots,
} from "./registry";

export const RIDER_SETTINGS_VERSION = 3;

export type UnitSystem = "imperial" | "metric";

export interface RiderSettings {
  readonly version: typeof RIDER_SETTINGS_VERSION;
  readonly units: UnitSystem;
  readonly uiPreferences: {
    /** Guided rides (Navigate). */
    readonly rideMetrics: RideMetricSlots;
    /** Record, and Free Ride until riders show the two need separate layouts (§5.1). */
    readonly recordingMetrics: RideMetricSlots;
  };
}

/** The V2 → V3 ID map (§5.2). `distance` only ever meant recorded distance. */
const LEGACY_METRIC_IDS: Readonly<Record<string, RideMetricId>> = {
  eta: "route.eta",
  "remaining-distance": "route.distanceRemaining",
  speed: "speed.current",
  elevation: "elevation.current",
  elapsed: "time.recorded",
  distance: "distance.recorded",
};

export function createRiderSettings(): RiderSettings {
  return {
    version: RIDER_SETTINGS_VERSION,
    units: "imperial",
    uiPreferences: {
      rideMetrics: defaultMetricSlots("guided"),
      recordingMetrics: defaultMetricSlots("recording"),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalId(value: unknown): RideMetricId | null {
  if (typeof value !== "string") return null;
  if (isRideMetricId(value)) return value;
  return LEGACY_METRIC_IDS[value] ?? null;
}

/**
 * Keeps order, drops unknown and repeated IDs, caps at three, then fills the
 * missing slots from `fallback` (the mode's defaults) without repeating an ID
 * the rider already chose.
 */
export function normalizeMetricSlots(value: unknown, fallback: RideMetricSlots): RideMetricSlots {
  const chosen: RideMetricId[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const id = canonicalId(entry);
      if (id === null || chosen.includes(id)) continue;
      chosen.push(id);
      if (chosen.length === RIDE_METRIC_SLOT_COUNT) break;
    }
  }
  for (const id of [...fallback, ...RIDE_METRIC_IDS]) {
    if (chosen.length === RIDE_METRIC_SLOT_COUNT) break;
    if (!chosen.includes(id)) chosen.push(id);
  }
  return [chosen[0]!, chosen[1]!, chosen[2]!];
}

/**
 * Reads any stored value into a valid V3 record. A V2 record migrates; a V3
 * record is re-validated; anything unreadable is the defaults. Never throws.
 */
export function parseRiderSettings(value: unknown): RiderSettings {
  const defaults = createRiderSettings();
  if (!isRecord(value)) return defaults;
  if (value["version"] !== 2 && value["version"] !== RIDER_SETTINGS_VERSION) return defaults;
  const preferences = isRecord(value["uiPreferences"]) ? value["uiPreferences"] : {};
  return {
    version: RIDER_SETTINGS_VERSION,
    units: value["units"] === "metric" ? "metric" : "imperial",
    uiPreferences: {
      rideMetrics: normalizeMetricSlots(preferences["rideMetrics"], defaults.uiPreferences.rideMetrics),
      recordingMetrics: normalizeMetricSlots(preferences["recordingMetrics"], defaults.uiPreferences.recordingMetrics),
    },
  };
}

/** Which of the two stored arrays a ride mode reads and writes. */
export type RideMetricPreferenceKey = keyof RiderSettings["uiPreferences"];

export function withMetricSlots(
  settings: RiderSettings,
  key: RideMetricPreferenceKey,
  slots: RideMetricSlots,
): RiderSettings {
  return {
    ...settings,
    uiPreferences: { ...settings.uiPreferences, [key]: normalizeMetricSlots(slots, settings.uiPreferences[key]) },
  };
}

/** The persistence boundary; the adapter owns the storage key and failures. */
export interface RiderSettingsStoragePort {
  read(): RiderSettings;
  write(settings: RiderSettings): void;
  clear(): void;
}
