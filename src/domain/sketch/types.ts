/**
 * Sketch geometry semantics (03-DOMAIN-MODEL §13, 04 §19, 05 §18–§19, 06 §18).
 *
 * A sketch is the rider's **rough intent**, not geometry: a free-hand multi-stroke
 * trace whose raw strokes stay preserved while a simplified corridor is derived
 * for route matching. This module defines the shared vocabulary and its bounds.
 *
 * Two rules keep it honest:
 *
 * - **Topology is recorded, never rewritten** (05 §19). A crossing, a double-back
 *   and a near-loop are *hints*, each carrying the coordinate where the structure
 *   was observed, so a consumer can preserve traversal order without the builder
 *   collapsing the trace spatially.
 * - **The raw stroke is the authority.** Everything here describes a derived
 *   value; a retry re-derives it from the stored raw trace, never from screen
 *   pixels that were re-unprojected against a camera that has since moved
 *   (04 §19).
 */

import type { Coordinate } from "../ride/types";

/** The structural features 05 §19 requires a sketch to preserve. */
export type SketchTopologyHintKind = "crossing" | "double-back" | "near-loop";

/** Every kind, for runtime re-checks of an untrusted (persisted) document. */
export const SKETCH_TOPOLOGY_HINT_KINDS: readonly SketchTopologyHintKind[] = [
  "crossing",
  "double-back",
  "near-loop",
];

/**
 * One structural feature observed on the raw trace (03 §13).
 *
 * `at` is the coordinate the feature was measured at — the segment intersection,
 * the reversal vertex, or the loop's own opening point — so the hint is
 * actionable without re-running the geometry. `strokeIndices` names the strokes
 * involved, in authoring order; a hint inside one stroke names it once, and a
 * figure-eight's self-crossing is therefore `[0]`, never a fabricated second
 * stroke.
 */
export interface SketchTopologyHint {
  readonly kind: SketchTopologyHintKind;
  readonly at: Coordinate;
  readonly strokeIndices?: readonly number[];
}

/**
 * The two endpoints a sketch derives (03 §13, 04 §19 "first stroke in a new ride
 * derives start/finish").
 *
 * They are the corridor's own first and last positions, in traversal order: a
 * figure-eight keeps the direction it was drawn in, and a near-loop's finish is
 * wherever the rider actually stopped rather than a snapped-closed copy of the
 * start.
 */
export interface SketchEndpoints {
  readonly start: Coordinate;
  readonly finish: Coordinate;
}

/** How a committed sketch treats the ride's authored endpoints (03 §13). */
export type SketchEndpointPolicy = "derive" | "preserve-existing";

/**
 * Two strokes closer than this are one continuous traversal (04 §19).
 *
 * The gap is bridged because a 30 m lift of the finger is not a different ride —
 * but only up to this bound: a longer gap becomes a **break** in the corridor, and
 * the renderer draws one line per segment, so no long straight connector is ever
 * drawn as if the rider had ridden it (06 §18). 30 m is roughly the width of a
 * two-lane road crossed at a junction, and an order of magnitude below the
 * smallest meaningful detour a planner would offer.
 */
export const STROKE_JOIN_GAP_METERS = 30;

/**
 * How close a trace's own endpoints must be to count as a near-loop (04 §19).
 *
 * 150 m is the distance the preview uses to say "this closes": far enough that a
 * rider's hand-closed loop with a small overshoot still reads as a loop, and small
 * enough that a ride drawn from A to a clearly different B never does.
 */
export const LOOP_CLOSE_METERS = 150;

/**
 * The corridor's adaptive simplification tolerance, in meters (04 §19).
 *
 * Douglas–Peucker with this tolerance bounds **every** dropped vertex, so the p95
 * chord error cannot exceed it. Eight meters is far below the ~25 m on-route
 * tolerance the road-span engine uses to call a vertex "on the route", so a
 * simplified corridor cannot make a route look closer to the trace than it is,
 * while still removing the hundreds of near-collinear samples a free-hand stroke
 * accumulates.
 */
export const SKETCH_SIMPLIFY_TOLERANCE_METERS = 8;

/**
 * The turn angle at which a consecutive direction reversal is a double-back
 * (05 §19).
 *
 * 150° is the house hairpin threshold: a switchback taken at the very end of the
 * road, not a sharp corner. A rider who genuinely doubles back has reversed the
 * direction they were travelling, which is 180° before any measurement noise; 150°
 * is the honest lower bound that does not call a tight mountain bend a reversal.
 */
export const STROKE_DOUBLE_BACK_MIN_TURN_DEGREES = 150;

/**
 * The most raw strokes one sketch may carry.
 *
 * A product bound, not a technical one: the drawing surface accumulates a stroke
 * per gesture, so a sketch that reaches this many is either a deliberate scribble
 * or a stuck pointer, and either way the corridor is no longer a riding intent.
 */
export const MAX_SKETCH_STROKES = 64;

/** The most points one raw stroke may carry before it is refused. */
export const MAX_SKETCH_STROKE_POINTS = 5_000;

/**
 * How many anchors a sketch contributes to one provider request (06 §18,
 * OGV-D-285).
 *
 * A cap, not a sampling target. Anchors are placed by the drawing's shape
 * (`shapeAwareSketchAnchors`: one per run between significant bends, at most
 * ~1.5 mi apart and at least ~0.5 mi apart), so a 300-mile day ride needs a few
 * hundred of them. The old bound of 20 evenly spaced anchors gave a 60-mile
 * sketch one hint every three miles, and the router went its own way between
 * them. The provider splits a long list into engine-sized chunks.
 */
export const MAX_SKETCH_REQUEST_ANCHORS = 400;

/** The most topology hints one sketch may carry, so a scribble cannot grow one. */
export const MAX_SKETCH_TOPOLOGY_HINTS = 64;

/** Minimum lateral half-width of the sketch's soft corridor, in meters. */
export const MIN_SKETCH_CORRIDOR_ENVELOPE_METERS = 600;

/** Maximum lateral half-width; beyond this the trace stops meaning anything. */
export const MAX_SKETCH_CORRIDOR_ENVELOPE_METERS = 8_000;

/**
 * The share of the corridor's own length that its envelope grows by.
 *
 * Derived from the trace rather than fixed, so a 4-mile doodle and a 200-mile
 * sweep both get a sane band (ported from the legacy `sketch-corridor.ts`).
 */
export const SKETCH_CORRIDOR_ENVELOPE_LENGTH_SHARE = 0.06;

/**
 * The covered share at or above which the route is *known* to follow the sketch.
 *
 * `EvidenceStatus` has to be earned: at 90% of the corridor's samples inside the
 * envelope, "the route follows the line you drew" is a measurement, and below it
 * the same number is only an estimate of how close it came.
 */
export const SKETCH_ADHERENCE_KNOWN_COVERED_SHARE = 0.9;

/**
 * The covered share below which the route is materially off the sketch.
 *
 * 75% leaves room for the honest detours every engine takes around a bend or a
 * private gate, and fails the case the product rule exists for: a route that used
 * the drawing as a vague direction and went somewhere else entirely (04 §19 "show
 * significant deviation").
 */
export const SKETCH_DEVIATION_WARNING_COVERED_SHARE = 0.75;
