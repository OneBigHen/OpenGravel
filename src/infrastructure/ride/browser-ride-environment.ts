/**
 * The browser's own answer to the Ride Focus environment questions
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §3, §7, §8, §25;
 * `src/application/ride-session/ports/ride-focus-environment.ts`).
 *
 * ## Scope, stated plainly
 *
 * This adapter answers three questions and nothing more: may we use location,
 * is the screen being kept awake, and can this browser speak. It **is not the
 * position pipeline**: it starts no watch, produces no `PositionFix`, smooths
 * nothing, derives no quality and never feeds the session. 8 §3 gives the
 * pipeline — permission *lifecycle*, watch, quality, freshness, smoothing,
 * heading — to Task 8.2, which owns the real thing; this seam exists because
 * Task 8.5's surface must be able to say "location is blocked" and offer a
 * Retry, and a surface that cannot ask cannot say that.
 *
 * ## Wake lock (8 §8)
 *
 * Attempted while the ride is physically active, released on pause, completion,
 * abandonment and disposal. The platform releases the lock whenever the document
 * stops being visible, so the adapter re-acquires on the way back — otherwise a
 * single glance at another app would silently end the guarantee for the rest of
 * the ride. Every outcome is a state the surface can print: `unsupported` on a
 * browser without the API (iOS Safari today, 8 §25), `failed` on a refusal, and
 * `active` only when a sentinel is actually held.
 *
 * ## Speech (8 §7)
 *
 * Availability only. Announcing the next maneuver is 8.2's (17's plan lists
 * "speech/wake seams" under it), so `ready` means the API exists and `failed`
 * can only be produced by an implementation that actually speaks — the surface
 * renders both, and this adapter never claims a failure it did not observe.
 */

import type {
  LocationPermissionState,
  RideFocusEnvironmentPort,
  RideFocusEnvironmentSnapshot,
  SpeechState,
  WakeLockState,
} from "@/application/ride-session/ports/ride-focus-environment";

import { nativeShellWakeLock } from "./native-shell";

/** The browser surface the adapter reads; injected for tests, real by default. */
export interface RideEnvironmentBrowser {
  readonly geolocation?: Geolocation | undefined;
  readonly permissions?: Permissions | undefined;
  readonly wakeLock?: WakeLock | undefined;
  readonly speechSynthesis?: SpeechSynthesis | undefined;
}

