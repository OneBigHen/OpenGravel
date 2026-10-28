import { describe, expect, it, vi } from "vitest";

import {
  clockSeconds,
  createLiveActivitySync,
  liveActivityState,
  type LiveActivityInput,
  type LiveActivityPort,
} from "@/application/native/live-activity";
import type { BreadcrumbNavigationWaypoint } from "@/application/persistence/ride-focus-pointer";
import type { RideFocusViewModel } from "@/application/ride-session/ride-focus-view-model";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { SessionInstruction } from "@/domain/ride-session/types";
import { liveActivitySupported, nativeShellLiveActivity } from "@/infrastructure/native/live-activity-bridge";
import { withTurnAlerts } from "@/infrastructure/ride/native-shell";

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
    position: { speedText: null },
    recording: null,
    climbGainText: null,
    terminal: null,
    ...overrides,
  } as unknown as RideFocusViewModel;
}

function input(overrides: Partial<LiveActivityInput> & { readonly model?: Partial<Record<string, unknown>> } = {}): LiveActivityInput {
  const { model, ...rest } = overrides;
  return { viewModel: viewModel(model), navigation: null, breadcrumbWaypoints: null, hiking: false, ...rest };
}

const waypoints: readonly BreadcrumbNavigationWaypoint[] = [
  { coordinate: { lat: 40, lon: -77 }, name: "Trailhead", distanceAlongMeters: 0 },
  { coordinate: { lat: 40.01, lon: -77 }, name: "Overlook", distanceAlongMeters: 1100 },
  { coordinate: { lat: 40.02, lon: -77 }, name: null, distanceAlongMeters: 2200 },
];

function trailNavigation(overrides: Record<string, unknown> = {}): SessionNavigationState {
  return {
    activity: "track", resumeActivity: null, offRouteState: "on-route", plan: { route: null },
    position: { quality: "fresh-good", coordinate: { lat: 40.004, lon: -77 } },
    ...overrides,
  } as unknown as SessionNavigationState;
}

function port(): LiveActivityPort & { [K in keyof LiveActivityPort]: ReturnType<typeof vi.fn> } {
  return { start: vi.fn(async () => undefined), update: vi.fn(async () => undefined), end: vi.fn(async () => undefined) };
}

describe("liveActivityState: guided ride", () => {
  it("puts the next turn, the road, ETA and what is left on the Lock Screen", () => {
    expect(liveActivityState(input())).toEqual({
      title: "Guided ride",
      state: expect.objectContaining({
        kind: "guided", glyph: "left", distance: "in 0.3 mi", action: "Turn left", road: "onto Hawk Mountain Rd",
        eta: "3:42 PM", remaining: "24 mi · 41 min", progress: 0.42, warning: "", elapsedSeconds: -1,
      }),
    });
  });

  it("says what is happening without a maneuver, and never shows Unknown", () => {
    const waiting = liveActivityState(input({
      model: {
        guidance: { kind: "waiting", text: "No maneuver issued yet." },
        progress: { fraction: null, fractionText: "", stopsText: null },
        secondary: { etaText: "Unknown", remainingText: "Unknown" },
      },
    }));
    expect(waiting?.state).toMatchObject({ kind: "guided", glyph: "", distance: "", action: "Follow the route", eta: "", remaining: "", progress: -1 });
  });

  it("is nothing once the ride has ended", () => {
    expect(liveActivityState(input({ viewModel: null }))).toBeNull();
    expect(liveActivityState(input({ model: { terminal: { title: "Ride saved", text: "" } } }))).toBeNull();
    expect(liveActivityState(input({ model: { activity: "completed" } }))).toBeNull();
  });
});

describe("liveActivityState: Free Ride and recording", () => {
  const recording = { distanceText: "12.4 mi", elapsedTimeText: "1:02:03", currentSpeedText: "—", waitingForFix: false };

  it("shows elapsed time, distance and speed instead of a maneuver", () => {
    const free = liveActivityState(input({
      model: {
        activity: "free", activityLabel: "Recording", guidance: { kind: "waiting", text: "" },
        progress: { fraction: null, fractionText: "", stopsText: null },
        secondary: { etaText: "Unknown", remainingText: "Unknown" },
        position: { speedText: "42 mph" }, recording, climbGainText: "820 ft",
      },
    }));
    expect(free).toEqual({
      title: "Recording",
      state: expect.objectContaining({
        kind: "free", action: "Recording", elapsedSeconds: 3723, distanceDone: "12.4 mi", speed: "42 mph", gain: "820 ft", glyph: "", eta: "",
      }),
    });
  });

  it("has no clock until the recording has a fix", () => {
    const waiting = liveActivityState(input({
      model: { activity: "free", activityLabel: "Free ride", recording: { ...recording, waitingForFix: true, distanceText: "Unknown" } },
    }));
    expect(waiting?.state).toMatchObject({ elapsedSeconds: -1, distanceDone: "" });
  });

  it("parses recording clocks", () => {
    expect(clockSeconds("12:34")).toBe(754);
    expect(clockSeconds("1:02:03")).toBe(3723);
    expect(clockSeconds("—")).toBe(-1);
  });
});

