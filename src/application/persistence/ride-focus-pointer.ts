/**
 * The Ride Focus bootstrap pointer
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §13; 04-PLANNER-AND-WORKSPACE-UX §28;
 * 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * The session journal in IndexedDB is the authority on what happened; this
 * pointer is only the cheap answer to "which session is the rider in right
 * now?", written once per handoff and at each activity change. §13's reload
 * contract needs exactly that: `restore paused`, same session, no new recording.
 * Without it, `/ride` after a reload could only offer an empty screen — or,
 * worse, guess.
 *
 * ## Why the pointer carries presentation state too
 *
 * The session checkpoints the route **identity** (`plan.route`), never its
 * geometry: a 50k-point line is not a fact about the activity, and 02 §4 keeps
 * bulk geometry behind a `GeometryRef`. But the Ride Focus map has to draw the
 * line the rider is following, and the planner's bundle — which is where the
 * handle lives in memory — is per-tab and gone after a navigation or a reload.
 * So the handoff records the selected candidate's persisted `GeometryRef` here:
 * a *presentation* pointer to geometry the GeometryStore already owns, not a
 * second copy of it and not new authority.
 *
 * A pointer that does not parse, or that does not carry a session identity, is
 * reported as `corrupt` rather than coerced: a fabricated session id would send
 * the surface looking for a journal that never existed.
 */

import type { GeometryRef, RideId } from "@/domain/ride/ids";
import type { RideSessionId } from "@/domain/ride-session/ids";
import type { RouteInstruction, SpeedLimitSpan } from "@/domain/route/types";
import { isRouteInstruction, isSpeedLimitSpans, MAX_ROUTE_INSTRUCTIONS } from "@/domain/route/types";

export interface RideFocusPointer {
  readonly version: 1;
  readonly sessionId: RideSessionId;
  readonly rideId: RideId;
  /**
   * The selected candidate's persisted line, or `null` for a session with no
   * route answer to follow (a Free Ride or track-only start). The Ride Focus map
   * draws nothing for `null` — it never implies a line it does not have.
   */
  readonly routeGeometryRef: GeometryRef | null;
  /** Selected candidate estimate, used only to project ETA against matched progress. */
  readonly routeDurationSeconds?: number;
  /** Bounded route facts for guidance projection; the route binding stays in RideSession. */
  readonly instructions?: readonly RouteInstruction[];
  /** Posted speed limits along the route line (NV-04); absent on older pointers. */
  readonly speedLimits?: readonly SpeedLimitSpan[];
  readonly updatedAt: string;
}

/** What a read found. `unreadable` is a storage failure, not an empty cache. */
export type RideFocusPointerRead =
  | { readonly status: "found"; readonly pointer: RideFocusPointer }
  | { readonly status: "absent" }
  | { readonly status: "corrupt" }
  | { readonly status: "unreadable" };

export interface RideFocusPointerPort {
  read(): RideFocusPointerRead;
  /** Writes the pointer; `version` is owned by the adapter. */
  write(pointer: Omit<RideFocusPointer, "version">): void;
  /** Drops the pointer: the ride is finished, discarded, or unrecoverable. */
  clear(): void;
}

/**
 * Geometry references held by the physical RideSession, which is deliberately
 * separate from RideDocument liveness. `null` means storage could not prove the
 * pointer absent, so a garbage collector must preserve geometry until recovery
 * can read it again.
 */
export function rideFocusGeometryRefs(pointer: RideFocusPointerPort): readonly GeometryRef[] | null {
  const read = pointer.read();
  if (read.status === "absent") return [];
  if (read.status !== "found") return null;
  return read.pointer.routeGeometryRef === null ? [] : [read.pointer.routeGeometryRef];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Structural validation of a stored pointer. Exported because the adapter and
 * the surface agree on exactly one shape, and a shape change has to break both.
 */
export function isRideFocusPointer(value: unknown): value is RideFocusPointer {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const parsed = value as Record<string, unknown>;
  if (parsed["version"] !== 1) return false;
  if (!isNonEmptyString(parsed["sessionId"]) || !parsed["sessionId"].startsWith("sess_")) {
    return false;
  }
  if (!isNonEmptyString(parsed["rideId"]) || !parsed["rideId"].startsWith("ride_")) {
    return false;
  }
  const routeGeometryRef = parsed["routeGeometryRef"];
  if (routeGeometryRef !== null && !isNonEmptyString(routeGeometryRef)) return false;
  if (
    parsed["routeDurationSeconds"] !== undefined &&
    (typeof parsed["routeDurationSeconds"] !== "number" ||
      !Number.isFinite(parsed["routeDurationSeconds"]) ||
      parsed["routeDurationSeconds"] < 0)
  ) return false;
  const instructions = parsed["instructions"];
  if (
    instructions !== undefined &&
    (!Array.isArray(instructions) ||
      instructions.length > MAX_ROUTE_INSTRUCTIONS ||
      instructions.some((instruction) => !isRouteInstruction(instruction)))
  ) return false;
  if (parsed["speedLimits"] !== undefined && !isSpeedLimitSpans(parsed["speedLimits"])) return false;
  return isNonEmptyString(parsed["updatedAt"]);
}
