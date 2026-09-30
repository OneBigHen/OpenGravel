/**
 * The fenced reducer for authored ride state (02-ARCHITECTURE-CONTRACT §5,
 * 03-DOMAIN-MODEL §25–§27).
 *
 * `applyRideCommand` is the only public mutation entry for `RideDocument`. It is
 * pure: the input document is never mutated, and every applied result is a new
 * deeply frozen document. There is no generic patch path, no `setState`, and no
 * partial-intent escape hatch.
 *
 * ## Ordered checks (the order is part of the contract)
 *
 * 1. **Ride mismatch** — `command.rideId !== document.rideId` → `invalid`
 *    (`ride-mismatch`).
 * 2. **Staleness** — `command.baseRevision !== document.revision` → `stale`
 *    with `currentRevision`.
 * 3. **Operation validation** — unknown or duplicate IDs, invalid coordinates,
 *    invalid enum-ish payloads → `invalid` with a specific code. Proposal
 *    idempotence is decided here too (`proposalId` already applied → `noop`).
 * 4. **No-op detection** — the resulting intent is structurally equal to the
 *    current one → `noop`, returning the *same* document object. No revision
 *    bump, no history entry, no proposal record.
 * 5. **Apply** — one new revision, one history entry (unless the command is
 *    explicitly non-undoable initialization), result deeply frozen.
 *
 * ## Reroute table
 *
 * `reroute: true` means the change can move route geometry or the planning
 * answer, so downstream planning work is invalidated. Conservative by design:
 * when a changed field feeds planning, the answer is `true`.
 *
 * | `false` (metadata only)                        | `true` |
 * | ---------------------------------------------- | ------ |
 * | `longTrip.set` (no routing consumer until 7.5) | `bike.set`, `tollPolicy.set` (eligibility/cost), `departure.set`, `time.set` (traffic + time budget), `ride.reverse`, `ride.clear`, `ride.create`, `point.convert` (the request moves between stops and shaping) |
 * | `stop.arrivalIntent.set` (no routing consumer yet; the itinerary wave owns it) | `proposal.apply` with any inner `true` |
 * | `avoidArea.update` changing only `name`        | |
 * | a `proposal.apply` whose inner ops all say `false` | |
 *
 * ## History mechanics
 *
 * `commit` delegates to `history.ts`: `appendHistoryEntry` slices `entries` to
 * `cursor + 1` first ("a new edit cuts redo"), appends, moves `cursor` to the
 * last entry and enforces the 50-entry bound; `recordProposalApplied` keeps the
 * last 20 applied proposal ids FIFO. A non-undoable system-location start seed
 * increments the revision but leaves the index untouched, so it neither adds an
 * undo step nor destroys redo.
 */

import { defaultRideIntent } from "./create";
import { deepFreeze } from "../util/freeze";
import { appendHistoryEntry, recordProposalApplied } from "./history";
import { newHistoryEntryId } from "./ids";
import type {
  RideCommand,
  RideCommandOp,
  RideCommandResult,
  RideEndpointPayload,
} from "./commands";
import type {
  AvoidArea,
  LocationProvenance,
  LongTripIntent,
  NoveltyPreference,
  RideDocument,
  RideIntent,
  RidePoint,
  RoadCharacterIntent,
  RoadSpanConstraint,
  ShapingPoint,
  StopArrivalIntent,
  StopPoint,
  TerrainIntent,
  TollPolicy,
  TrafficPreference,
} from "./types";
import { validateBikeConstraintSnapshot, validateCoordinate, validateSurfaceIntent, validateTimeIntent } from "./validate";

/** Runtime enum-ish guards: commands may carry untrusted (persisted) values. */
const ROAD_CHARACTERS: readonly RoadCharacterIntent[] = [
  "efficient",
  "balanced",
  "curvy",
  "backroads",
];
const NOVELTY_PREFERENCES: readonly NoveltyPreference[] = [
  "prefer-new-to-me",
  "balanced",
  "prefer-familiar",
];
const TERRAIN_LEVELS: readonly TerrainIntent["level"][] = [
  "known-easy-only",
  "moderate",
  "any-supported",
];
const TRAFFIC_PREFERENCES: readonly TrafficPreference[] = [
  "protect-ride",
  "minimize-delay",
];
const TOLL_POLICIES: readonly TollPolicy[] = ["avoid", "allow-with-warning"];
const RIDE_SHAPES: readonly RideIntent["shape"][] = ["destination", "loop", "open"];
const STOP_ARRIVAL_INTENTS: readonly StopArrivalIntent[] = [
  "visit",
  "fuel",
  "food",
  "lodging",
  "scenic",
  "other",
];