describe("liveActivityState: hike", () => {
  const hike = (overrides: Partial<LiveActivityInput> = {}, model: Record<string, unknown> = {}): ReturnType<typeof liveActivityState> =>
    liveActivityState(input({
      hiking: true, breadcrumbWaypoints: waypoints, navigation: trailNavigation(),
      model: {
        activity: "track", activityLabel: "Following a track", guidance: { kind: "waiting", text: "" },
        progress: { fraction: 0.25, fractionText: "25%", stopsText: null },
        secondary: { etaText: "Unknown", remainingText: "Unknown" }, climbGainText: "310 ft", ...model,
      },
      ...overrides,
    }));

  it("shows distance left, the next waypoint, climb so far and the way back", () => {
    const result = hike();
    expect(result?.title).toBe("Hike");
    expect(result?.state).toMatchObject({
      kind: "hike", action: "Overlook", warning: "", gain: "310 ft", progress: 0.25, eta: "", remaining: "1 mi",
    });
    // 0.004 degrees of latitude is about 445 m, and 0.006 about 667 m to the overlook.
    expect(result?.state.toStart).toBe("0.3 mi");
    expect(result?.state.distance).toBe("0.4 mi");
  });

  it("warns when off the trail", () => {
    expect(hike({ navigation: trailNavigation({ offRouteState: "off-route" }) })?.state.warning).toBe("Off the trail");
    expect(hike({ navigation: trailNavigation({ offRouteState: "rejoining" }) })?.state.warning).toBe("Off the trail");
  });

  it("does not guess without a fix", () => {
    const state = hike({ navigation: trailNavigation({ position: { quality: "stale", coordinate: { lat: 40, lon: -77 } } }) })?.state;
    expect(state).toMatchObject({ action: "Waiting for location", distance: "", toStart: "" });
  });

  it("is a Free Ride style recording when followed in ride mode", () => {
    expect(hike({ hiking: false })?.state.kind).toBe("free");
  });
});

