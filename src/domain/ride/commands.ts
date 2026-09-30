/**
 * Typed commands for changes authored by the rider.
 *
 * `RideCommand` is the **only** public mutation entry for authored ride state.
 * It is a discriminated union on `type`; every member carries the ride ID, the
 * base revision it was authored against, a command ID, its authoring source and
 * a human label. There is deliberately no generic patch, no `setState`, and no
 * `Partial<RideIntent>` edit member (VNX-003): a caller can only ask for one
 * named, typed operation, and `applyRideCommand` decides whether it is invalid,
 * stale, a no-op, or a new revision.
 *
 * Validators for each operation live in `reducer.ts`, next to the semantics
 * they guard, so an operation's preconditions, changed fields and reroute
 * answer are readable in one place. Payloads never repeat the common fields and
 * never accept a partial intent: the only partials are partials *of a known
 * domain object* (`avoidArea.update`, `roadSpan.update`), addressed by stable ID.
 */

import type {
  AvoidAreaId,
  CommandId,
  GeometryRef,
  RideId,
  RoadSpanId,
  ShapingId,
  StopId,
} from "./ids";
import type {
  AvoidArea,
  BikeConstraintSnapshot,
  CommandSource,
  Coordinate,
  DepartureIntent,
  LocationProvenance,
  LongTripIntent,
  NoveltyPreference,
  RideDocument,
  RideIntent,
  RoadCharacterIntent,
  RoadSpanConstraint,
  ShapingPoint,
  SketchIntent,
  StopArrivalIntent,
  StopPoint,
  SurfaceIntent,
  TerrainIntent,
  TimeIntent,
  TollPolicy,
  TrafficPreference,
  RidePoint,
} from "./types";

/** The fields every command carries (02-ARCHITECTURE-CONTRACT §5). */
export interface RideCommandBase<T extends string> {
  readonly type: T;
  readonly commandId: CommandId;
  readonly rideId: RideId;
  /** Document revision this command was authored against; a lag is `stale`. */
  readonly baseRevision: number;
  readonly source: CommandSource;
  /** Human label for the one history entry the command produces. */
  readonly label: string;
}

/**
 * A location payload without identity: the coordinate, its provenance, and an
 * optional label. Identity stays with the entity being moved.
 */
export interface RideEndpointPayload {
  readonly coordinate: Coordinate;
  readonly label?: string;
  readonly provenance: LocationProvenance;
}

/**
 * The VNext command set (03-DOMAIN-MODEL §26). Each variant names one authored
 * operation; none of them accepts an arbitrary field bag.
 *
 * §26 calls its list a **minimum** set, and two operations the stop list needs
 * (04 §15) are not expressible as one of its members: converting a stop into a
 * shaping anchor and back, and editing a stop's arrival intent. Both are added
 * here as the same kind of narrow, typed, single-operation command §26 describes
 * — never as a compound of two commands (which would be two undo steps for one
 * rider action, 03 §27) and never as a partial-intent patch.
 */
