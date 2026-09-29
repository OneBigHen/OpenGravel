/**
 * The device-environment port the Ride Focus surface renders
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §3, §7, §8, §25; 12 §16;
 * 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * Three facts about the device are *not* the GPS engine's to own and not the
 * session's to store, yet the rider has to see them:
 *
 * - **location permission** (§3). A denied permission must leave the ride
 *   controllable — Retry, Finish, Discard — and must never drop the surface to a
 *   dead state. The permission *state* is therefore readable here, and asking
 *   again is one method.
 * - **the screen wake lock** (§8). The lock is attempted while the ride is
 *   active and its failure is a visible, non-blocking state; the ride continues
 *   either way.
 * - **speech availability** (§7). A speech failure is a visible, non-blocking
 *   state.
 *
 * ## What this port deliberately is not
 *
 * It is **not** the position pipeline. 8 §3 gives the position pipeline
 * permission, watch lifecycle, quality, freshness, smoothing and heading, and
 * 17's Task 8.2 owns it: nothing here starts a watch, feeds a `PositionFix`,
 * smooths anything or derives a quality label. The freshness labels the surface
 * renders come from the session's own `deriveSessionNavigation` port
 * (`navigationState()`), which is why this port carries no position at all.
 *
 * The one thing the permission half does is answer "may we use location at all,
 * and can the rider ask again?" — the question §3's Retry control exists to
 * answer. The real adapter probes once per request and reports what the browser
 * said; it never invents `granted`, and an absent geolocation API is
 * `unsupported`, not a denial.
 *
 * ## Why a snapshot and a subscription
 *
 * Every field is a value that changes asynchronously (a permission prompt is
 * answered later, a wake lock is released by the platform, an utterance fails
 * mid-ride). A surface that read them once at mount would keep printing the
 * first answer — the same "stored freshness" mistake 8 §4 forbids for position.
 * The adapter therefore pushes a whole immutable snapshot on every change, and a
 * new subscriber immediately receives the current one so a mount that happens
 * late is never left guessing.
 */

/** Whether location may be used, in the browser's own words (8 §3). */
export type LocationPermissionState =
  /** Not asked yet, or the answer cannot be read (`navigator.permissions` absent). */
  | "unknown"
  /** The browser will prompt; the rider has not answered. */
  | "prompt"
  | "granted"
  | "denied"
  /** This device/browser has no geolocation at all — not a denial. */
  | "unsupported";

/**
 * The screen wake lock's own state (8 §8).
 *
 * `off` is "not held": never asked, released on pause/completion, or released by
 * the platform. `unsupported` is a device that cannot hold one at all (iOS
 * Safari today) — the honest reason to show the rider settings guidance instead
 * of retrying forever. `failed` is a device that has the API and refused.
 */
export type WakeLockState = "off" | "requesting" | "active" | "unsupported" | "failed";

/**
 * Speech availability (8 §7). `failed` means an attempt to speak failed; the
 * ride continues and the surface says so.
 */
export type SpeechState = "unsupported" | "ready" | "failed";

/** Everything about the device the Ride Focus surface renders, at one instant. */
export interface RideFocusEnvironmentSnapshot {
  readonly locationPermission: LocationPermissionState;
  readonly wakeLock: WakeLockState;
  readonly speech: SpeechState;
}

export interface RideFocusEnvironmentPort {
  /** The current snapshot; never `null`, never partially filled. */
  snapshot(): RideFocusEnvironmentSnapshot;
  /** Subscribe to changes; the current snapshot is delivered at subscription time. */
  subscribe(listener: (snapshot: RideFocusEnvironmentSnapshot) => void): () => void;
  /**
   * Tells the adapter whether a ride is physically active (8 §8): `true` asks for
   * the screen wake lock, `false` releases it. Called on every activity change,
   * so pause, completion and abandonment all release it through the same path.
   */
  setRideActive(active: boolean): void;
  /**
   * The rider's Retry (8 §3): asks the browser for location again and resolves to
   * the resulting state. Never throws — a browser that refuses is a state.
   */
  requestLocationPermission(): Promise<LocationPermissionState>;
  /** Detach listeners and release anything held. Idempotent. */
  dispose(): void;
}
