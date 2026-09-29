/**
 * Free Ride live telemetry in Ride Focus (RIDE-INSTRUMENT-STRIP §6, §11): a
 * Free Ride that records nothing offers Moving time and Max speed, shows a
 * value, and after a reload (a new store over the same session journal and
 * the same saved state) continues from the saved value without counting the
 * reload as moving.
 */

import "fake-indexeddb/auto";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RideFocusPointerPort } from "@/application/persistence/ride-focus-pointer";
import { createFreeRideTelemetry, type FreeRideTelemetry } from "@/application/ride-session/free-ride-telemetry";
import type { RideFocusEnvironmentPort, RideFocusEnvironmentSnapshot } from "@/application/ride-session/ports/ride-focus-environment";
import { createRideSessionController, type RideSessionController } from "@/application/ride-session/ride-session-controller";
import { createRiderSettings, withMetricSlots, type RiderSettings, type RiderSettingsStoragePort } from "@/application/ride-metrics/rider-settings";
import { newRideId } from "@/domain/ride/ids";
import type { PositionFix } from "@/domain/ride-session/types";
import { VNextDatabase } from "@/infrastructure/storage/db";
import {
  FREE_RIDE_TELEMETRY_STORAGE_KEY,
  createLocalStorageFreeRideTelemetry,
  type FreeRideTelemetryStorageLike,
} from "@/infrastructure/storage/free-ride-telemetry-storage";
import { createRideSessionRepository } from "@/infrastructure/storage/ride-session-repository";
import { RideMetricPicker } from "@/ui/ride/RideMetricPicker";
import { RideMetricStrip } from "@/ui/ride/RideMetricStrip";
import { createRideFocusStore } from "@/ui/stores/ride-focus-store";

const BASE = Date.parse("2026-09-28T15:00:00.000Z");
const MPH = 1609.344 / 3600;
const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;
let databaseSequence = 0;

afterEach(cleanup);

function environment(): RideFocusEnvironmentPort {
  const snapshot: RideFocusEnvironmentSnapshot = { locationPermission: "granted", wakeLock: "off", speech: "ready" };
  return {
    snapshot: () => snapshot,
    subscribe: (listener) => { listener(snapshot); return () => undefined; },
    setRideActive: () => undefined,
    requestLocationPermission: async () => "granted",
    dispose: () => undefined,
  };
}

function memoryStorage(): FreeRideTelemetryStorageLike & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

/** One device: the session journal, the saved telemetry and the rider's strip choices outlive a page. */
async function device() {
  databaseSequence += 1;
  const database = new VNextDatabase(`ogv-free-ride-telemetry-${databaseSequence}`);
  const telemetryStorage = memoryStorage();
  let settings: RiderSettings = withMetricSlots(createRiderSettings(), "recordingMetrics", [
    "speed.current",
    "heading",
    "gps.accuracy",
  ]);
  const riderSettings: RiderSettingsStoragePort = {
    read: () => settings,
    write: (next) => { settings = next; },
    clear: () => { settings = createRiderSettings(); },
  };
  let clock = BASE;
  let north = 0;
  const first = createRideSessionController({
    repository: createRideSessionRepository({ database }),
    now: () => new Date(clock).toISOString(),
  });
  const started = await first.start({
    activity: "free",
    suggestions: "off",
    rideId: newRideId(),
    rideRevision: 0,
    at: new Date(BASE).toISOString(),
  });
  if (started.state === null) throw new Error("Free Ride did not start");
  const sessionId = started.state.sessionId;
  const pointer: RideFocusPointerPort = {
    read: () => ({
      status: "found",
      pointer: { version: 1, sessionId, rideId: started.state!.plan.rideId, routeGeometryRef: null, updatedAt: new Date(BASE).toISOString() },
    }),
    write: () => undefined,
    clear: () => undefined,
  };

  /** A page: its own controller over the journal, its own telemetry service over the saved state, its own store. */
  async function page(controller: RideSessionController = createRideSessionController({
    repository: createRideSessionRepository({ database }),
    now: () => new Date(clock).toISOString(),
  })) {
    const freeRideTelemetry: FreeRideTelemetry = createFreeRideTelemetry({
      storage: createLocalStorageFreeRideTelemetry(telemetryStorage),
      nowMs: () => clock,
    });
    let tick: (() => void) | null = null;
    const store = createRideFocusStore({
      controller,
      environment,
      pointer,
      riderSettings,
      freeRideTelemetry,
      now: () => new Date(clock).toISOString(),
      setInterval: (handler) => { tick = handler; return 1; },
      clearInterval: () => undefined,
    });
    await store.getState().start();
    await store.getState().resume();

    /** `seconds` of fixes at `speedMps`, fed as the navigation engine does: journal first, then the telemetry. */
    async function ride(seconds: number, speedMps: number): Promise<void> {
      for (let second = 0; second < seconds; second += 1) {
        clock += 1_000;
        north += speedMps;
        const observedAt = new Date(clock).toISOString();
        const fix: PositionFix = {
          coordinate: { lon: -75.44, lat: 40.14 + north / METERS_PER_DEGREE },
          observedAt,
          accuracyMeters: 5,
          headingDegrees: 0,
          speedMps,
        };
        const applied = await controller.dispatch({ type: "position.updated", at: observedAt, position: fix });
        if (applied.outcome === "applied") freeRideTelemetry.accept(fix, controller.snapshot()!);
      }
      tick?.();
    }

    return { store, ride, freeRideTelemetry };
  }

  return {
    page,
    first,
    telemetryStorage,
    wait: (ms: number) => { clock += ms; },
  };
}

