/**
 * The ride's Live Activity (Lock Screen, Dynamic Island) through the app's own
 * RideActivity plugin (apps/ios/ios/App/App/RideActivityPlugin.swift).
 * Everything here is a no-op in a browser, in an app build that predates the
 * plugin, or when the rider has Live Activities turned off in iOS Settings.
 */

import type { LiveActivityAlert, LiveActivityPort, LiveActivityState } from "@/application/native/live-activity";

interface RideActivityPlugin {
  isAvailable?(): Promise<{ readonly available?: boolean }>;
  start(options: { readonly title: string; readonly state: LiveActivityState }): Promise<unknown>;
  update(options: { readonly state: LiveActivityState; readonly alertTitle?: string; readonly alertBody?: string }): Promise<unknown>;
  end(): Promise<unknown>;
}

interface CapacitorScope {
  readonly Capacitor?: {
    isNativePlatform?(): boolean;
    readonly Plugins?: { readonly RideActivity?: RideActivityPlugin };
  };
}

function plugin(scope: unknown): RideActivityPlugin | undefined {
  const capacitor = (scope as CapacitorScope | undefined)?.Capacitor;
  if (capacitor?.isNativePlatform?.() !== true) return undefined;
  const found = capacitor.Plugins?.RideActivity;
  if (typeof found?.start !== "function" || typeof found.update !== "function" || typeof found.end !== "function") return undefined;
  return found;
}

/** The native Live Activity, or `undefined` outside the iOS app. */
export function nativeShellLiveActivity(scope: unknown = globalThis): LiveActivityPort | undefined {
  const native = plugin(scope);
  if (native === undefined) return undefined;
  return {
    start: async (title: string, state: LiveActivityState) => { await native.start({ title, state }); },
    update: async (state: LiveActivityState, alert?: LiveActivityAlert) => {
      await native.update(alert === undefined ? { state } : { state, alertTitle: alert.title, alertBody: alert.body });
    },
    end: async () => { await native.end(); },
  };
}

/** Whether this phone will show a Live Activity (iOS 16.2+, and not switched off in iOS Settings). */
export async function liveActivitySupported(scope: unknown = globalThis): Promise<boolean> {
  const native = plugin(scope);
  if (native?.isAvailable === undefined) return false;
  try {
    return (await native.isAvailable()).available === true;
  } catch {
    return false;
  }
}
