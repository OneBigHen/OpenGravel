/**
 * Free Ride live telemetry (RIDE-INSTRUMENT-STRIP §6, §11): the session's
 * fixes folded into the recording's accumulator, written with the session at
 * most every 5 s, restored on reload as a pause, dropped when the ride ends,
 * and never throwing when storage fails.
 */

import { describe, expect, it, vi } from "vitest";

import {
  FREE_RIDE_TELEMETRY_WRITE_INTERVAL_MS,
  createFreeRideTelemetry,
  recordingPositionFromFix,
  type FreeRideTelemetryStoragePort,
} from "@/application/ride-session/free-ride-telemetry";
import { INITIAL_RECORDING_TELEMETRY_STATE, summarizeRecordingTelemetry } from "@/domain/recording/telemetry";
import { asRecordingId } from "@/domain/recording/ids";
import type { PositionFix, RideSessionState } from "@/domain/ride-session/types";
import {
  FREE_RIDE_TELEMETRY_STORAGE_KEY,
  createLocalStorageFreeRideTelemetry,
  type FreeRideTelemetryStorageLike,
} from "@/infrastructure/storage/free-ride-telemetry-storage";

const MPH = 1609.344 / 3600;
const START_MS = Date.parse("2026-09-28T15:00:00.000Z");
const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;

function memoryStorage(): FreeRideTelemetryStorageLike & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

type SessionFields = Pick<
  RideSessionState,
  "sessionId" | "activity" | "resumeActivity" | "recordingId" | "pausedDurationMs"
>;

function session(overrides: Partial<SessionFields> = {}): RideSessionState {
  return {
    sessionId: "ses_free",
    activity: "free",
    resumeActivity: null,
    recordingId: null,
    pausedDurationMs: 0,
    ...overrides,
  } as unknown as RideSessionState;
}

/** One fix a second heading north at `speedMps`, starting `fromSecond` seconds into the ride. */
function fixes(seconds: number, speedMps: number, fromSecond = 0, startNorth = 0): PositionFix[] {
  return Array.from({ length: seconds }, (_, index) => {
    const second = fromSecond + index;
    return {
      coordinate: { lon: -75.44, lat: 40.14 + (startNorth + speedMps * index) / METERS_PER_DEGREE },
      observedAt: new Date(START_MS + second * 1_000).toISOString(),
      accuracyMeters: 5,
      headingDegrees: 0,
      speedMps,
    };
  });
}

/** A service on a clock that each fix moves to its own observation time. */
function service(storage: FreeRideTelemetryStoragePort | null) {
  let clock = START_MS;
  const telemetry = createFreeRideTelemetry({ storage, nowMs: () => clock });
  return {
    telemetry,
    feed(list: readonly PositionFix[], state = session()) {
      for (const fix of list) {
        clock = Date.parse(fix.observedAt);
        telemetry.accept(fix, state);
      }
    },
  };
}