/** The document surface the adapter reads: only visibility matters here. */
export interface RideEnvironmentDocument {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface BrowserRideEnvironmentOptions {
  /**
   * The app's native watcher owns location (DV-05): a retry restarts it, and
   * this adapter must never ask the web view, whose prompt is a second,
   * confusing "use your location?" over the ride.
   */
  readonly nativeLocation?: boolean;
  /** Overrides `globalThis.navigator`; tests inject a double. */
  readonly browser?: RideEnvironmentBrowser;
  /** Overrides `globalThis.document`; tests inject a double. */
  readonly document?: RideEnvironmentDocument | null;
}

/** `"granted" | "denied" | "prompt"` → the port's vocabulary. */
function permissionStateOf(state: PermissionState): LocationPermissionState {
  return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
}

function browserOf(options: BrowserRideEnvironmentOptions): RideEnvironmentBrowser {
  if (options.browser !== undefined) return options.browser;
  if (typeof navigator === "undefined") return {};
  const nativeWakeLock = nativeShellWakeLock();
  if (nativeWakeLock === undefined) return navigator;
  return {
    geolocation: navigator.geolocation,
    permissions: navigator.permissions,
    speechSynthesis: (navigator as RideEnvironmentBrowser).speechSynthesis,
    wakeLock: nativeWakeLock,
  };
}

function documentOf(
  options: BrowserRideEnvironmentOptions,
): RideEnvironmentDocument | null {
  if (options.document !== undefined) return options.document;
  if (typeof document === "undefined") return null;
  return document;
}

export function createBrowserRideEnvironment(
  options: BrowserRideEnvironmentOptions = {},
): RideFocusEnvironmentPort {
  const browser = browserOf(options);
  const documentLike = documentOf(options);
  const listeners = new Set<(snapshot: RideFocusEnvironmentSnapshot) => void>();

  let wakeLock: WakeLockState = browser.wakeLock === undefined ? "unsupported" : "off";
  const speech: SpeechState =
    browser.speechSynthesis === undefined ? "unsupported" : "ready";
  let permission: LocationPermissionState =
    browser.geolocation === undefined ? "unsupported" : "unknown";
  /** True while the surface says a ride is physically active (8 §8). */
  let rideActive = false;
  let sentinel: WakeLockSentinel | null = null;
  let permissionStatus: PermissionStatus | null = null;
  let disposed = false;

  function snapshot(): RideFocusEnvironmentSnapshot {
    return { locationPermission: permission, wakeLock, speech };
  }

  function notify(): void {
    if (disposed) return;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function setWakeLock(state: WakeLockState): void {
    if (wakeLock === state) return;
    wakeLock = state;
    notify();
  }

  function setPermission(state: LocationPermissionState): void {
    if (permission === state) return;
    permission = state;
    notify();
  }

  /**
   * Reads the permission without prompting. `navigator.permissions` is absent on
   * older Safari, where the honest answer is `unknown` rather than `prompt`: we
   * do not know, and the surface's Retry is what finds out.
   */
  async function readPermission(): Promise<LocationPermissionState> {
    if (browser.geolocation === undefined) return "unsupported";
    const permissions = browser.permissions;
    if (permissions === undefined) return permission === "unsupported" ? "unknown" : permission;
    try {
      const status = await permissions.query({ name: "geolocation" });
      if (!disposed) {
        permissionStatus = status;
        status.onchange = (): void => setPermission(permissionStateOf(status.state));
      }
      return permissionStateOf(status.state);
    } catch {
      return permission === "unsupported" ? "unknown" : permission;
    }
  }

  async function acquire(): Promise<void> {
    if (disposed) return;
    const api = browser.wakeLock;
    if (api === undefined) {
      setWakeLock("unsupported");
      return;
    }
    if (sentinel !== null || wakeLock === "requesting") return;
    setWakeLock("requesting");
    try {
      const acquired = await api.request("screen");
      if (disposed || acquired.released) {
        void acquired.release().catch(() => undefined);
        setWakeLock("off");
        return;
      }
      sentinel = acquired;
      acquired.addEventListener("release", () => {
        sentinel = null;
        // The platform releases on its own when the page is hidden; the ride is
        // still active, so the state is "not held" and the next visibility change
        // asks again.
        setWakeLock("off");
      });
      setWakeLock("active");
    } catch {
      if (!disposed) setWakeLock("failed");
    }
  }

  async function release(): Promise<void> {
    const held = sentinel;
    sentinel = null;
    if (held === null) {
      if (wakeLock === "requesting") setWakeLock("off");
      return;
    }
    try {
      await held.release();
    } catch {
      // A lock the platform already dropped needs no second release.
    }
    setWakeLock("off");
  }

  const onVisibilityChange = (): void => {
    if (documentLike === null || disposed) return;
    if (documentLike.hidden) {
      // The browser releases the sentinel itself; clear our handle so a return to
      // the tab acquires a fresh one.
      sentinel = null;
      if (wakeLock === "active") setWakeLock("off");
      return;
    }
    if (rideActive) void acquire();
  };

  documentLike?.addEventListener("visibilitychange", onVisibilityChange);
  // The current permission is read once, asynchronously; until it answers, the
  // snapshot says `unknown`, which is the truth.
  void readPermission().then((state) => {
    if (!disposed) setPermission(state);
  });

  return {
    snapshot,

    subscribe(listener): () => void {
      listeners.add(listener);
      listener(snapshot());
      return (): void => {
        listeners.delete(listener);
      };
    },

    setRideActive(active: boolean): void {
      if (disposed) return;
      rideActive = active;
      if (active) {
        void acquire();
        return;
      }
      void release();
    },

    async requestLocationPermission(): Promise<LocationPermissionState> {
      if (options.nativeLocation === true) return permission;
      if (browser.geolocation === undefined) {
        setPermission("unsupported");
        return "unsupported";
      }
      // A refused prompt is a *permission* answer; a timeout or an unavailable
      // device is not, so those leave the reported state to the permission read.
      const denied = await new Promise<boolean>((resolve) => {
        browser.geolocation?.getCurrentPosition(
          () => resolve(false),
          (error) => resolve(error.code === error.PERMISSION_DENIED),
        );
      });
      const state = denied ? "denied" : await readPermission();
      setPermission(state);
      return state;
    },

    dispose(): void {
      disposed = true;
      documentLike?.removeEventListener("visibilitychange", onVisibilityChange);
      if (permissionStatus !== null) {
        permissionStatus.onchange = null;
        permissionStatus = null;
      }
      listeners.clear();
      void release();
    },
  };
}
