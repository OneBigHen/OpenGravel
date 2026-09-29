import { describe, expect, it, vi } from "vitest";

import { spokenManeuver } from "@/application/ride-session/ride-focus-view-model";
import type { SessionInstruction } from "@/domain/ride-session/types";
import { nativeShellPositionSource, nativeShellSpeech, nativeShellWakeLock } from "@/infrastructure/ride/native-shell";

function shell(native: boolean) {
  const plugin = { keepAwake: vi.fn(async () => undefined), allowSleep: vi.fn(async () => undefined) };
  return { plugin, scope: { Capacitor: { isNativePlatform: () => native, Plugins: { KeepAwake: plugin } } } };
}

describe("nativeShellWakeLock", () => {
  it("is absent in a plain browser and in Capacitor's web runtime", () => {
    expect(nativeShellWakeLock({})).toBeUndefined();
    expect(nativeShellWakeLock(shell(false).scope)).toBeUndefined();
  });

  it("keeps the screen awake through the iOS shell and lets it sleep once on release", async () => {
    const { plugin, scope } = shell(true);
    const lock = nativeShellWakeLock(scope);
    if (lock === undefined) throw new Error("expected the native wake lock");

    const sentinel = await lock.request("screen");
    expect(plugin.keepAwake).toHaveBeenCalledOnce();
    expect(sentinel.released).toBe(false);

    await sentinel.release();
    await sentinel.release();
    expect(sentinel.released).toBe(true);
    expect(plugin.allowSleep).toHaveBeenCalledOnce();
  });
});

describe("nativeShellPositionSource", () => {
  function geolocationShell(syncId = false) {
    let callback: ((location?: unknown, error?: { code?: string }) => void) | null = null;
    const plugin = {
      addWatcher: vi.fn((_options: unknown, next: typeof callback) => {
        callback = next;
        return syncId ? "watcher-1" : Promise.resolve("watcher-1");
      }),
      removeWatcher: vi.fn(async () => undefined),
    };
    return {
      plugin,
      emit: (location?: unknown, error?: { code?: string }) => callback?.(location, error),
      scope: { Capacitor: { isNativePlatform: () => true, Plugins: { BackgroundGeolocation: plugin } } },
    };
  }

  it("works when the plugin answers its watcher id synchronously, as it does through Capacitor.Plugins on the iPhone", async () => {
    const shell = geolocationShell(true);
    const source = nativeShellPositionSource(shell.scope);
    if (source === undefined) throw new Error("expected the native position source");
    const position = vi.fn();
    const error = vi.fn();
    const watch = source.watch({ position, error });
    shell.emit({ latitude: 40.18, longitude: -75.4, accuracy: 4, bearing: null, speed: null, time: Date.parse("2026-09-26T14:55:00.000Z") });
    expect(position).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    watch.stop();
    await vi.waitFor(() => expect(shell.plugin.removeWatcher).toHaveBeenCalledWith({ id: "watcher-1" }));
  });

  it("passes the plugin's altitude through, with a negative 'unknown' vertical accuracy as null", () => {
    const shell = geolocationShell(true);
    const source = nativeShellPositionSource(shell.scope);
    if (source === undefined) throw new Error("expected the native position source");
    const position = vi.fn();
    source.watch({ position, error: vi.fn() });
    const time = Date.parse("2026-09-26T14:55:00.000Z");
    shell.emit({ latitude: 40.18, longitude: -75.4, accuracy: 4, bearing: null, speed: null, time, altitude: 122.5, altitudeAccuracy: 3 });
    shell.emit({ latitude: 40.18, longitude: -75.4, accuracy: 4, bearing: null, speed: null, time, altitude: 122.5, altitudeAccuracy: -1 });
    shell.emit({ latitude: 40.18, longitude: -75.4, accuracy: 4, bearing: null, speed: null, time, altitude: null, altitudeAccuracy: null });
    expect(position.mock.calls[0]?.[0]).toMatchObject({ altitudeMeters: 122.5, altitudeAccuracyMeters: 3 });
    expect(position.mock.calls[1]?.[0]).toMatchObject({ altitudeMeters: 122.5, altitudeAccuracyMeters: null });
    expect(position.mock.calls[2]?.[0]).not.toHaveProperty("altitudeMeters");
  });

  it("is absent outside the iOS shell", () => {
    expect(nativeShellPositionSource({})).toBeUndefined();
  });

  it("feeds native fixes to the ride, with iOS's negative 'unknown' course and speed as null", async () => {
    const shell = geolocationShell();
    const source = nativeShellPositionSource(shell.scope);
    if (source === undefined) throw new Error("expected the native position source");
    const position = vi.fn();
    const error = vi.fn();
    const watch = source.watch({ position, error });

    expect(shell.plugin.addWatcher).toHaveBeenCalledWith(expect.objectContaining({ backgroundMessage: expect.any(String), requestPermissions: true, stale: true }), expect.any(Function));
    shell.emit({ latitude: 40.1, longitude: -75.4, accuracy: 6, bearing: -1, speed: -1, time: Date.parse("2026-09-26T05:00:00.000Z") });
    shell.emit({ latitude: 40.2, longitude: -75.5, accuracy: 5, bearing: 90, speed: 17.5, time: Date.parse("2026-09-26T05:00:01.000Z") });
    shell.emit(undefined, { code: "NOT_AUTHORIZED" });

    expect(position.mock.calls.map(([fix]) => fix)).toEqual([
      { coordinate: { lon: -75.4, lat: 40.1 }, observedAt: "2026-09-26T05:00:00.000Z", accuracyMeters: 6, headingDegrees: null, speedMps: null },
      { coordinate: { lon: -75.5, lat: 40.2 }, observedAt: "2026-09-26T05:00:01.000Z", accuracyMeters: 5, headingDegrees: 90, speedMps: 17.5 },
    ]);
    expect(error).toHaveBeenCalledWith({ code: "permission-denied" });

    watch.stop();
    shell.emit({ latitude: 41, longitude: -75, accuracy: 5, bearing: null, speed: null, time: null });
    expect(position).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(shell.plugin.removeWatcher).toHaveBeenCalledWith({ id: "watcher-1" }));
  });
});

describe("nativeShellSpeech", () => {
  const cue: SessionInstruction = {
    instructionId: "ins_1" as SessionInstruction["instructionId"],
    kind: "turn", maneuver: "left", roadName: "1st Avenue", distanceMeters: 250, targetStopId: null,
  };
  const tts = () => ({ speak: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) });

  it("is absent in a browser, and in an app build without the plugin", () => {
    expect(nativeShellSpeech({})).toBeUndefined();
    expect(nativeShellSpeech({ Capacitor: { isNativePlatform: () => false, Plugins: { TextToSpeech: tts() } } })).toBeUndefined();
    expect(nativeShellSpeech({ Capacitor: { isNativePlatform: () => true, Plugins: {} } })).toBeUndefined();
  });

  it("speaks the maneuver through iOS's playback session, so it keeps talking when the phone locks", async () => {
    const plugin = tts();
    const speech = nativeShellSpeech({ Capacitor: { isNativePlatform: () => true, Plugins: { TextToSpeech: plugin } } });
    if (speech === undefined) throw new Error("expected native speech");
    await speech.speak(cue);
    expect(plugin.speak).toHaveBeenCalledWith({ text: spokenManeuver(cue), lang: "en-US", rate: 1, category: "playback" });
    await speech.cancel?.();
    expect(plugin.stop).toHaveBeenCalledOnce();
  });
});