describe("folding a Free Ride's fixes", () => {
  it("gives exactly the recording's answer for the same fixes", () => {
    const ride = fixes(60, 30 * MPH);
    const { telemetry, feed } = service(null);
    feed(ride);
    expect(telemetry.snapshot(session())).toEqual(
      summarizeRecordingTelemetry(ride.map((fix) => recordingPositionFromFix(fix, 0))),
    );
    expect(telemetry.snapshot(session())!.movingMs).toBe(59_000);
    expect(telemetry.snapshot(session())!.maxSpeedMps).toBeCloseTo(30 * MPH, 6);
  });

  it("drops a derived speed: the fold recomputes it, as the recording does", () => {
    const fix = { ...fixes(1, 10)[0]!, speedDerived: true };
    expect(recordingPositionFromFix(fix, 0)).not.toHaveProperty("speedMps");
    expect(recordingPositionFromFix({ ...fix, speedDerived: false }, 7)).toMatchObject({ speedMps: 10, pausedDurationMs: 7 });
  });

  it("waits with an empty fold before the first Free Ride fix", () => {
    const { telemetry } = service(null);
    expect(telemetry.snapshot(session())).toMatchObject({ movingMs: 0, lastSampleAtMs: null });
  });

  it("leaves a recording session alone: the recording is its source", () => {
    const { telemetry, feed } = service(null);
    const recording = session({ recordingId: asRecordingId("rec_1") });
    feed(fixes(30, 30 * MPH), recording);
    expect(telemetry.snapshot(recording)).toBeNull();
    expect(telemetry.snapshot(session())).toMatchObject({ lastSampleAtMs: null });
  });

  it("never starts on a ride that was only ever guided, and writes nothing for it", () => {
    const storage = memoryStorage();
    const { telemetry, feed } = service(createLocalStorageFreeRideTelemetry(storage));
    const guided = session({ activity: "guided" });
    feed(fixes(30, 30 * MPH), guided);
    telemetry.flush();
    expect(telemetry.snapshot(guided)).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it("keeps counting through a guided leg once the ride has been in Free Ride", () => {
    const { telemetry, feed } = service(null);
    feed(fixes(30, 30 * MPH));
    feed(fixes(30, 30 * MPH, 30, 30 * 30 * MPH), session({ activity: "guided" }));
    expect(telemetry.snapshot(session())!.movingMs).toBe(59_000);
  });
});

describe("writing the state with the session", () => {
  it("writes at most every 5 s while fixes arrive, and at once on flush", () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const { telemetry, feed } = service(createLocalStorageFreeRideTelemetry(storage));
    feed(fixes(21, 30 * MPH));
    // 0 s, 5 s, 10 s, 15 s, 20 s.
    expect(setItem).toHaveBeenCalledTimes(Math.floor(20_000 / FREE_RIDE_TELEMETRY_WRITE_INTERVAL_MS) + 1);
    feed(fixes(2, 30 * MPH, 21, 21 * 30 * MPH));
    expect(setItem).toHaveBeenCalledTimes(5);
    telemetry.flush();
    expect(setItem).toHaveBeenCalledTimes(6);
    // Nothing new since: a second flush writes nothing.
    telemetry.flush();
    expect(setItem).toHaveBeenCalledTimes(6);
    const entry = JSON.parse(storage.values.get(FREE_RIDE_TELEMETRY_STORAGE_KEY)!) as { sessionId: string; version: number };
    expect(entry).toMatchObject({ version: 1, sessionId: "ses_free" });
  });

  it("restores on reload, continues from the saved values, and counts the reload as not moving", () => {
    const storage = memoryStorage();
    const before = service(createLocalStorageFreeRideTelemetry(storage));
    before.feed(fixes(61, 30 * MPH));
    before.telemetry.flush();
    const saved = before.telemetry.snapshot(session())!;
    expect(saved.movingMs).toBe(60_000);

    // A new page: a new service over the same storage.
    const after = service(createLocalStorageFreeRideTelemetry(storage));
    expect(after.telemetry.snapshot(session())).toMatchObject({
      movingMs: saved.movingMs,
      maxSpeedMps: saved.maxSpeedMps,
      movement: "stopped",
    });
    // Riding on 4 s after the last fix (a quick reload): the first new second is not bridged.
    after.feed(fixes(30, 30 * MPH, 65, 65 * 30 * MPH));
    const resumed = after.telemetry.snapshot(session())!;
    expect(resumed.movingMs).toBe(saved.movingMs + 29_000);
    expect(resumed.movingMs).toBeLessThan(saved.movingMs + 30_000);
    expect(resumed.maxSpeedMps).toBeCloseTo(30 * MPH, 6);
  });

  it("restores nothing for another session", () => {
    const storage = memoryStorage();
    const before = service(createLocalStorageFreeRideTelemetry(storage));
    before.feed(fixes(30, 30 * MPH));
    before.telemetry.flush();
    const other = service(createLocalStorageFreeRideTelemetry(storage));
    expect(other.telemetry.snapshot(session({ sessionId: "ses_next" as RideSessionState["sessionId"] }))).toMatchObject({ movingMs: 0, lastSampleAtMs: null });
  });

  it("drops the state when the ride ends", () => {
    const storage = memoryStorage();
    const { telemetry, feed } = service(createLocalStorageFreeRideTelemetry(storage));
    feed(fixes(30, 30 * MPH));
    telemetry.flush();
    expect(storage.values.has(FREE_RIDE_TELEMETRY_STORAGE_KEY)).toBe(true);
    telemetry.end();
    expect(storage.values.has(FREE_RIDE_TELEMETRY_STORAGE_KEY)).toBe(false);
    expect(service(createLocalStorageFreeRideTelemetry(storage)).telemetry.snapshot(session())).toMatchObject({ movingMs: 0 });
  });
});

describe("a store that fails", () => {
  it("ignores a corrupt entry and starts from zero", () => {
    for (const raw of ["{not json", "null", "[]", JSON.stringify({ version: 1, sessionId: "ses_free", state: { version: 1 } })]) {
      const storage = memoryStorage();
      storage.values.set(FREE_RIDE_TELEMETRY_STORAGE_KEY, raw);
      const { telemetry, feed } = service(createLocalStorageFreeRideTelemetry(storage));
      expect(telemetry.snapshot(session())).toMatchObject({ movingMs: 0, lastSampleAtMs: null });
      feed(fixes(30, 30 * MPH));
      expect(telemetry.snapshot(session())!.movingMs).toBe(29_000);
    }
  });

  it("keeps working live when every storage call throws, and stops trying after a failed write", () => {
    const setItem = vi.fn(() => { throw new Error("QuotaExceededError"); });
    const broken: FreeRideTelemetryStorageLike = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem,
      removeItem: () => { throw new Error("SecurityError"); },
    };
    const { telemetry, feed } = service(createLocalStorageFreeRideTelemetry(broken));
    expect(() => feed(fixes(30, 30 * MPH))).not.toThrow();
    expect(() => telemetry.flush()).not.toThrow();
    expect(telemetry.snapshot(session())!.movingMs).toBe(29_000);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(() => telemetry.end()).not.toThrow();
  });

  it("survives a port that throws, not just a storage that does", () => {
    const port: FreeRideTelemetryStoragePort = {
      read: () => { throw new Error("boom"); },
      write: () => { throw new Error("boom"); },
      clear: () => { throw new Error("boom"); },
    };
    const { telemetry, feed } = service(port);
    expect(() => feed(fixes(10, 30 * MPH))).not.toThrow();
    expect(() => telemetry.flush()).not.toThrow();
    expect(() => telemetry.end()).not.toThrow();
  });

  it("has no store without a window, and says so without throwing", () => {
    const port = createLocalStorageFreeRideTelemetry(null);
    expect(port.read("ses_free")).toBeNull();
    expect(port.write("ses_free", INITIAL_RECORDING_TELEMETRY_STATE)).toBe(false);
    expect(() => port.clear()).not.toThrow();
  });
});
