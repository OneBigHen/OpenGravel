import { describe, expect, it, vi } from "vitest";

import {
  createRideActivitySync,
  rideActivityState,
  type RideActivityPort,
} from "@/application/ride-session/ride-activity";
import type { RideFocusViewModel } from "@/application/ride-session/ride-focus-view-model";
import type { SessionInstruction } from "@/domain/ride-session/types";
import { nativeShellRideActivity, withTurnAlerts } from "@/infrastructure/ride/native-shell";

function viewModel(overrides: Partial<Record<string, unknown>> = {}): RideFocusViewModel {
  return {
    activity: "guided",
    activityLabel: "Guided ride",
    guidance: {
      kind: "maneuver",
      maneuver: {
        actionText: "Turn left", roadName: "Hawk Mountain Rd", roadPreposition: "onto",
        distanceText: "in 0.3 mi", distanceMeters: 480, glyph: "left", label: "Turn left onto Hawk Mountain Rd in 0.3 mi",
      },
    },
    progress: { fraction: 0.4213, fractionText: "42%", stopsText: null },
    secondary: { etaText: "3:42 PM", remainingText: "24 mi · 41 min" },
    terminal: null,
    ...overrides,
  } as unknown as RideFocusViewModel;
}

function port(): RideActivityPort & { [K in keyof RideActivityPort]: ReturnType<typeof vi.fn> } {
  return { start: vi.fn(async () => undefined), update: vi.fn(async () => undefined), end: vi.fn(async () => undefined) };
}

describe("rideActivityState", () => {
  it("puts the next turn, the road, ETA and what is left on the Lock Screen", () => {
    expect(rideActivityState(viewModel())).toEqual({
      title: "Guided ride",
      state: {
        glyph: "left", distance: "in 0.3 mi", action: "Turn left", road: "onto Hawk Mountain Rd",
        eta: "3:42 PM", remaining: "24 mi · 41 min", progress: 0.42,
      },
    });
  });

  it("says what is happening without a maneuver, and never shows Unknown", () => {
    const free = rideActivityState(viewModel({
      activity: "free", activityLabel: "Free Ride",
      guidance: { kind: "waiting", text: "No maneuver issued yet." },
      progress: { fraction: null, fractionText: "", stopsText: null },
      secondary: { etaText: "Unknown", remainingText: "Unknown" },
    }));
    expect(free?.state).toMatchObject({ glyph: "", distance: "", action: "Riding your own way", eta: "", remaining: "", progress: -1 });
  });

  it("is nothing once the ride has ended", () => {
    expect(rideActivityState(null)).toBeNull();
    expect(rideActivityState(viewModel({ terminal: { title: "Ride saved", text: "" } }))).toBeNull();
  });
});

describe("createRideActivitySync", () => {
  it("starts once, sends only real changes, and ends with the ride", async () => {
    const native = port();
    const sync = createRideActivitySync(native);
    sync.sync(viewModel());
    sync.sync(viewModel());
    sync.sync(viewModel({ secondary: { etaText: "3:43 PM", remainingText: "24 mi · 41 min" } }));
    sync.sync(null);
    await sync.flush();
    expect(native.start).toHaveBeenCalledOnce();
    expect(native.update).toHaveBeenCalledOnce();
    expect(native.end).toHaveBeenCalledOnce();
  });

  it("lights the Lock Screen for an announced turn, and never before a ride is live", async () => {
    const native = port();
    const sync = createRideActivitySync(native);
    sync.alert({ title: "early", body: "" });
    sync.sync(viewModel());
    sync.alert({ title: "In 500 feet, turn left onto Hawk Mountain Rd", body: "" });
    await sync.flush();
    expect(native.update).toHaveBeenCalledOnce();
    expect(native.update.mock.calls[0]?.[1]).toEqual({ title: "In 500 feet, turn left onto Hawk Mountain Rd", body: "" });
  });

  it("keeps the ride going when the native call fails", async () => {
    const native = port();
    native.start.mockRejectedValueOnce(new Error("Live Activities are off"));
    const sync = createRideActivitySync(native);
    sync.sync(viewModel());
    sync.sync(viewModel({ secondary: { etaText: "3:50 PM", remainingText: "20 mi" } }));
    await expect(sync.flush()).resolves.toBeUndefined();
    expect(native.update).toHaveBeenCalledOnce();
  });
});

describe("native shell ride activity", () => {
  const cue: SessionInstruction = {
    instructionId: "ins_1" as SessionInstruction["instructionId"],
    kind: "turn", maneuver: "left", roadName: "Hawk Mountain Rd", distanceMeters: 150, targetStopId: null,
  };

  it("is absent outside the app and in app builds without the plugin", () => {
    expect(nativeShellRideActivity({})).toBeUndefined();
    expect(nativeShellRideActivity({ Capacitor: { isNativePlatform: () => true, Plugins: {} } })).toBeUndefined();
  });

  it("passes an alert to the plugin with the state", async () => {
    const plugin = { start: vi.fn(async () => ({})), update: vi.fn(async () => undefined), end: vi.fn(async () => undefined) };
    const activity = nativeShellRideActivity({ Capacitor: { isNativePlatform: () => true, Plugins: { RideActivity: plugin } } });
    const state = rideActivityState(viewModel())!.state;
    await activity?.update(state, { title: "Turn left", body: "" });
    expect(plugin.update).toHaveBeenCalledWith({ state, alertTitle: "Turn left", alertBody: "" });
  });

  it("alerts with the words the rider hears, and still speaks them", async () => {
    const speak = vi.fn();
    const alerts: string[] = [];
    const speech = withTurnAlerts({ speak }, (title) => alerts.push(title));
    await speech.speak(cue);
    expect(speak).toHaveBeenCalledWith(cue);
    expect(alerts[0]).toMatch(/^In 500 feet, turn left onto Hawk Mountain Rd$/);
  });
});