export type RideCommand =
  | (RideCommandBase<"ride.create"> & { readonly bike?: BikeConstraintSnapshot })
  | (RideCommandBase<"ride.clear"> & Record<never, never>)
  | (RideCommandBase<"ride.reverse"> & Record<never, never>)
  | (RideCommandBase<"ride.shape.set"> & {
      readonly shape: RideIntent["shape"];
    })
  | (RideCommandBase<"start.set"> & { readonly point: RidePoint })
  | (RideCommandBase<"start.clear"> & Record<never, never>)
  | (RideCommandBase<"finish.set"> & { readonly point: RidePoint })
  | (RideCommandBase<"finish.clear"> & Record<never, never>)
  | (RideCommandBase<"stop.insert"> & {
      readonly stop: StopPoint;
      readonly beforeStopId?: StopId;
    })
  | (RideCommandBase<"stop.move"> & {
      readonly stopId: StopId;
      readonly endpoint: RideEndpointPayload;
    })
  | (RideCommandBase<"stop.reorder"> & {
      readonly stopId: StopId;
      readonly beforeStopId?: StopId;
    })
  | (RideCommandBase<"stop.remove"> & { readonly stopId: StopId })
  | (RideCommandBase<"stop.arrivalIntent.set"> & {
      readonly stopId: StopId;
      /** `null` clears the intent: the stop is a plain waypoint again. */
      readonly arrivalIntent: StopArrivalIntent | null;
    })
  | (RideCommandBase<"point.convert"> & {
      /**
       * The stop or shaping anchor to convert. Exactly one of the two
       * collections holds this identity, which is what decides the direction.
       */
      readonly pointId: StopId | ShapingId;
    })
  | (RideCommandBase<"shape.insert"> & { readonly point: ShapingPoint })
  | (RideCommandBase<"shape.move"> & {
      readonly shapeId: ShapingId;
      readonly coordinate: Coordinate;
    })
  | (RideCommandBase<"shape.remove"> & { readonly shapeId: ShapingId })
  | (RideCommandBase<"time.set"> & { readonly time: TimeIntent })
  | (RideCommandBase<"departure.set"> & { readonly departure: DepartureIntent })
  | (RideCommandBase<"roadCharacter.set"> & {
      readonly roadCharacter: RoadCharacterIntent;
    })
  | (RideCommandBase<"noveltyPreference.set"> & {
      readonly noveltyPreference: NoveltyPreference;
    })
  | (RideCommandBase<"surface.set"> & { readonly surface: SurfaceIntent })
  | (RideCommandBase<"terrain.set"> & { readonly terrain: TerrainIntent })
  | (RideCommandBase<"trafficPreference.set"> & {
      readonly traffic: TrafficPreference;
    })
  | (RideCommandBase<"highwayPolicy.set"> & { readonly avoid: boolean })
  | (RideCommandBase<"tollPolicy.set"> & { readonly tollPolicy: TollPolicy })
  | (RideCommandBase<"bike.set"> & { readonly bike: BikeConstraintSnapshot })
  | (RideCommandBase<"avoidArea.create"> & { readonly area: AvoidArea })
  | (RideCommandBase<"avoidArea.update"> & {
      readonly areaId: AvoidAreaId;
      readonly geometryRef?: GeometryRef;
      readonly name?: string | null;
      readonly enabled?: boolean;
    })
  | (RideCommandBase<"avoidArea.remove"> & { readonly areaId: AvoidAreaId })
  | (RideCommandBase<"roadSpan.create"> & { readonly span: RoadSpanConstraint })
  | (RideCommandBase<"roadSpan.update"> & {
      readonly spanId: RoadSpanId;
      readonly mode?: RoadSpanConstraint["mode"];
      readonly geometryRef?: GeometryRef;
      readonly direction?: RoadSpanConstraint["direction"];
    })
  | (RideCommandBase<"roadSpan.remove"> & { readonly spanId: RoadSpanId })
  | (RideCommandBase<"sketch.commit"> & { readonly sketch: SketchIntent })
  | (RideCommandBase<"sketch.clear"> & Record<never, never>)
  | (RideCommandBase<"longTrip.set"> & { readonly value: LongTripIntent | null })
  | (RideCommandBase<"proposal.apply"> & {
      readonly proposalId: string;
      /**
       * Inner operations are `RideCommandOp`: a proposal never nests another
       * proposal, so an advisor answer can never hide a second revision.
       */
      readonly operations: readonly RideCommandOp[];
    });

/**
 * Any command that may appear inside an advisor proposal (03-DOMAIN-MODEL §24).
 * `proposal.apply` is excluded so one apply is always exactly one revision and
 * one history unit.
 */
export type RideCommandOp = Exclude<RideCommand, { type: "proposal.apply" }>;

/** The outcome of one `applyRideCommand` call (02-ARCHITECTURE-CONTRACT §5). */
export type RideCommandResult =
  | { outcome: "applied"; document: RideDocument; reroute: boolean }
  | { outcome: "stale"; currentRevision: number }
  | { outcome: "invalid"; code: string; message: string }
  | { outcome: "noop"; document: RideDocument };

/**
 * Every command type, exhaustively: the declared key type is the union of command
 * types, so adding a variant without registering it here is a compile error and
 * a typo is an excess-property error. Runtime consumers (UI action registries,
 * diagnostics) read the registry instead of hand-copying the list.
 */
export const RIDE_COMMAND_TYPES = {
  "ride.create": true,
  "ride.clear": true,
  "ride.reverse": true,
  "ride.shape.set": true,
  "start.set": true,
  "start.clear": true,
  "finish.set": true,
  "finish.clear": true,
  "stop.insert": true,
  "stop.move": true,
  "stop.reorder": true,
  "stop.remove": true,
  "stop.arrivalIntent.set": true,
  "point.convert": true,
  "shape.insert": true,
  "shape.move": true,
  "shape.remove": true,
  "time.set": true,
  "departure.set": true,
  "roadCharacter.set": true,
  "noveltyPreference.set": true,
  "surface.set": true,
  "terrain.set": true,
  "trafficPreference.set": true,
  "highwayPolicy.set": true,
  "tollPolicy.set": true,
  "bike.set": true,
  "avoidArea.create": true,
  "avoidArea.update": true,
  "avoidArea.remove": true,
  "roadSpan.create": true,
  "roadSpan.update": true,
  "roadSpan.remove": true,
  "sketch.commit": true,
  "sketch.clear": true,
  "longTrip.set": true,
  "proposal.apply": true,
} as const satisfies Readonly<Record<RideCommand["type"], true>>;
