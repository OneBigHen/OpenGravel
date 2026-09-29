import { defaultLoopToleranceMinutes } from "@/application/planner/build-plan-request";
import { newPointId, type ShapingId, type StopId } from "@/domain/ride/ids";
import type { Coordinate, RideIntent, RidePoint, StopPoint } from "@/domain/ride/types";
import { validateCoordinate } from "@/domain/ride/validate";
import { deepFreeze } from "@/domain/util/freeze";

/**
 * `loop` (UX rework 2, ride findings): "Loop from here" in Free Ride, a curvy
 * loop of a chosen length that starts and ends where the rider is now.
 */
export type ReturnMode = "head-home" | "fatigue" | "turn-around" | "loop";
export type ReturnTargetKind = "saved-home" | "session-start" | "chosen-destination";

export interface ExplicitReturnTarget {
  readonly kind: ReturnTargetKind;
  readonly coordinate: Coordinate;
  readonly label: string | null;
}

export type BuildReturnIntentResult =
  | {
      readonly ok: true;
      readonly intent: RideIntent;
      readonly selectionRole: "best-ride" | "lower-workload";
      readonly requiresFreshPlan: true;
    }
  | { readonly ok: false; readonly reason: "invalid-current-position" | "invalid-return-target" };

const RETURN_VIA_ID = "stop_return_via" as StopId;

function point(kind: "start" | "finish", coordinate: Coordinate, reason: string): RidePoint {
  return {
    id: newPointId(), kind, coordinate: { ...coordinate },
    provenance: { type: "derived", reason },
  };
}

/** Build a new legal return question; never reverse the route already ridden. */
export function buildReturnIntent(input: {
  readonly authoredIntent: RideIntent;
  readonly currentPosition: Coordinate;
  readonly target: ExplicitReturnTarget;
  readonly mode: ReturnMode;
  /** A place to ride through on the way back (a fuel stop); planning-only. */
  readonly via?: { readonly coordinate: Coordinate; readonly label: string } | undefined;
  /** A new loop of this many minutes from the current position (`loop` mode). */
  readonly loopMinutes?: number | undefined;
  /**
   * Shaping through the rest of a loop already under way (`loop` mode after a
   * missed turn): ride back onto it and on to the target, not straight there.
   */
  readonly rejoin?: readonly Coordinate[] | undefined;
}): BuildReturnIntentResult {
  if (validateCoordinate(input.currentPosition).length > 0) {
    return deepFreeze({ ok: false, reason: "invalid-current-position" });
  }
  if (validateCoordinate(input.target.coordinate).length > 0) {
    return deepFreeze({ ok: false, reason: "invalid-return-target" });
  }
  if (input.via !== undefined && validateCoordinate(input.via.coordinate).length > 0) {
    return deepFreeze({ ok: false, reason: "invalid-return-target" });
  }
  const fatigue = input.mode === "fatigue";
  const newLoop = input.mode === "loop" && input.loopMinutes !== undefined;
  if (newLoop && (!Number.isInteger(input.loopMinutes) || (input.loopMinutes ?? 0) < 15 || (input.loopMinutes ?? 0) > 720)) {
    return deepFreeze({ ok: false, reason: "invalid-return-target" });
  }
  const via: readonly StopPoint[] = input.via === undefined
    ? []
    : [{
        id: RETURN_VIA_ID,
        kind: "stop",
        coordinate: { ...input.via.coordinate },
        label: input.via.label,
        provenance: { type: "derived", reason: "rider-chosen detour on the way back" },
      }];
  if (newLoop) {
    const minutes = input.loopMinutes as number;
    const character = input.authoredIntent.roadCharacter;
    return deepFreeze({
      ok: true,
      intent: {
        ...input.authoredIntent,
        shape: "loop",
        start: point("start", input.currentPosition, "loop from the current ride position"),
        finish: null,
        stops: via,
        shaping: [],
        sketch: null,
        longTrip: null,
        time: { kind: "budget", targetMinutes: minutes, toleranceMinutes: defaultLoopToleranceMinutes(minutes) },
        // A loop "for the ride" is a fun one unless the rider already asked for
        // twistier than that.
        roadCharacter: character === "curvy" || character === "backroads" ? character : "curvy",
      },
      selectionRole: "best-ride",
      requiresFreshPlan: true,
    });
  }
  const rejoin = input.mode === "loop" ? input.rejoin ?? [] : [];
  return deepFreeze({
    ok: true,
    intent: {
      ...input.authoredIntent,
      shape: "destination",
      start: point("start", input.currentPosition, "reliable current ride position"),
      finish: point("finish", input.target.coordinate, `explicit ${input.target.kind} return target`),
      // Old route-specific anchors can point behind the rider. Exclusions,
      // bike requirements, surface and terrain remain authoritative.
      stops: via,
      shaping: rejoin.map((coordinate, index) => ({
        id: `shape_return_rejoin_${index}` as ShapingId,
        kind: "shape" as const,
        coordinate: { ...coordinate },
        source: "import" as const,
      })),
      sketch: null,
      longTrip: null,
      time: { kind: "none" },
      ...(fatigue ? { roadCharacter: "efficient" as const, traffic: "minimize-delay" as const } : {}),
    },
    selectionRole: fatigue ? "lower-workload" : "best-ride",
    requiresFreshPlan: true,
  });
}
