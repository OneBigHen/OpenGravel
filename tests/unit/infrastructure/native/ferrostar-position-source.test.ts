import { describe, expect, it, vi } from "vitest";

import type { NativeNavigationPayloadV1 } from "@/application/ride-session/native-navigation-contract";
import type { NativeNavigationBridge, NativeNavigationEvents } from "@/infrastructure/native/ferrostar-bridge";
import { createFerrostarPositionSource } from "@/infrastructure/native/ferrostar-position-source";

const payload = { routeId: "route_1" } as NativeNavigationPayloadV1;

function bridge(accepted = true) {
  const listeners = new Map<string, (data: unknown) => void>();
  const removed: string[] = [];
  const fake = {
    isAvailable: vi.fn(async () => ({ available: true })),
    start: vi.fn(async () => ({ accepted })),
    replaceRoute: vi.fn(async () => ({ accepted: true })),
    stop: vi.fn(async () => undefined),
    setMuted: vi.fn(async () => undefined),
    showOverview: vi.fn(async () => undefined),
    recenter: vi.fn(async () => undefined),
    addListener: vi.fn(async (event: string, listener: (data: unknown) => void) => {
      listeners.set(event, listener);
      return { remove: () => void removed.push(event) };
    }),
  };
  const emit = <E extends keyof NativeNavigationEvents>(event: E, data: NativeNavigationEvents[E]): void =>
    listeners.get(event)?.(data);
  return { fake: fake as unknown as NativeNavigationBridge & typeof fake, emit, removed };
}

const fix = {
  lat: 40.8, lon: -75.7, accuracyMeters: 5, headingDegrees: 90, speedMps: 12, observedAt: "2026-09-27T12:00:00.000Z",
};

describe("Ferrostar position source (F2)", () => {
  it("starts native navigation on the selected route and relays its device fixes", async () => {
    const { fake, emit } = bridge();
    const observer = { position: vi.fn(), error: vi.fn() };
    createFerrostarPositionSource({ bridge: fake, payload, simulate: true }).watch(observer);
    await Promise.resolve();
    expect(fake.start).toHaveBeenCalledWith({ payload, simulate: true });
    emit("routeProgress", {
      routeId: "route_1", distanceRemainingMeters: 1000, durationRemainingSeconds: 90,
      distanceToNextManeuverMeters: 200, stepIndex: 1, location: fix,
    });
    expect(observer.position).toHaveBeenCalledWith({
      coordinate: { lat: 40.8, lon: -75.7 },
      observedAt: fix.observedAt,
      accuracyMeters: 5,
      headingDegrees: 90,
      speedMps: 12,
    });
  });

  it("asks for headless guidance when OpenGravel's ride screen stays in front", async () => {
    const { fake } = bridge();
    createFerrostarPositionSource({ bridge: fake, payload, presentation: "headless" })
      .watch({ position: vi.fn(), error: vi.fn() });
    await Promise.resolve();
    expect(fake.start).toHaveBeenCalledWith({ payload, presentation: "headless" });
  });

  it("carries the rider's voice mute to Ferrostar, now and on every change", async () => {
    const { fake } = bridge();
    let muted = true;
    const listeners = new Set<() => void>();
    const watch = createFerrostarPositionSource({
      bridge: fake,
      payload,
      handoffMs: 0,
      voiceMute: { read: () => muted, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } },
    }).watch({ position: vi.fn(), error: vi.fn() });
    await vi.waitFor(() => expect(fake.setMuted).toHaveBeenCalledWith({ muted: true }));
    muted = false;
    for (const listener of listeners) listener();
    expect(fake.setMuted).toHaveBeenLastCalledWith({ muted: false });
    watch.stop();
    expect(listeners.size).toBe(0);
  });

  it("relays Ferrostar's deviation verdict so native off-route state can trigger rerouting", () => {
    const { fake, emit } = bridge();
    const observer = { position: vi.fn(), error: vi.fn(), routeDeviation: vi.fn() };
    createFerrostarPositionSource({ bridge: fake, payload }).watch(observer);

    emit("offRouteChanged", { routeId: "route_1", offRoute: true });
    expect(observer.routeDeviation).toHaveBeenCalledWith(true);

    emit("offRouteChanged", { routeId: "route_old", offRoute: false });
    expect(observer.routeDeviation).toHaveBeenCalledTimes(1);
  });

  it("ignores another route's events", async () => {
    const { fake, emit } = bridge();
    const observer = { position: vi.fn(), error: vi.fn() };
    createFerrostarPositionSource({ bridge: fake, payload }).watch(observer);
    emit("routeProgress", {
      routeId: "route_old", distanceRemainingMeters: 1, durationRemainingSeconds: 1,
      distanceToNextManeuverMeters: 1, stepIndex: 0, location: fix,
    });
    expect(observer.position).not.toHaveBeenCalled();
  });

  it("reports the rider closing the native screen, but not its own stop", async () => {
    const { fake, emit, removed } = bridge();
    const onNativeEnded = vi.fn();
    const watch = createFerrostarPositionSource({ bridge: fake, payload, onNativeEnded, handoffMs: 0 })
      .watch({ position: vi.fn(), error: vi.fn() });
    emit("navigationEnded", { routeId: "route_1", reason: "exit" });
    expect(onNativeEnded).toHaveBeenCalledWith("exit");
    emit("navigationEnded", { routeId: "route_1", reason: "web" });
    expect(onNativeEnded).toHaveBeenCalledTimes(1);
    watch.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.stop).toHaveBeenCalledTimes(1);
    expect(removed.sort()).toEqual(["navigationEnded", "offRouteChanged", "routeProgress"]);
  });

  it("a refused start reads as no position, never a silent ride", async () => {
    const { fake } = bridge(false);
    const observer = { position: vi.fn(), error: vi.fn() };
    createFerrostarPositionSource({ bridge: fake, payload }).watch(observer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observer.error).toHaveBeenCalledWith({ code: "position-unavailable" });
  });

  it("a re-planned route replaces the running one in place; the native screen never closes (F3)", async () => {
    vi.useFakeTimers();
    try {
      const { fake } = bridge();
      const first = createFerrostarPositionSource({ bridge: fake, payload }).watch({ position: vi.fn(), error: vi.fn() });
      first.stop();
      const rerouted = { routeId: "route_2" } as NativeNavigationPayloadV1;
      const second = createFerrostarPositionSource({ bridge: fake, payload: rerouted })
        .watch({ position: vi.fn(), error: vi.fn() });
      await vi.runAllTimersAsync();
      expect(fake.start).toHaveBeenCalledTimes(1);
      expect(fake.replaceRoute).toHaveBeenCalledWith({ payload: rerouted });
      expect(fake.stop).not.toHaveBeenCalled();
      second.stop();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(fake.stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to a fresh start when the replacement is refused", async () => {
    vi.useFakeTimers();
    try {
      const { fake } = bridge();
      fake.replaceRoute.mockRejectedValueOnce(new Error("not-navigating"));
      createFerrostarPositionSource({ bridge: fake, payload }).watch({ position: vi.fn(), error: vi.fn() }).stop();
      const observer = { position: vi.fn(), error: vi.fn() };
      createFerrostarPositionSource({ bridge: fake, payload: { routeId: "route_2" } as NativeNavigationPayloadV1 })
        .watch(observer);
      await vi.runAllTimersAsync();
      expect(fake.start).toHaveBeenCalledTimes(2);
      expect(observer.error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
