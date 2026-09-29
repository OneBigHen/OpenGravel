import type { NativeNavigationPayloadV1 } from "@/application/ride-session/native-navigation-contract";
import type {
  PositionSource,
  PositionSourceObserver,
  PositionWatch,
} from "@/application/ride-session/position-pipeline";
import type {
  NativeNavigationBridge,
  NativeNavigationListenerHandle,
} from "@/infrastructure/native/ferrostar-bridge";

export interface FerrostarPositionSourceOptions {
  readonly bridge: NativeNavigationBridge;
  readonly payload: NativeNavigationPayloadV1;
  /** Drive a simulated rider (the ride page's fixture mode). */
  readonly simulate?: boolean;
  /** The native screen ended on its own: the rider closed it, or arrived. */
  readonly onNativeEnded?: (reason: string) => void;
  /**
   * How long a stopped watch keeps native navigation running in case the next
   * watch is a reroute of the same ride (F3). Default 1.5 s.
   */
  readonly handoffMs?: number;
}

const DEFAULT_HANDOFF_MS = 1_500;

/**
 * Native navigation a stopped watch left running for a moment: the ride page
 * rebuilds its engine when OpenGravel re-plans (off-route or a detour), and the
 * next watch swaps the new route in instead of closing and reopening the
 * native screen.
 */
const pendingStops = new WeakMap<NativeNavigationBridge, ReturnType<typeof setTimeout>>();

/**
 * The ride's position source while Ferrostar navigates (NATIVE-NAVIGATION-
 * FERROSTAR §5, F2). Watching starts native navigation on the selected route
 * and relays the device fixes Ferrostar reports, so the RideSession, progress
 * and recording keep one pipeline, and there is exactly one GPS owner: the
 * native navigator. Stopping the watch stops native navigation, unless another
 * watch follows within the handoff window with a re-planned route (F3).
 */
export function createFerrostarPositionSource(options: FerrostarPositionSourceOptions): PositionSource {
  const { bridge, payload } = options;
  return {
    // The app holds the location grant; Ferrostar asks through CoreLocation.
    permission: async () => "granted",
    watch(observer: PositionSourceObserver): PositionWatch {
      let stopped = false;
      const handles: Array<Promise<NativeNavigationListenerHandle> | NativeNavigationListenerHandle> = [];
      handles.push(
        bridge.addListener("routeProgress", (event) => {
          if (stopped || event.routeId !== payload.routeId) return;
          const fix = event.location;
          observer.position({
            coordinate: { lat: fix.lat, lon: fix.lon },
            observedAt: fix.observedAt,
            accuracyMeters: fix.accuracyMeters,
            headingDegrees: fix.headingDegrees,
            speedMps: fix.speedMps,
          });
        }),
        bridge.addListener("offRouteChanged", (event) => {
          if (stopped || event.routeId !== payload.routeId) return;
          // Ferrostar already owns route matching on native rides. Forward its
          // deviation verdict so the RideSession wakes the existing reroute
          // planner instead of waiting for a second matcher to agree.
          observer.routeDeviation?.(event.offRoute);
        }),
        bridge.addListener("navigationEnded", (event) => {
          if (stopped || event.routeId !== payload.routeId) return;
          if (event.reason === "exit" || event.reason === "arrived") options.onNativeEnded?.(event.reason);
        }),
      );
      const start = () => bridge.start({ payload, ...(options.simulate === true ? { simulate: true } : {}) });
      const pending = pendingStops.get(bridge);
      if (pending !== undefined) {
        clearTimeout(pending);
        pendingStops.delete(bridge);
      }
      // Still navigating from the previous watch: OpenGravel re-planned, so
      // replace the route in place. A refusal (nothing running, a build
      // without F3) falls back to a fresh start.
      const begin = pending !== undefined && bridge.replaceRoute !== undefined
        ? bridge.replaceRoute({ payload }).catch(start)
        : start();
      void begin
        .then((result) => {
          if (!result.accepted && !stopped) observer.error({ code: "position-unavailable" });
        })
        .catch(() => {
          if (!stopped) observer.error({ code: "position-unavailable" });
        });
      return {
        stop(): void {
          if (stopped) return;
          stopped = true;
          for (const handle of handles) void Promise.resolve(handle).then((resolved) => resolved.remove());
          const existing = pendingStops.get(bridge);
          if (existing !== undefined) clearTimeout(existing);
          pendingStops.set(
            bridge,
            setTimeout(() => {
              pendingStops.delete(bridge);
              void bridge.stop().catch(() => undefined);
            }, options.handoffMs ?? DEFAULT_HANDOFF_MS),
          );
        },
      };
    },
  };
}
