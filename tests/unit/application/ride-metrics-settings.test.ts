/**
 * RiderSettings V3 (RIDE-INSTRUMENT-STRIP §5, §17.1).
 *
 * The record is the only authority for the strip's choices, so the migration
 * must keep every valid rider choice: legacy IDs map in order, repeats and
 * unknown IDs drop without resetting the rest, missing slots fill from the
 * mode defaults, and presets stay derived rather than stored.
 */

import { describe, expect, it } from "vitest";

import {
  RIDER_SETTINGS_VERSION,
  createRiderSettings,
  normalizeMetricSlots,
  parseRiderSettings,
  withMetricSlots,
} from "@/application/ride-metrics/rider-settings";
import { defaultMetricSlots, presetMatching } from "@/application/ride-metrics/registry";
import {
  RIDER_SETTINGS_STORAGE_KEY,
  createLocalStorageRiderSettings,
} from "@/infrastructure/storage/rider-settings-storage";

function v2(rideMetrics: unknown, recordingMetrics: unknown, extra: Record<string, unknown> = {}) {
  return { version: 2, units: "imperial", uiPreferences: { rideMetrics, recordingMetrics }, ...extra };
}

describe("V2 → V3 migration", () => {
  it.each([
    ["eta", "route.eta"],
    ["remaining-distance", "route.distanceRemaining"],
    ["speed", "speed.current"],
    ["elevation", "elevation.current"],
    ["elapsed", "time.recorded"],
  ])("maps the legacy ride metric %s to %s", (legacy, canonical) => {
    const settings = parseRiderSettings(v2([legacy], ["distance"]));
    expect(settings.version).toBe(RIDER_SETTINGS_VERSION);
    expect(settings.uiPreferences.rideMetrics[0]).toBe(canonical);
  });

  it.each([
    ["distance", "distance.recorded"],
    ["speed", "speed.current"],
    ["elevation", "elevation.current"],
    ["elapsed", "time.recorded"],
  ])("maps the legacy recording metric %s to %s", (legacy, canonical) => {
    expect(parseRiderSettings(v2(["eta"], [legacy])).uiPreferences.recordingMetrics[0]).toBe(canonical);
  });

  it("keeps the rider's order", () => {
    const settings = parseRiderSettings(v2(["speed", "eta", "remaining-distance"], ["elapsed", "distance", "speed"]));
    expect(settings.uiPreferences.rideMetrics).toEqual(["speed.current", "route.eta", "route.distanceRemaining"]);
    expect(settings.uiPreferences.recordingMetrics).toEqual(["time.recorded", "distance.recorded", "speed.current"]);
  });

  it("dedupes, including a legacy and canonical spelling of the same metric", () => {
    const settings = parseRiderSettings(v2(["speed", "speed", "speed.current", "eta"], ["distance"]));
    expect(settings.uiPreferences.rideMetrics.slice(0, 2)).toEqual(["speed.current", "route.eta"]);
    expect(new Set(settings.uiPreferences.rideMetrics).size).toBe(3);
  });

  it("repairs an unknown ID without resetting the other slots or units", () => {
    const settings = parseRiderSettings(v2(["speed", "warp-factor", "eta"], ["distance"], { units: "metric" }));
    expect(settings.units).toBe("metric");
    expect(settings.uiPreferences.rideMetrics.slice(0, 2)).toEqual(["speed.current", "route.eta"]);
    // The missing third slot comes from the guided defaults, not a repeat.
    expect(settings.uiPreferences.rideMetrics[2]).toBe("route.distanceRemaining");
  });

  it("fills missing slots from the mode defaults", () => {
    const settings = parseRiderSettings(v2(["elevation"], []));
    expect(settings.uiPreferences.rideMetrics).toEqual(["elevation.current", "speed.current", "route.distanceRemaining"]);
    expect(settings.uiPreferences.recordingMetrics).toEqual(defaultMetricSlots("recording"));
  });

  it("caps at three", () => {
    const settings = parseRiderSettings(v2(["speed", "eta", "remaining-distance", "elevation", "elapsed"], ["distance"]));
    expect(settings.uiPreferences.rideMetrics).toHaveLength(3);
  });

  it("survives partial corruption of one array", () => {
    const settings = parseRiderSettings(v2("not-a-list", [42, null, "elapsed"]));
    expect(settings.uiPreferences.rideMetrics).toEqual(defaultMetricSlots("guided"));
    expect(settings.uiPreferences.recordingMetrics[0]).toBe("time.recorded");
  });

  it("treats an unreadable or unknown-version record as the defaults", () => {
    expect(parseRiderSettings(null)).toEqual(createRiderSettings());
    expect(parseRiderSettings("{}")).toEqual(createRiderSettings());
    expect(parseRiderSettings({ version: 9, uiPreferences: { rideMetrics: ["speed"] } })).toEqual(createRiderSettings());
    expect(parseRiderSettings({ version: 3 })).toEqual(createRiderSettings());
  });

  it("round-trips a V3 record unchanged", () => {
    const settings = withMetricSlots(createRiderSettings(), "rideMetrics", ["heading", "route.eta", "speed.current"]);
    expect(parseRiderSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });
});

describe("presets are derived, not persisted (§2.3)", () => {
  it("names the preset three stored IDs spell, and none for a custom set", () => {
    expect(presetMatching(defaultMetricSlots("guided"))?.id).toBe("navigate");
    expect(presetMatching(defaultMetricSlots("recording"))?.id).toBe("record");
    expect(presetMatching(["route.eta", "speed.current", "heading"])).toBeNull();
  });

  it("stores no preset field", () => {
    expect(Object.keys(createRiderSettings().uiPreferences).sort()).toEqual(["recordingMetrics", "rideMetrics"]);
    expect(JSON.stringify(createRiderSettings())).not.toMatch(/preset/i);
  });
});

describe("normalizeMetricSlots", () => {
  it("never returns a repeated metric even when the fallback overlaps the choice", () => {
    const slots = normalizeMetricSlots(["route.timeRemaining"], defaultMetricSlots("guided"));
    expect(slots).toEqual(["route.timeRemaining", "speed.current", "route.distanceRemaining"]);
  });
});

describe("the local storage adapter", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
  }

  it("migrates a stored V2 record on read and writes V3", () => {
    const storage = memoryStorage({ [RIDER_SETTINGS_STORAGE_KEY]: JSON.stringify(v2(["eta", "speed"], ["elapsed"])) });
    const port = createLocalStorageRiderSettings(storage);
    const settings = port.read();
    expect(settings.uiPreferences.rideMetrics.slice(0, 2)).toEqual(["route.eta", "speed.current"]);
    port.write(settings);
    expect(JSON.parse(storage.values.get(RIDER_SETTINGS_STORAGE_KEY)!).version).toBe(3);
  });

  it("returns the defaults for unparseable JSON", () => {
    const port = createLocalStorageRiderSettings(memoryStorage({ [RIDER_SETTINGS_STORAGE_KEY]: "{not json" }));
    expect(port.read()).toEqual(createRiderSettings());
  });

  it("stays usable when storage is unavailable or throws", () => {
    expect(createLocalStorageRiderSettings(null).read()).toEqual(createRiderSettings());
    const throwing = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    };
    const port = createLocalStorageRiderSettings(throwing);
    expect(port.read()).toEqual(createRiderSettings());
    expect(() => port.write(createRiderSettings())).not.toThrow();
    expect(() => port.clear()).not.toThrow();
  });
});
