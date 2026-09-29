/**
 * The OpenGravel iOS app (apps/ios, Capacitor) loads this site in a WKWebView
 * and injects `window.Capacitor`. Two web APIs fall short there, so the shell's
 * native plugins stand in behind the same shapes the ride already uses:
 * - KeepAwake replaces `navigator.wakeLock`, which WKWebView does not honour
 *   reliably;
 * - BackgroundGeolocation replaces `watchPosition` for the ride, which stops
 *   when the phone locks.
 * In a browser each factory returns `undefined` and nothing changes.
 */

import type { PositionSource } from "@/application/ride-session/position-pipeline";
import { spokenManeuver } from "@/application/ride-session/ride-focus-view-model";
import type { SpeechPort } from "@/application/ride-session/speech";
import type { RideActivityPort, RideActivityState } from "@/application/ride-session/ride-activity";

interface KeepAwakePlugin {
  keepAwake(): Promise<void>;
  allowSleep(): Promise<void>;
}

interface CapacitorGlobal {
  readonly isNativePlatform?: () => boolean;
  readonly Plugins?: { readonly KeepAwake?: KeepAwakePlugin };
}

function keepAwakePlugin(scope: unknown): KeepAwakePlugin | undefined {
  const capacitor = (scope as { readonly Capacitor?: CapacitorGlobal } | undefined)?.Capacitor;
  if (capacitor?.isNativePlatform?.() !== true) return undefined;
  const plugin = capacitor.Plugins?.KeepAwake;
  return typeof plugin?.keepAwake === "function" && typeof plugin.allowSleep === "function" ? plugin : undefined;
}

/** A `WakeLock` backed by the native shell, or `undefined` outside it. */
export function nativeShellWakeLock(scope: unknown = globalThis): WakeLock | undefined {
  const plugin = keepAwakePlugin(scope);
  if (plugin === undefined) return undefined;
  return {
    async request(): Promise<WakeLockSentinel> {
      await plugin.keepAwake();
      let released = false;
      const sentinel = {
        type: "screen" as const,
        get released() { return released; },
        onrelease: null,
        async release(): Promise<void> {
          if (released) return;
          released = true;
          await plugin.allowSleep();
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      };
      return sentinel as unknown as WakeLockSentinel;
    },
  };
}

interface NativeLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
  readonly bearing: number | null;
  readonly speed: number | null;
  readonly time: number | null;
  /** Metres above sea level; the plugin reports `null` when unknown. */
  readonly altitude?: number | null;
  readonly altitudeAccuracy?: number | null;
}

interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      readonly backgroundMessage: string;
      readonly backgroundTitle: string;
      readonly requestPermissions: boolean;
      readonly stale: boolean;
      readonly distanceFilter: number;
    },
    callback: (location?: NativeLocation, error?: { readonly code?: string }) => void,
  ): Promise<string> | string;
  removeWatcher(options: { readonly id: string }): Promise<void>;
}

function backgroundGeolocationPlugin(scope: unknown): BackgroundGeolocationPlugin | undefined {
  const capacitor = (scope as { readonly Capacitor?: CapacitorGlobal & { readonly Plugins?: { readonly BackgroundGeolocation?: BackgroundGeolocationPlugin } } } | undefined)?.Capacitor;
  if (capacitor?.isNativePlatform?.() !== true) return undefined;
  const plugin = capacitor.Plugins?.BackgroundGeolocation;
  return typeof plugin?.addWatcher === "function" && typeof plugin.removeWatcher === "function" ? plugin : undefined;
}

