/**
 * One position fix for "Current location" (M1), over the same `PositionSource`
 * port the ride pipeline watches with (08 §3). The planner does not track the
 * rider; it asks once, takes the first fix, and stops the watch.
 */

import type {
  PositionSource,
  PositionSourceErrorCode,
} from "@/application/ride-session/position-pipeline";
import type { Coordinate } from "@/domain/ride/types";

export type LocateOutcome =
  | {
      readonly status: "located";
      readonly coordinate: Coordinate;
      readonly accuracyMeters: number;
      readonly observedAt: string;
    }
  | { readonly status: "failed"; readonly code: PositionSourceErrorCode | "unsupported" };

export const LOCATE_TIMEOUT_MS = 15_000;

/** The one line the rider reads for each way a fix can fail. */
export const LOCATE_FAILURE_COPY: Readonly<Record<PositionSourceErrorCode | "unsupported", string>> = {
  "permission-denied": "Location permission is off. Search for your start or set it on the map.",
  "position-unavailable": "Your location isn't available right now. Search for your start or set it on the map.",
  timeout: "Finding your location took too long. Try again, or search for your start.",
  unsupported: "This browser can't share your location. Search for your start or set it on the map.",
};

export function locateOnce(
  source: PositionSource,
  options: { readonly timeoutMs?: number } = {},
): Promise<LocateOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let watch: { stop(): void } | null = null;
    const finish = (outcome: LocateOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watch?.stop();
      resolve(outcome);
    };
    const timer = setTimeout(
      () => finish({ status: "failed", code: "timeout" }),
      options.timeoutMs ?? LOCATE_TIMEOUT_MS,
    );
    try {
      watch = source.watch({
        position: (position) =>
          finish({
            status: "located",
            coordinate: position.coordinate,
            accuracyMeters: position.accuracyMeters ?? 0,
            observedAt: position.observedAt,
          }),
        error: (error) => finish({ status: "failed", code: error.code }),
      });
      // A source that answered synchronously has already settled; stop it now.
      if (settled) watch.stop();
    } catch {
      finish({ status: "failed", code: "unsupported" });
    }
  });
}
