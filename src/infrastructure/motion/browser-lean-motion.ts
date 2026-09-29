/**
 * Browser `MotionPort` (issue #12 follow-up): a thin wrapper over
 * `DeviceMotionEvent`. iOS Safari's `DeviceMotionEvent.requestPermission` is
 * an Apple-only extension not in the DOM lib types, so it is read off the
 * global defensively rather than assumed to exist.
 */

import type { MotionPermissionState, MotionPort } from "@/application/ride-session/ports/motion-port";
import type { Vector3 } from "@/domain/motion/lean";

interface RequestPermissionCapable {
  requestPermission?: () => Promise<"granted" | "denied">;
}

function motionEventCtor(): RequestPermissionCapable | null {
  if (typeof window === "undefined" || typeof window.DeviceMotionEvent === "undefined") return null;
  return window.DeviceMotionEvent as unknown as RequestPermissionCapable;
}

export function createBrowserLeanMotion(): MotionPort {
  let permission: MotionPermissionState = "unknown";
  let listener: ((event: DeviceMotionEvent) => void) | null = null;

  function supported(): boolean {
    return motionEventCtor() !== null;
  }

  async function requestPermission(): Promise<MotionPermissionState> {
    const ctor = motionEventCtor();
    if (ctor === null) {
      permission = "unsupported";
      return permission;
    }
    if (typeof ctor.requestPermission !== "function") {
      // Most browsers (Android Chrome, desktop) never gate motion at all.
      permission = "granted";
      return permission;
    }
    try {
      const answer = await ctor.requestPermission();
      permission = answer === "granted" ? "granted" : "denied";
    } catch {
      permission = "denied";
    }
    return permission;
  }

  function subscribe(onSample: (gravity: Vector3, atMs: number) => void): () => void {
    if (typeof window === "undefined" || !supported()) return () => {};
    const handle = (event: DeviceMotionEvent): void => {
      const g = event.accelerationIncludingGravity;
      if (g === null || g.x === null || g.y === null || g.z === null) return;
      onSample({ x: g.x, y: g.y, z: g.z }, Date.now());
    };
    listener = handle;
    window.addEventListener("devicemotion", handle);
    return () => {
      window.removeEventListener("devicemotion", handle);
      if (listener === handle) listener = null;
    };
  }

  function dispose(): void {
    listener = null;
  }

  return { supported, permission: () => permission, requestPermission, subscribe, dispose };
}
