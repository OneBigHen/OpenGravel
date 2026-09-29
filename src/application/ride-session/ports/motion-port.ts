/**
 * The device-motion port (companion to `ride-focus-environment`): the one
 * seam between the browser's motion sensors and the lean-angle beta metric
 * (issue #12 follow-up). Swappable for a native CoreMotion source later
 * without touching the domain math, the registry or the store's fold.
 */

import type { Vector3 } from "@/domain/motion/lean";

/** iOS Safari gates motion behind an explicit, gesture-triggered prompt; other browsers do not ask. */
export type MotionPermissionState = "unknown" | "granted" | "denied" | "unsupported";

export interface MotionPort {
  /** Whether this device/browser exposes motion at all — not whether permission was granted. */
  supported(): boolean;
  /** The last-known permission answer, without prompting. */
  permission(): MotionPermissionState;
  /**
   * Asks the platform for motion access. Must be called from the same user
   * gesture that picked Lean (iOS requires the call stack itself to trace
   * back to a tap). Never throws; a device with no motion API resolves
   * `"unsupported"`, never `"granted"`.
   */
  requestPermission(): Promise<MotionPermissionState>;
  /**
   * Subscribes to gravity samples (device-local axes, roughly 9.8 m/s² in
   * magnitude while the device is not accelerating hard). Safe to call before
   * permission is granted — it simply receives nothing until the platform
   * allows it.
   */
  subscribe(onSample: (gravity: Vector3, atMs: number) => void): () => void;
  /** Detach everything. Idempotent. */
  dispose(): void;
}