/** True inside the installed iOS app (Capacitor's native platform), false in a browser. */
export function inNativeShell(scope: unknown = globalThis): boolean {
  const capacitor = (scope as { readonly Capacitor?: CapacitorGlobal } | undefined)?.Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

/** iOS reports an unknown course or speed as a negative number. */
function measured(value: number | null): number | null {
  return value === null || !Number.isFinite(value) || value < 0 ? null : value;
}

/**
 * Ride GPS through the iOS shell's background location watcher. A web view's
 * `watchPosition` stops when the phone locks or another app is in front, so a
 * ride would lose guidance and leave gaps in its recording. The native watcher
 * keeps delivering fixes (iOS shows the blue location indicator) until the
 * ride stops watching. `undefined` outside the shell.
 */
export function nativeShellPositionSource(scope: unknown = globalThis, now: () => number = Date.now): PositionSource | undefined {
  const plugin = backgroundGeolocationPlugin(scope);
  if (plugin === undefined) return undefined;
  return {
    // The watcher owns the prompt, as watchPosition does in a browser.
    permission: async () => "prompt",
    watch(observer) {
      let stopped = false;
      // Through `Capacitor.Plugins` a callback method answers its callback id
      // synchronously as a string, not a promise (seen on the owner's iPhone,
      // 2026-09-26): calling `.catch` on it threw, so every native watch failed
      // before its first fix. Accept both shapes.
      let id: Promise<string>;
      try {
        id = Promise.resolve(plugin.addWatcher(
          {
            backgroundMessage: "OpenGravel is following your ride.",
            backgroundTitle: "Ride in progress",
            requestPermissions: true,
            // A fresh-only watcher answers nothing until the phone moves (on
            // the owner's iPhone: no fix at all while standing at the start,
            // against 20 ms with stale allowed). Take the last known fix first;
            // each fix carries its own time, and the ride judges its age.
            stale: true,
            distanceFilter: 0,
          },
          (location, error) => {
            if (stopped) return;
            if (error !== undefined) {
              observer.error({ code: error.code === "NOT_AUTHORIZED" ? "permission-denied" : "position-unavailable" });
              return;
            }
            if (location === undefined) return;
            observer.position({
              coordinate: { lon: location.longitude, lat: location.latitude },
              observedAt: new Date(location.time ?? now()).toISOString(),
              accuracyMeters: location.accuracy,
              headingDegrees: measured(location.bearing),
              speedMps: measured(location.speed),
              // Only when the plugin reported one (it sends `null` when unknown).
              ...(typeof location.altitude === "number" && Number.isFinite(location.altitude)
                ? {
                    altitudeMeters: location.altitude,
                    altitudeAccuracyMeters: measured(location.altitudeAccuracy ?? null),
                  }
                : {}),
            });
          },
        ));
      } catch {
        id = Promise.reject(new Error("addWatcher failed"));
      }
      id.catch(() => {
        if (!stopped) observer.error({ code: "position-unavailable" });
      });
      return {
        stop: (): void => {
          stopped = true;
          void id.then((watcher) => plugin.removeWatcher({ id: watcher })).catch(() => undefined);
        },
      };
    },
  };
}

interface TextToSpeechPlugin {
  speak(options: {
    readonly text: string;
    readonly lang: string;
    readonly rate: number;
    readonly category: "ambient" | "playback";
  }): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Turn-by-turn voice through iOS's own synthesizer. The web view's
 * `speechSynthesis` falls silent once the phone locks, which is how a rider
 * with the phone in a tank bag rides; the `playback` audio session (with the
 * app's `audio` background mode) keeps speaking and reaches a Bluetooth
 * intercom. `undefined` outside the shell or in an app build without the
 * plugin, so the browser voice stands in.
 */
export function nativeShellSpeech(scope: unknown = globalThis): SpeechPort | undefined {
  const capacitor = (scope as { readonly Capacitor?: CapacitorGlobal & { readonly Plugins?: { readonly TextToSpeech?: TextToSpeechPlugin } } } | undefined)?.Capacitor;
  if (capacitor?.isNativePlatform?.() !== true) return undefined;
  const plugin = capacitor.Plugins?.TextToSpeech;
  if (typeof plugin?.speak !== "function" || typeof plugin.stop !== "function") return undefined;
  return {
    // The plugin flushes by default: the newest maneuver interrupts a stale one.
    speak: (cue) => plugin.speak({ text: spokenManeuver(cue), lang: "en-US", rate: 1, category: "playback" }),
    speakText: (text) => plugin.speak({ text, lang: "en-US", rate: 1, category: "playback" }),
    cancel: () => plugin.stop(),
  };
}

interface RideActivityPlugin {
  start(options: { readonly title: string; readonly state: RideActivityState }): Promise<unknown>;
  update(options: { readonly state: RideActivityState; readonly alertTitle?: string; readonly alertBody?: string }): Promise<unknown>;
  end(): Promise<unknown>;
}

/**
 * The ride's Live Activity (Lock Screen, Dynamic Island) through the app's own
 * RideActivity plugin. `undefined` outside the shell or in an app build that
 * predates the plugin.
 */
export function nativeShellRideActivity(scope: unknown = globalThis): RideActivityPort | undefined {
  const capacitor = (scope as { readonly Capacitor?: CapacitorGlobal & { readonly Plugins?: { readonly RideActivity?: RideActivityPlugin } } } | undefined)?.Capacitor;
  if (capacitor?.isNativePlatform?.() !== true) return undefined;
  const plugin = capacitor.Plugins?.RideActivity;
  if (typeof plugin?.start !== "function" || typeof plugin.update !== "function" || typeof plugin.end !== "function") return undefined;
  return {
    start: async (title, state) => { await plugin.start({ title, state }); },
    update: async (state, alert) => {
      await plugin.update(alert === undefined ? { state } : { state, alertTitle: alert.title, alertBody: alert.body });
    },
    end: async () => { await plugin.end(); },
  };
}

/**
 * The same cue the rider hears also lights the Lock Screen: a turn announced
 * by voice becomes a Live Activity alert, so a glance matches what was said.
 */
export function withTurnAlerts(speech: SpeechPort | undefined, alert: (title: string, body: string) => void): SpeechPort {
  return {
    speak(cue) {
      // "In 500 feet, turn left onto Hawk Mountain Road": one line a glance can take.
      alert(spokenManeuver(cue).replace(/\.$/, ""), "");
      return speech?.speak(cue);
    },
    cancel() {
      return speech?.cancel?.();
    },
  };
}
