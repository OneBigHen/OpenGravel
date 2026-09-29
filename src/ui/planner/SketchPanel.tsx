"use client";

/**
 * The drawing toolbar (04 §19, 05 §18; Task 4.4).
 *
 * Every control here is one of the six the spec names, and each one is a
 * *presentation* action until `Done`:
 *
 * - `Draw a route` arms the pen;
 * - `Undo` / `Redo` cross one whole stroke (04 §19's "last vertex batch" — one
 *   gesture is one batch);
 * - `Clear` empties the surface — the draft first, and the committed sketch when
 *   there is no draft;
 * - `Done` commits the trace as **one** `sketch.commit` and plans;
 * - `Cancel` leaves the pen without authoring anything;
 * - `Keep existing endpoints` is the toggle 04 §19 asks for "where relevant", and
 *   it is relevant exactly when the ride already has an endpoint of its own;
 * - `Extend drawing` re-opens a committed drawing so the next stroke carries on
 *   from its end (OGV-D-285).
 *
 * While the pen is armed, each lift of the finger snaps the drawing so far onto
 * roads (snap-as-you-go); the status line says when that is running and done.
 *
 * The panel is deliberately a plain action bar rather than a form: the drawing is
 * the input, and the toolbar only says what happens next. It is always present,
 * because drawing is a first-class planning tool (04 §19) and a tool with no
 * visible entry point is not a tool — the action bar is what the rider arms it
 * from, and what removes a sketch once one exists.
 */

import type { SketchDraftState } from "@/application/planner/sketch-draft";
import {
  sketchDraftCanCommit,
  sketchDraftStrokeCount,
  sketchDraftVertexCount,
} from "@/application/planner/sketch-draft";
import type { SketchEndpointPolicy } from "@/domain/sketch/types";

export interface SketchPanelProps {
  /** True while the `sketch` pointer tool owns the map (05 §4). */
  readonly drawing: boolean;
  readonly draft: SketchDraftState;
  /** True when the ride already carries a committed sketch. */
  readonly committed: boolean;
  readonly endpointPolicy: SketchEndpointPolicy;
  /** True when the ride has an authored start or finish to keep. */
  readonly hasAuthoredEndpoints: boolean;
  /** The near-loop verdict of the draft, or `null` when there is too little trace. */
  readonly nearLoop: boolean | null;
  readonly error: string | null;
  /**
   * Snap-as-you-go (OGV-D-285): `snapping` while the drawing so far is being
   * routed, `snapped` once the map shows it on roads, `null` before a lift.
   */
  readonly snapStatus?: "snapping" | "snapped" | null;
  readonly onStartDrawing: () => void;
  /** Re-open the committed drawing to carry on from its end. */
  readonly onExtend?: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onClear: () => void;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly onToggleEndpoints: (keep: boolean) => void;
}

/** What the status cell says about the drawing so far. */
function sketchStatusCopy(
  strokes: number,
  vertices: number,
  committed: boolean,
): string {
  if (strokes === 0) {
    return committed ? "Your sketch is drawn." : "Nothing drawn yet.";
  }
  return `${strokes} stroke${strokes === 1 ? "" : "s"} · ${vertices} points`;
}

/**
 * The endpoint toggle (04 §19 "where relevant"): it exists only when the ride has
 * an endpoint of its own, because on a ride with none there is nothing to keep.
 */
function EndpointPolicyToggle({
  policy,
  onToggleEndpoints,
}: {
  readonly policy: SketchEndpointPolicy;
  readonly onToggleEndpoints: (keep: boolean) => void;
}): React.JSX.Element {
  const keeping = policy === "preserve-existing";
  return (
    <button
      type="button"
      className="og-chip"
      data-testid="sketch-keep-endpoints"
      aria-pressed={keeping}
      onClick={() => onToggleEndpoints(!keeping)}
    >
      {keeping ? "Keeping your endpoints" : "Using the drawn endpoints"}
    </button>
  );
}