/** The strip's clock text for a moving time: `m:ss`. */
function clock(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function slotValue(model: NonNullable<ReturnType<typeof readModel>>, index: number): string {
  return model.slots[index]!.reading.displayValue;
}

function readModel(store: Awaited<ReturnType<Awaited<ReturnType<typeof device>>["page"]>>["store"]) {
  return store.getState().viewModel?.metrics ?? null;
}

describe("Ride Focus: Free Ride moving time and max speed", () => {
  it("offers them in the picker, shows a value once chosen, and continues after a reload", async () => {
    const phone = await device();
    const before = await phone.page(phone.first);

    await before.ride(60, 30 * MPH);
    await before.ride(8, 0); // stopped at a junction: the strip may be changed now
    const stopped = readModel(before.store)!;
    expect(stopped.mode).toBe("free-ride");
    expect(stopped.shownIds).toEqual(["speed.current", "heading", "gps.accuracy"]);
    expect(stopped.customizable).toBe(true);

    render(<RideMetricPicker model={stopped} slotIndex={2} onChoose={vi.fn()} onPreset={vi.fn()} onClose={vi.fn()} />);
    for (const id of ["time.moving", "speed.max", "time.sinceStop", "speed.average", "elevation.gain", "elevation.loss"]) {
      expect(screen.getByTestId(`ride-metric-option-${id}`)).toBeInTheDocument();
    }
    // Only what the ride has a source for: no recorded distance without a recording.
    expect(screen.queryByTestId("ride-metric-option-distance.recorded")).toBeNull();
    cleanup();

    expect(before.store.getState().setRideMetric(2, "time.moving")).toBe(true);
    expect(before.store.getState().setRideMetric(1, "speed.max")).toBe(true);
    const chosen = readModel(before.store)!;
    expect(chosen.shownIds).toEqual(["speed.current", "speed.max", "time.moving"]);
    // A minute at 30 mph; the stop is left out (the hard stop's first second still reads as moving).
    const savedMovingMs = before.freeRideTelemetry.snapshot(phone.first.snapshot()!)!.movingMs;
    expect(savedMovingMs).toBeGreaterThanOrEqual(59_000);
    expect(savedMovingMs).toBeLessThanOrEqual(60_000);
    render(<RideMetricStrip model={chosen} onShowControls={vi.fn()} onChooseSlot={vi.fn()} />);
    expect(screen.getByTestId("ride-metric-value-2")).toHaveTextContent(clock(savedMovingMs));
    expect(screen.getByTestId("ride-metric-value-1")).toHaveTextContent("30");
    expect(screen.getByTestId("ride-metric-slot-2")).toHaveAttribute("data-state", "ready");
    cleanup();

    // Reload: the page goes (the store stops and saves), 20 s pass, and a new page opens.
    before.store.getState().stop();
    expect(phone.telemetryStorage.values.has(FREE_RIDE_TELEMETRY_STORAGE_KEY)).toBe(true);
    phone.wait(20_000);
    const after = await phone.page();
    const restored = readModel(after.store)!;
    expect(restored.shownIds).toEqual(["speed.current", "speed.max", "time.moving"]);
    expect(slotValue(restored, 2)).toBe(clock(savedMovingMs));
    expect(slotValue(restored, 1)).toBe("30");

    await after.ride(30, 30 * MPH);
    const resumed = readModel(after.store)!;
    // It continues from the saved value: 30 fixes are 29 s of riding; the 20 s reload is not moving.
    expect(slotValue(resumed, 2)).toBe(clock(savedMovingMs + 29_000));
    render(<RideMetricStrip model={resumed} onShowControls={vi.fn()} onChooseSlot={vi.fn()} />);
    expect(screen.getByTestId("ride-metric-value-2")).toHaveTextContent(clock(savedMovingMs + 29_000));
    after.store.getState().stop();
  });

  it("drops the saved state when the Free Ride ends", async () => {
    const phone = await device();
    const page = await phone.page(phone.first);
    await page.ride(20, 30 * MPH);
    page.freeRideTelemetry.flush();
    expect(phone.telemetryStorage.values.has(FREE_RIDE_TELEMETRY_STORAGE_KEY)).toBe(true);
    page.store.getState().beginStop();
    await page.store.getState().finish();
    expect(page.store.getState().navigation?.activity).toBe("completed");
    expect(phone.telemetryStorage.values.has(FREE_RIDE_TELEMETRY_STORAGE_KEY)).toBe(false);
    page.store.getState().stop();
  });

  it("saves on pause and when the page hides", async () => {
    const phone = await device();
    const page = await phone.page(phone.first);
    await page.ride(3, 30 * MPH); // the first fix writes; the next ones wait on the 5 s throttle
    const written = () => phone.telemetryStorage.values.get(FREE_RIDE_TELEMETRY_STORAGE_KEY);
    const afterFirst = written();
    await page.ride(1, 30 * MPH);
    expect(written()).toBe(afterFirst);
    window.dispatchEvent(new Event("pagehide"));
    expect(written()).not.toBe(afterFirst);

    const beforePause = written();
    await page.ride(1, 30 * MPH);
    expect(written()).toBe(beforePause);
    await page.store.getState().pause();
    expect(written()).not.toBe(beforePause);
    page.store.getState().stop();
  });
});