describe("createLiveActivitySync", () => {
  function clock() {
    let time = 100_000;
    const timers: { run: () => void; at: number }[] = [];
    return {
      now: () => time,
      advance(ms: number) {
        time += ms;
        const due = timers.filter((entry) => entry.at <= time);
        for (const entry of due) timers.splice(timers.indexOf(entry), 1);
        for (const entry of due) entry.run();
      },
      schedule: (run: () => void, delay: number) => { const entry = { run, at: time + delay }; timers.push(entry); return entry; },
      unschedule: (handle: unknown) => { const at = timers.indexOf(handle as (typeof timers)[number]); if (at >= 0) timers.splice(at, 1); },
    };
  }
  const withEta = (eta: string) => input({ model: { secondary: { etaText: eta, remainingText: "24 mi · 41 min" } } });

  it("starts once, sends only real changes, and ends with the ride", async () => {
    const native = port();
    const time = clock();
    const sync = createLiveActivitySync(native, time);
    sync.sync(input());
    sync.sync(input());
    time.advance(6000);
    sync.sync(withEta("3:43 PM"));
    sync.sync(input({ viewModel: null }));
    await sync.flush();
    expect(native.start).toHaveBeenCalledOnce();
    expect(native.update).toHaveBeenCalledOnce();
    expect(native.end).toHaveBeenCalledOnce();
  });

  it("holds ordinary changes for five seconds, then sends the newest", async () => {
    const native = port();
    const time = clock();
    const sync = createLiveActivitySync(native, time);
    sync.sync(input());
    time.advance(1000);
    sync.sync(withEta("3:43 PM"));
    time.advance(1000);
    sync.sync(withEta("3:44 PM"));
    await sync.flush();
    expect(native.update).not.toHaveBeenCalled();
    time.advance(3000);
    await sync.flush();
    expect(native.update).toHaveBeenCalledOnce();
    expect(native.update.mock.calls[0]?.[0]).toMatchObject({ eta: "3:44 PM" });
  });

  it("sends a new maneuver or a warning straight away", async () => {
    const native = port();
    const time = clock();
    const sync = createLiveActivitySync(native, time);
    sync.sync(input());
    time.advance(500);
    sync.sync(input({ model: { guidance: { kind: "maneuver", maneuver: { actionText: "Turn right", roadName: null, roadPreposition: "onto", distanceText: "now", distanceMeters: 5, glyph: "right", label: "" } } } }));
    await sync.flush();
    expect(native.update).toHaveBeenCalledOnce();
    const trail = (offRouteState: string) => input({
      hiking: true, breadcrumbWaypoints: waypoints, navigation: trailNavigation({ offRouteState }),
      model: { activity: "track", guidance: { kind: "waiting", text: "" }, progress: { fraction: 0.25 } },
    });
    const hiking = createLiveActivitySync(native, time);
    hiking.sync(trail("on-route"));
    time.advance(500);
    hiking.sync(trail("off-route"));
    await hiking.flush();
    expect(native.update).toHaveBeenCalledTimes(2);
    expect(native.update.mock.calls[1]?.[0]).toMatchObject({ warning: "Off the trail" });
  });

  it("starts a fresh activity when a ride becomes a recording", async () => {
    const native = port();
    const time = clock();
    const sync = createLiveActivitySync(native, time);
    sync.sync(input());
    sync.sync(input({ model: { activity: "free", activityLabel: "Free ride", recording: null } }));
    await sync.flush();
    expect(native.start).toHaveBeenCalledTimes(2);
    expect(native.end).toHaveBeenCalledOnce();
  });

  it("ends and stays quiet while the rider has it switched off", async () => {
    const native = port();
    let enabled = true;
    const sync = createLiveActivitySync(native, { ...clock(), enabled: () => enabled });
    sync.sync(input());
    enabled = false;
    sync.sync(input());
    sync.sync(withEta("4:00 PM"));
    await sync.flush();
    expect(native.start).toHaveBeenCalledOnce();
    expect(native.end).toHaveBeenCalledOnce();
    enabled = true;
    sync.sync(input());
    await sync.flush();
    expect(native.start).toHaveBeenCalledTimes(2);
  });

  it("lights the Lock Screen for an announced turn, and never before a ride is live", async () => {
    const native = port();
    const sync = createLiveActivitySync(native, clock());
    sync.alert({ title: "early", body: "" });
    sync.sync(input());
    sync.alert({ title: "In 500 feet, turn left onto Hawk Mountain Rd", body: "" });
    await sync.flush();
    expect(native.update).toHaveBeenCalledOnce();
    expect(native.update.mock.calls[0]?.[1]).toEqual({ title: "In 500 feet, turn left onto Hawk Mountain Rd", body: "" });
  });

  it("ends when the screen goes away, and cancels a waiting update", async () => {
    const native = port();
    const time = clock();
    const sync = createLiveActivitySync(native, time);
    sync.sync(input());
    time.advance(1000);
    sync.sync(withEta("3:50 PM"));
    sync.dispose();
    time.advance(10_000);
    await sync.flush();
    expect(native.update).not.toHaveBeenCalled();
    expect(native.end).toHaveBeenCalledOnce();
  });

  it("keeps the ride going when the native call fails", async () => {
    const native = port();
    native.start.mockRejectedValueOnce(new Error("Live Activities are off"));
    const time = clock();
    const sync = createLiveActivitySync(native, time);
    sync.sync(input());
    time.advance(6000);
    sync.sync(withEta("3:50 PM"));
    await expect(sync.flush()).resolves.toBeUndefined();
    expect(native.update).toHaveBeenCalledOnce();
  });
});

describe("native shell live activity", () => {
  const cue: SessionInstruction = {
    instructionId: "ins_1" as SessionInstruction["instructionId"],
    kind: "turn", maneuver: "left", roadName: "Hawk Mountain Rd", distanceMeters: 150, targetStopId: null,
  };
  const app = (plugin: object) => ({ Capacitor: { isNativePlatform: () => true, Plugins: { RideActivity: plugin } } });

  it("is absent outside the app and in app builds without the plugin", async () => {
    expect(nativeShellLiveActivity({})).toBeUndefined();
    expect(nativeShellLiveActivity({ Capacitor: { isNativePlatform: () => true, Plugins: {} } })).toBeUndefined();
    expect(await liveActivitySupported({})).toBe(false);
  });

  it("passes an alert to the plugin with the state", async () => {
    const plugin = { start: vi.fn(async () => ({})), update: vi.fn(async () => undefined), end: vi.fn(async () => undefined) };
    const activity = nativeShellLiveActivity(app(plugin));
    const state = liveActivityState(input())!.state;
    await activity?.update(state, { title: "Turn left", body: "" });
    expect(plugin.update).toHaveBeenCalledWith({ state, alertTitle: "Turn left", alertBody: "" });
  });

  it("asks the phone whether Live Activities are allowed", async () => {
    const plugin = { isAvailable: vi.fn(async () => ({ available: true })), start: vi.fn(), update: vi.fn(), end: vi.fn() };
    expect(await liveActivitySupported(app(plugin))).toBe(true);
    plugin.isAvailable.mockRejectedValueOnce(new Error("nope"));
    expect(await liveActivitySupported(app(plugin))).toBe(false);
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