/** The armed action bar: the six controls of 04 §19, in the order they act. */
function DrawingActions(props: SketchPanelProps): React.JSX.Element {
  const { draft, nearLoop, endpointPolicy, hasAuthoredEndpoints } = props;
  return (
    <div className="og-sketch__actions" data-testid="sketch-actions">
      {/*
        The near-loop preview 04 §19 asks for: the verdict comes from the same
        builder the commit uses, so what the rider reads is what the corridor will
        be. It is shown only once a trace could close a loop at all.
      */}
      {nearLoop === null ? null : (
        <p className="og-sketch__near-loop" data-testid="sketch-near-loop">
          {nearLoop
            ? "This trace nearly closes a loop."
            : "This trace is not a loop yet."}
        </p>
      )}

      {props.snapStatus === undefined || props.snapStatus === null ? null : (
        <p className="og-sketch__near-loop" data-testid="sketch-snap-status" aria-live="polite">
          {props.snapStatus === "snapping"
            ? "Snapping to roads…"
            : "On the roads you drew. Keep drawing, or tap Done."}
        </p>
      )}

      {hasAuthoredEndpoints ? (
        <EndpointPolicyToggle
          policy={endpointPolicy}
          onToggleEndpoints={props.onToggleEndpoints}
        />
      ) : null}

      <button
        type="button"
        className="og-chip"
        data-testid="sketch-undo"
        disabled={sketchDraftStrokeCount(draft) === 0}
        onClick={props.onUndo}
      >
        Undo
      </button>
      <button
        type="button"
        className="og-chip"
        data-testid="sketch-redo"
        disabled={draft.undone.length === 0}
        onClick={props.onRedo}
      >
        Redo
      </button>
      <button
        type="button"
        className="og-chip"
        data-testid="sketch-clear"
        disabled={sketchDraftStrokeCount(draft) === 0 && !props.committed}
        onClick={props.onClear}
      >
        Clear
      </button>
      <button
        type="button"
        className="og-primary"
        data-testid="sketch-done"
        disabled={!sketchDraftCanCommit(draft)}
        onClick={props.onDone}
      >
        Done
      </button>
      <button
        type="button"
        className="og-secondary"
        data-testid="sketch-cancel"
        onClick={props.onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

/** The idle action bar: arm the pen, or remove the sketch that is on the map. */
function IdleActions({
  committed,
  onClear,
  onExtend,
}: {
  readonly committed: boolean;
  readonly onClear: () => void;
  readonly onExtend: (() => void) | undefined;
}): React.JSX.Element | null {
  if (!committed) return null;
  return (
    <div className="og-sketch__actions" data-testid="sketch-actions">
      {onExtend === undefined ? null : (
        <button
          type="button"
          className="og-chip"
          data-testid="sketch-extend"
          onClick={onExtend}
        >
          Extend drawing
        </button>
      )}
      <button
        type="button"
        className="og-chip"
        data-testid="sketch-clear"
        onClick={onClear}
      >
        Remove sketch
      </button>
    </div>
  );
}

export function SketchPanel(props: SketchPanelProps): React.JSX.Element {
  const { drawing, draft, committed, error } = props;
  const strokes = sketchDraftStrokeCount(draft);

  return (
    <section className="og-sketch" aria-label="Draw a route" data-testid="sketch-panel">
      <div className="og-sketch__row">
        <span className="og-sketch__label">Draw</span>
        <span className="og-sketch__value" data-testid="sketch-status">
          {sketchStatusCopy(strokes, sketchDraftVertexCount(draft), committed)}
        </span>
        <button
          type="button"
          className="og-chip"
          data-testid="start-drawing"
          data-armed={drawing ? "true" : "false"}
          aria-pressed={drawing}
          onClick={props.onStartDrawing}
        >
          {drawing ? "Drawing…" : committed ? "Draw again" : "Draw a route"}
        </button>
      </div>

      {drawing ? (
        <DrawingActions {...props} />
      ) : (
        <IdleActions committed={committed} onClear={props.onClear} onExtend={props.onExtend} />
      )}

      {error === null ? null : (
        <p className="og-point__error" role="alert" data-testid="sketch-error">
          {error}
        </p>
      )}
    </section>
  );
}
