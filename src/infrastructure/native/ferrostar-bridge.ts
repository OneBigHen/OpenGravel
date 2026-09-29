import type { NativeNavigationPayloadV1 } from "@/application/ride-session/native-navigation-contract";

export interface NativeNavigationAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

export interface NativeNavigationStartResult {
  readonly accepted: boolean;
  readonly activeRouteId?: string;
}

/** A raw device fix as the native navigator reports it (`routeProgress.location`). */
export interface NativeNavigationFix {
  readonly lat: number;
  readonly lon: number;
  readonly accuracyMeters: number;
  readonly headingDegrees: number | null;
  readonly speedMps: number | null;
  readonly observedAt: string;
}

/** Events the native navigator sends back (NATIVE-NAVIGATION-FERROSTAR §16). */
export interface NativeNavigationEvents {
  readonly routeProgress: {
    readonly routeId: string;
    readonly distanceRemainingMeters: number;
    readonly durationRemainingSeconds: number;
    readonly distanceToNextManeuverMeters: number;
    readonly stepIndex: number;
    readonly location: NativeNavigationFix;
  };
  readonly offRouteChanged: { readonly routeId: string; readonly offRoute: boolean };
  /** `exit`: the rider closed the native screen; `arrived`; `web`: the web stopped it; `replaced`. */
  readonly navigationEnded: { readonly routeId: string; readonly reason: string };
}

export interface NativeNavigationListenerHandle {
  remove(): Promise<void> | void;
}

export interface NativeNavigationPlugin {
  isAvailable(): Promise<NativeNavigationAvailability>;
  start(options: {
    readonly payload: NativeNavigationPayloadV1;
    /** Drive a simulated rider along the route (simulator and demo only). */
    readonly simulate?: boolean;
    /**
     * `headless`: guide without the native screen; OpenGravel's Ride Focus
     * stays in front. Omitted (and on builds without it) the native screen
     * is presented.
     */
    readonly presentation?: "native" | "headless";
  }): Promise<NativeNavigationStartResult>;
  /**
   * F3: swap a re-planned route into the running native session, so the
   * screen, voice and GPS carry on. Builds before F3 lack it.
   */
  replaceRoute?(options: { readonly payload: NativeNavigationPayloadV1 }): Promise<NativeNavigationStartResult>;
  stop(): Promise<void>;
  setMuted(options: { readonly muted: boolean }): Promise<void>;
  showOverview(): Promise<void>;
  recenter(): Promise<void>;
  addListener<E extends keyof NativeNavigationEvents>(
    event: E,
    listener: (data: NativeNavigationEvents[E]) => void,
  ): Promise<NativeNavigationListenerHandle> | NativeNavigationListenerHandle;
}

export type NativeNavigationBridge = NativeNavigationPlugin;

interface CapacitorGlobal {
  readonly isNativePlatform?: () => boolean;
  readonly Plugins?: {
    readonly OpenGravelNavigation?: Partial<NativeNavigationPlugin>;
  };
}

/**
 * Returns the Ferrostar-backed bridge only when the installed native shell has
 * registered the OpenGravelNavigation plugin. Browser/PWA navigation therefore
 * keeps using the existing RideNavigationEngine with no feature flag required.
 */
export function nativeNavigationBridge(
  scope: unknown = globalThis,
): NativeNavigationBridge | undefined {
  const capacitor = (scope as { readonly Capacitor?: CapacitorGlobal } | undefined)?.Capacitor;
  if (capacitor?.isNativePlatform?.() !== true) return undefined;
  const plugin = capacitor.Plugins?.OpenGravelNavigation;
  if (
    typeof plugin?.isAvailable !== "function" ||
    typeof plugin.start !== "function" ||
    typeof plugin.stop !== "function" ||
    typeof plugin.setMuted !== "function" ||
    typeof plugin.showOverview !== "function" ||
    typeof plugin.recenter !== "function" ||
    typeof plugin.addListener !== "function"
  ) {
    return undefined;
  }
  return plugin as NativeNavigationBridge;
}