/** Optional inputs for one apply call. */
export interface RideCommandOptions {
  /** ISO-8601 instant stamped into `updatedAt`; defaults to the wall clock. */
  readonly now?: string;
}

interface InvalidOperation {
  readonly code: string;
  readonly message: string;
}

interface AppliedOperation {
  readonly intent: RideIntent;
  /** Whether this change can invalidate planning/route geometry. */
  readonly reroute: boolean;
}

type OperationOutcome = AppliedOperation | InvalidOperation;

function isInvalid(outcome: OperationOutcome): outcome is InvalidOperation {
  return "code" in outcome;
}

function fail(code: string, message: string): InvalidOperation {
  return { code, message };
}

function applyChange(intent: RideIntent, reroute: boolean): OperationOutcome {
  return { intent, reroute };
}

/**
 * Compile-time exhaustiveness fence: adding a command variant without handling
 * it here stops narrowing to `never` and fails the type check.
 */
function assertNever(value: never): never {
  throw new Error(`unhandled ride command: ${String(value)}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural equality for domain values. Optional keys whose value is
 * `undefined` count as absent, so a merge that "keeps" a missing optional field
 * still compares equal to the current value. Handles `NaN` via `Object.is`.
 */
function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => structurallyEqual(entry, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      structurallyEqual(left[key], right[key]),
  );
}

function rejectCoordinateIssues(issues: readonly string[]): InvalidOperation | null {
  return issues.length === 0 ? null : fail("invalid-coordinate", issues.join("; "));
}

/** `stop.move` replaces coordinate + provenance and only overrides a label. */
function movedStop(current: StopPoint, endpoint: RideEndpointPayload): StopPoint {
  const moved = endpoint.label === undefined ? current : { ...current, label: endpoint.label };
  return {
    ...moved,
    coordinate: endpoint.coordinate,
    provenance: endpoint.provenance,
  };
}

/**
 * The converted identity: the same UUID body under the other brand's prefix
 * (03 §1). Identity survives a conversion in both directions, and the branded
 * prefix rule stays satisfied without minting a second object.
 */
function convertedId<T extends string>(id: string, prefix: string): T {
  return `${prefix}${id.replace(/^(stop_|shape_)/, "")}` as T;
}

/**
 * The anchor source a converted stop's provenance implies (03 §4). The anchor
 * records how its *position* was authored, so a searched or imported place stays
 * a searched or imported anchor; a map (or saved/GPS/derived) place became an
 * anchor through a rider gesture, which is what `map-drag` names.
 */
function shapingSourceFor(provenance: LocationProvenance): ShapingPoint["source"] {
  if (provenance.type === "search") return "search";
  if (provenance.type === "import") return "import";
  return "map-drag";
}

/**
 * A stop with its arrival intent set, or with the key removed entirely when it
 * is cleared. Removing the key (rather than storing `undefined`) keeps a cleared
 * intent indistinguishable from one that was never authored — which is what the
 * structural no-op check and a persisted document both need.
 */
function withArrivalIntent(
  stop: StopPoint,
  arrivalIntent: StopArrivalIntent | null,
): StopPoint {
  if (arrivalIntent !== null) return { ...stop, arrivalIntent };
  if (stop.arrivalIntent === undefined) return stop;
  return {
    id: stop.id,
    kind: "stop",
    coordinate: stop.coordinate,
    provenance: stop.provenance,
    ...(stop.label === undefined ? {} : { label: stop.label }),
  };
}

/**
 * Applies one operation to an intent. Never touches history, revision, or
 * timestamps; that is `applyRideCommand`'s job.
 */
function applyOperation(intent: RideIntent, command: RideCommandOp): OperationOutcome {
  switch (command.type) {
    case "ride.create": {
      if (command.bike !== undefined) {
        const issues = validateBikeConstraintSnapshot(command.bike);
        if (issues.length > 0) return fail("invalid-bike", issues.join("; "));
      }
      // A brand-new authored ride: product defaults, document identity kept by
      // the caller's document (rideId/title/provenance are not intent fields).
      return applyChange(defaultRideIntent(command.bike), true);
    }

    case "ride.clear": {
      // Keeps preferences, constraints and the sketch; only authored points go.
      return applyChange(
        { ...intent, start: null, finish: null, stops: [], shaping: [] },
        true,
      );
    }

    case "ride.reverse": {
      const start: RidePoint | null =
        intent.finish === null ? null : { ...intent.finish, kind: "start" };
      const finish: RidePoint | null =
        intent.start === null ? null : { ...intent.start, kind: "finish" };
      return applyChange(
        {
          ...intent,
          start,
          finish,
          stops: [...intent.stops].reverse(),
          shaping: [...intent.shaping].reverse(),
          // The reversed ride traverses each span the other way. `either` is
          // direction-agnostic and stays as authored.
          roadSpans: intent.roadSpans.map((span) => ({
            ...span,
            direction:
              span.direction === "forward"
                ? ("reverse" as const)
                : span.direction === "reverse"
                  ? ("forward" as const)
                  : span.direction,
          })),
        },
        true,
      );
    }

    case "ride.shape.set": {
      if (!RIDE_SHAPES.includes(command.shape)) {
        return fail("invalid-trip-shape", `unknown trip shape "${String(command.shape)}"`);
      }
      return applyChange({ ...intent, shape: command.shape }, true);
    }

    case "start.set": {
      // System-location seeding is initialization only: it may fill an empty
      // slot, never overwrite a deliberate authored start (OGV-DOM-005).
      if (command.source === "system-location" && intent.start !== null) {
        return fail(
          "start-already-authored",
          "a system-location seed never overwrites an authored start",
        );
      }
      const coordinateIssues = rejectCoordinateIssues(
        validateCoordinate(command.point.coordinate),
      );
      if (coordinateIssues !== null) return coordinateIssues;
      // The variant, not the payload, owns the slot: `kind` is normalized.
      return applyChange({ ...intent, start: { ...command.point, kind: "start" } }, true);
    }

    case "start.clear":
      return applyChange({ ...intent, start: null }, true);

    case "finish.set": {
      const coordinateIssues = rejectCoordinateIssues(
        validateCoordinate(command.point.coordinate),
      );
      if (coordinateIssues !== null) return coordinateIssues;
      return applyChange(
        { ...intent, finish: { ...command.point, kind: "finish" } },
        true,
      );
    }

    case "finish.clear":
      return applyChange({ ...intent, finish: null }, true);

    case "stop.insert": {
      const coordinateIssues = rejectCoordinateIssues(
        validateCoordinate(command.stop.coordinate),
      );
      if (coordinateIssues !== null) return coordinateIssues;
      if (intent.stops.some((stop) => stop.id === command.stop.id)) {
        return fail("duplicate-stop-id", `a stop "${command.stop.id}" already exists`);
      }
      const stop: StopPoint = { ...command.stop, kind: "stop" };
      if (command.beforeStopId === undefined) {
        return applyChange({ ...intent, stops: [...intent.stops, stop] }, true);
      }
      const index = intent.stops.findIndex((entry) => entry.id === command.beforeStopId);
      if (index === -1) {
        return fail(
          "unknown-stop-id",
          `no stop "${command.beforeStopId}" to insert before`,
        );
      }
      return applyChange(
        {
          ...intent,
          stops: [...intent.stops.slice(0, index), stop, ...intent.stops.slice(index)],
        },
        true,
      );
    }

    case "stop.move": {
      const current = intent.stops.find((stop) => stop.id === command.stopId);
      if (current === undefined) {
        return fail("unknown-stop-id", `no stop "${command.stopId}" to move`);
      }
      const coordinateIssues = rejectCoordinateIssues(
        validateCoordinate(command.endpoint.coordinate),
      );
      if (coordinateIssues !== null) return coordinateIssues;
      const moved = movedStop(current, command.endpoint);
      return applyChange(
        {
          ...intent,
          stops: intent.stops.map((stop) => (stop.id === command.stopId ? moved : stop)),
        },
        true,
      );
    }

    case "stop.reorder": {
      const target = intent.stops.find((stop) => stop.id === command.stopId);
      if (target === undefined) {
        return fail("unknown-stop-id", `no stop "${command.stopId}" to reorder`);
      }
      if (command.beforeStopId === undefined) {
        const others = intent.stops.filter((stop) => stop.id !== command.stopId);
        return applyChange({ ...intent, stops: [...others, target] }, true);
      }
      if (command.beforeStopId === command.stopId) {
        // A stop cannot be ordered before itself: position is unchanged.
        return applyChange({ ...intent, stops: intent.stops }, true);
      }
      const others = intent.stops.filter((stop) => stop.id !== command.stopId);
      const index = others.findIndex((stop) => stop.id === command.beforeStopId);
      if (index === -1) {
        return fail(
          "unknown-stop-id",
          `no stop "${command.beforeStopId}" to reorder before`,
        );
      }
      return applyChange(
        { ...intent, stops: [...others.slice(0, index), target, ...others.slice(index)] },
        true,
      );
    }

    case "stop.remove": {
      if (!intent.stops.some((stop) => stop.id === command.stopId)) {
        return fail("unknown-stop-id", `no stop "${command.stopId}" to remove`);
      }
      return applyChange(
        { ...intent, stops: intent.stops.filter((stop) => stop.id !== command.stopId) },
        true,
      );
    }

    case "stop.arrivalIntent.set": {
      const current = intent.stops.find((stop) => stop.id === command.stopId);
      if (current === undefined) {
        return fail(
          "unknown-stop-id",
          `no stop "${command.stopId}" to set an arrival intent on`,
        );
      }
      if (
        command.arrivalIntent !== null &&
        !STOP_ARRIVAL_INTENTS.includes(command.arrivalIntent)
      ) {
        return fail(
          "invalid-arrival-intent",
          `arrival intent "${command.arrivalIntent}" is not a known intent`,
        );
      }
      const updated = withArrivalIntent(current, command.arrivalIntent);
      // No routing consumer reads the arrival intent yet (the itinerary and
      // guidance wave owns it), so this is metadata for today's planner — the
      // same honest `false` as `longTrip.set`, and it keeps an intent-only edit
      // from burning a planning round trip.
      return applyChange(
        {
          ...intent,
          stops: intent.stops.map((stop) =>
            stop.id === command.stopId ? updated : stop,
          ),
        },
        false,
      );
    }

    case "point.convert": {
      const stop = intent.stops.find((entry) => entry.id === command.pointId);
      if (stop !== undefined) {
        const id = convertedId<ShapingPoint["id"]>(stop.id, "shape_");
        if (intent.shaping.some((point) => point.id === id)) {
          return fail(
            "duplicate-shape-id",
            `a shaping anchor "${id}" already exists`,
          );
        }
        const anchorIssues = rejectCoordinateIssues(validateCoordinate(stop.coordinate));
        if (anchorIssues !== null) return anchorIssues;
        // 04 §15: the converted object keeps its identity (UUID body) and its
        // position; the branded prefix changes with the brand (03 §1). The
        // anchor's `source` states where its *position* came from, so a search
        // result stays a search result instead of becoming a map drag.
        return applyChange(
          {
            ...intent,
            stops: intent.stops.filter((entry) => entry.id !== command.pointId),
            shaping: [
              ...intent.shaping,
              {
                id,
                kind: "shape",
                coordinate: stop.coordinate,
                source: shapingSourceFor(stop.provenance),
              },
            ],
          },
          true,
        );
      }

      const anchor = intent.shaping.find((entry) => entry.id === command.pointId);
      if (anchor === undefined) {
        return fail(
          "unknown-point-id",
          `no stop or shaping anchor "${command.pointId}" to convert`,
        );
      }
      const stopId = convertedId<StopPoint["id"]>(anchor.id, "stop_");
      if (intent.stops.some((entry) => entry.id === stopId)) {
        return fail("duplicate-stop-id", `a stop "${stopId}" already exists`);
      }
      const issues = rejectCoordinateIssues(validateCoordinate(anchor.coordinate));
      if (issues !== null) return issues;
      // A shaping anchor records no provenance, so the honest answer for the
      // converted stop is that this location was *derived* from an anchor — not
      // that the rider searched for it. The stop is appended: it has no position
      // in the itinerary yet, and appending is the one order that invents
      // nothing (the rider reorders it, 04 §15).
      return applyChange(
        {
          ...intent,
          shaping: intent.shaping.filter((entry) => entry.id !== command.pointId),
          stops: [
            ...intent.stops,
            {
              id: stopId,
              kind: "stop",
              coordinate: anchor.coordinate,
              provenance: {
                type: "derived",
                reason: "converted from shaping anchor",
              },
            },
          ],
        },
        true,
      );
    }

    case "shape.insert": {
      const coordinateIssues = rejectCoordinateIssues(
        validateCoordinate(command.point.coordinate),
      );
      if (coordinateIssues !== null) return coordinateIssues;
      if (intent.shaping.some((point) => point.id === command.point.id)) {
        return fail(
          "duplicate-shape-id",
          `a shaping anchor "${command.point.id}" already exists`,
        );
      }
      return applyChange(
        {
          ...intent,
          shaping: [...intent.shaping, { ...command.point, kind: "shape" as const }],
        },
        true,
      );
    }

    case "shape.move": {
      if (!intent.shaping.some((point) => point.id === command.shapeId)) {
        return fail("unknown-shape-id", `no shaping anchor "${command.shapeId}" to move`);
      }
      const coordinateIssues = rejectCoordinateIssues(
        validateCoordinate(command.coordinate),
      );
      if (coordinateIssues !== null) return coordinateIssues;
      return applyChange(
        {
          ...intent,
          shaping: intent.shaping.map((point) =>
            point.id === command.shapeId
              ? { ...point, coordinate: command.coordinate }
              : point,
          ),
        },
        true,
      );
    }

    case "shape.remove": {
      if (!intent.shaping.some((point) => point.id === command.shapeId)) {
        return fail("unknown-shape-id", `no shaping anchor "${command.shapeId}" to remove`);
      }
      return applyChange(
        {
          ...intent,
          shaping: intent.shaping.filter((point) => point.id !== command.shapeId),
        },
        true,
      );
    }

    case "time.set": {
      const issues = validateTimeIntent(command.time);
      if (issues.length > 0) return fail("invalid-time", issues.join("; "));
      return applyChange({ ...intent, time: command.time }, true);
    }

    case "departure.set": {
      if (
        command.departure.kind === "future" &&
        Number.isNaN(Date.parse(command.departure.at))
      ) {
        return fail(
          "invalid-departure",
          `departure instant "${command.departure.at}" is not a readable date-time`,
        );
      }
      return applyChange({ ...intent, departure: command.departure }, true);
    }

    case "roadCharacter.set": {
      if (!ROAD_CHARACTERS.includes(command.roadCharacter)) {
        return fail(
          "invalid-road-character",
          `road character "${command.roadCharacter}" is not a known character`,
        );
      }
      return applyChange({ ...intent, roadCharacter: command.roadCharacter }, true);
    }

    case "noveltyPreference.set": {
      if (!NOVELTY_PREFERENCES.includes(command.noveltyPreference)) {
        return fail(
          "invalid-novelty-preference",
          `novelty preference "${command.noveltyPreference}" is not known`,
        );
      }
      return applyChange({ ...intent, noveltyPreference: command.noveltyPreference }, true);
    }

    case "surface.set": {
      const issues = validateSurfaceIntent(command.surface);
      if (issues.length > 0) return fail("invalid-surface", issues.join("; "));
      return applyChange({ ...intent, surface: command.surface }, true);
    }

    case "terrain.set": {
      if (!TERRAIN_LEVELS.includes(command.terrain.level)) {
        return fail(
          "invalid-terrain",
          `terrain level "${command.terrain.level}" is not a known level`,
        );
      }
      return applyChange({ ...intent, terrain: command.terrain }, true);
    }

    case "trafficPreference.set": {
      if (!TRAFFIC_PREFERENCES.includes(command.traffic)) {
        return fail(
          "invalid-traffic-preference",
          `traffic preference "${command.traffic}" is not a known preference`,
        );
      }
      return applyChange({ ...intent, traffic: command.traffic }, true);
    }

    case "highwayPolicy.set":
      return applyChange({ ...intent, avoidHighways: command.avoid }, true);

    case "tollPolicy.set": {
      if (!TOLL_POLICIES.includes(command.tollPolicy)) {
        return fail(
          "invalid-toll-policy",
          `toll policy "${command.tollPolicy}" is not a known policy`,
        );
      }
      return applyChange({ ...intent, tollPolicy: command.tollPolicy }, true);
    }

    case "bike.set": {
      const issues = validateBikeConstraintSnapshot(command.bike);
      if (issues.length > 0) return fail("invalid-bike", issues.join("; "));
      return applyChange({ ...intent, bike: command.bike }, true);
    }

    case "avoidArea.create": {
      if (intent.avoidAreas.some((area) => area.id === command.area.id)) {
        return fail(
          "duplicate-avoid-area-id",
          `an avoid area "${command.area.id}" already exists`,
        );
      }
      return applyChange(
        { ...intent, avoidAreas: [...intent.avoidAreas, command.area] },
        true,
      );
    }

    case "avoidArea.update": {
      const current = intent.avoidAreas.find((area) => area.id === command.areaId);
      if (current === undefined) {
        return fail("unknown-avoid-area-id", `no avoid area "${command.areaId}"`);
      }
      const updated: AvoidArea = {
        ...current,
        ...(command.geometryRef === undefined ? {} : { geometryRef: command.geometryRef }),
        ...(command.name === undefined ? {} : { name: command.name }),
        ...(command.enabled === undefined ? {} : { enabled: command.enabled }),
      };
      // A rename alone cannot move geometry; a new geometry ref or a change of
      // enablement can.
      const reroute = command.geometryRef !== undefined || command.enabled !== undefined;
      return applyChange(
        {
          ...intent,
          avoidAreas: intent.avoidAreas.map((area) =>
            area.id === command.areaId ? updated : area,
          ),
        },
        reroute,
      );
    }

    case "avoidArea.remove": {
      if (!intent.avoidAreas.some((area) => area.id === command.areaId)) {
        return fail("unknown-avoid-area-id", `no avoid area "${command.areaId}"`);
      }
      return applyChange(
        {
          ...intent,
          avoidAreas: intent.avoidAreas.filter((area) => area.id !== command.areaId),
        },
        true,
      );
    }

    case "roadSpan.create": {
      if (intent.roadSpans.some((span) => span.id === command.span.id)) {
        return fail(
          "duplicate-road-span-id",
          `a road span "${command.span.id}" already exists`,
        );
      }
      const anchorIssues = command.span.anchorRefs.flatMap((anchor) =>
        validateCoordinate(anchor),
      );
      const anchorFailure = rejectCoordinateIssues(anchorIssues);
      if (anchorFailure !== null) return anchorFailure;
      return applyChange(
        { ...intent, roadSpans: [...intent.roadSpans, command.span] },
        true,
      );
    }

    case "roadSpan.update": {
      const current = intent.roadSpans.find((span) => span.id === command.spanId);
      if (current === undefined) {
        return fail("unknown-road-span-id", `no road span "${command.spanId}"`);
      }
      const updated: RoadSpanConstraint = {
        ...current,
        ...(command.mode === undefined ? {} : { mode: command.mode }),
        ...(command.geometryRef === undefined ? {} : { geometryRef: command.geometryRef }),
        ...(command.direction === undefined ? {} : { direction: command.direction }),
      };
      return applyChange(
        {
          ...intent,
          roadSpans: intent.roadSpans.map((span) =>
            span.id === command.spanId ? updated : span,
          ),
        },
        true,
      );
    }

    case "roadSpan.remove": {
      if (!intent.roadSpans.some((span) => span.id === command.spanId)) {
        return fail("unknown-road-span-id", `no road span "${command.spanId}"`);
      }
      return applyChange(
        { ...intent, roadSpans: intent.roadSpans.filter((span) => span.id !== command.spanId) },
        true,
      );
    }

    case "sketch.commit":
      return applyChange({ ...intent, sketch: command.sketch }, true);

    case "sketch.clear":
      return applyChange({ ...intent, sketch: null }, true);

    case "longTrip.set": {
      const value: LongTripIntent | null = command.value;
      // The current `{ staged, notes }` slot has no routing consumer until
      // Task 7.5 refines it, so this is metadata: no reroute requested.
      return applyChange({ ...intent, longTrip: value }, false);
    }

    default:
      return assertNever(command);
  }
}

interface CommitInput {
  readonly label: string;
  readonly reroute: boolean;
  /** `false` only for explicit non-undoable initialization (system-location). */
  readonly undoable: boolean;
  readonly now: string | undefined;
  readonly proposalId?: string;
}

/** One new revision, one optional history entry, deeply frozen result. */
function commit(
  document: RideDocument,
  intent: RideIntent,
  input: CommitInput,
): RideCommandResult {
  const revision = document.revision + 1;
  const updatedAt = input.now ?? new Date().toISOString();
  const appended = input.undoable
    ? appendHistoryEntry(document.history, {
        entryId: newHistoryEntryId(),
        label: input.label,
        revision,
        intent,
      })
    : document.history;
  const history =
    input.proposalId === undefined
      ? appended
      : recordProposalApplied(appended, input.proposalId);
  return {
    outcome: "applied",
    document: deepFreeze<RideDocument>({
      ...document,
      revision,
      updatedAt,
      intent,
      history,
    }),
    reroute: input.reroute,
  };
}

/** System-location seeding of an empty start is initialization, not an edit. */
function isUndoable(command: RideCommand): boolean {
  return !(command.type === "start.set" && command.source === "system-location");
}

function invalid(code: string, message: string): RideCommandResult {
  return { outcome: "invalid", code, message };
}

/**
 * Applies one typed command to one authored ride revision (see the module
 * comment for the ordered checks and the reroute table). Pure and total: it
 * returns a result value for every input and never throws.
 */
export function applyRideCommand(
  document: RideDocument,
  command: RideCommand,
  options: RideCommandOptions = {},
): RideCommandResult {
  if (command.rideId !== document.rideId) {
    return invalid(
      "ride-mismatch",
      `command targets ride "${command.rideId}" but the document is "${document.rideId}"`,
    );
  }
  if (command.baseRevision !== document.revision) {
    return { outcome: "stale", currentRevision: document.revision };
  }
  if (command.type === "proposal.apply") {
    return applyProposal(document, command, options);
  }
  const outcome = applyOperation(document.intent, command);
  if (isInvalid(outcome)) return invalid(outcome.code, outcome.message);
  if (structurallyEqual(outcome.intent, document.intent)) {
    return { outcome: "noop", document };
  }
  return commit(document, outcome.intent, {
    label: command.label,
    reroute: outcome.reroute,
    undoable: isUndoable(command),
    now: options.now,
  });
}

/**
 * One advisor apply is exactly one revision and one history entry, whatever the
 * number of operations it carries (03-DOMAIN-MODEL §24, §27).
 *
 * Inner operations run sequentially on a scratch intent, so their own
 * `baseRevision` is never consulted and an inner operation can never be `stale`
 * by construction. An inner failure fails the whole apply with the inner code;
 * inner no-ops are simply skipped.
 */
function applyProposal(
  document: RideDocument,
  command: Extract<RideCommand, { type: "proposal.apply" }>,
  options: RideCommandOptions,
): RideCommandResult {
  if (document.history.appliedProposalIds.includes(command.proposalId)) {
    return { outcome: "noop", document };
  }
  let intent = document.intent;
  let reroute = false;
  for (const operation of command.operations) {
    const outcome = applyOperation(intent, operation);
    if (isInvalid(outcome)) return invalid(outcome.code, outcome.message);
    intent = outcome.intent;
    reroute = reroute || outcome.reroute;
  }
  if (structurallyEqual(intent, document.intent)) {
    // Nothing changed, so nothing is recorded: replaying this proposal stays a
    // no-op instead of burning a revision and an id.
    return { outcome: "noop", document };
  }
  return commit(document, intent, {
    label: command.label,
    reroute,
    undoable: true,
    now: options.now,
    proposalId: command.proposalId,
  });
}
