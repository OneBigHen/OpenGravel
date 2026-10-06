"use client";

/**
 * The route-editing bar on the map (owner review 2026-10-04: "I can't see where
 * I draw the route or modify the route plotted").
 *
 * Drawing and stop placement used to live in a collapsed "Refine" section at
 * the bottom of the sheet, and the route had no visible handles at all. This
 * bar puts them on the map, where the editing happens:
 *
 * - **Idle with a ride:** `Draw` and `Add stop`, plus a one-line tip that the
 *   pins and the line can be dragged (once per device, dismissible).
 * - **Drawing:** the pen's own controls — Undo, Clear, Cancel, Done — with the
 *   stroke status, so a rider never has to find them in the sheet.
 * - **Placing a stop:** what the next tap does, and Cancel.
 *
 * It only reads props and calls back; the workspace owns every state change.
 */

import { useState, useSyncExternalStore } from "react";

import type { PointerTool } from "@/application/map/interaction";
import type { MapScene } from "@/application/map/types";
import { sketchDraftStrokeCount } from "@/application/planner/sketch-draft";
import type { SketchPanelProps } from "@/ui/planner/SketchPanel";
import type { PlacementTool } from "@/ui/stores/planner-ui-store";

const TIP_KEY = "opengravel-edit-tip-seen";

const subscribeNothing = (): (() => void) => () => {};
function readTipSeen(): boolean {
  try {
    return window.localStorage.getItem(TIP_KEY) === "1";
  } catch {
    return false;
  }
}

export interface MapEditBarProps {
  /** True when a ride is drawn, so there is something to edit. */
  readonly hasRoute: boolean;
  /** True while the pen owns the map. */
  readonly drawing: boolean;
  /** True while the next tap places a stop. */
  readonly placingStop: boolean;
  readonly strokes: number;
  readonly snapStatus: "snapping" | "snapped" | null;
  /** True on a coarse pointer (touch), where the line is grabbed by a hold. */
  readonly touch: boolean;
  readonly onDraw: () => void;
  readonly onAddStop: () => void;
  readonly onCancelPlacement: () => void;
  readonly onUndo: () => void;
  readonly onClear: () => void;
  readonly onDone: () => void;
  readonly onCancelDrawing: () => void;
}

function Icon({ path }: { readonly path: string }) {
  return (
    <svg className="og-editbar__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const PEN = "M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20zM14 7l3 3";
const PIN_PLUS = "M12 21s-6-5.4-6-10.5a6 6 0 0 1 12 0C18 15.6 12 21 12 21zM12 7.5v6M9 10.5h6";
const UNDO = "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3";
const TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";
const CHECK = "M5 12.5l4.5 4.5L19 7.5";
const CLOSE = "M6 6l12 12M18 6L6 18";

export function MapEditBar(props: MapEditBarProps) {
  const { hasRoute, drawing, placingStop } = props;
  const storedSeen = useSyncExternalStore(subscribeNothing, readTipSeen, () => true);
  const [dismissed, setDismissed] = useState(false);
  // The idle tools stay tucked behind one button so the map is not cluttered.
  const [open, setOpen] = useState(false);
  const tipSeen = storedSeen || dismissed;
  const dismissTip = (): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem(TIP_KEY, "1");
    } catch {
      // Private mode: the tip simply comes back next time.
    }
  };

  if (drawing) {
    const status =
      props.snapStatus === "snapping"
        ? "Finding roads…"
        : props.strokes === 0
          ? "Trace your ride on the map"
          : props.snapStatus === "snapped"
            ? "On roads. Keep drawing or tap Done"
            : "Keep drawing, or tap Done";
    return (
      <div className="og-editbar" data-mode="drawing" data-testid="map-edit-bar" role="toolbar" aria-label="Drawing">
        <p className="og-editbar__status" aria-live="polite">
          <span className="og-editbar__pulse" aria-hidden="true" />
          {status}
        </p>
        <div className="og-editbar__row">
          <button type="button" className="og-editbar__btn" data-testid="map-edit-undo" onClick={props.onUndo} disabled={props.strokes === 0}>
            <Icon path={UNDO} />
            Undo
          </button>
          <button type="button" className="og-editbar__btn" data-testid="map-edit-clear" onClick={props.onClear} disabled={props.strokes === 0}>
            <Icon path={TRASH} />
            Clear
          </button>
          <button type="button" className="og-editbar__btn" data-testid="map-edit-cancel" onClick={props.onCancelDrawing}>
            <Icon path={CLOSE} />
            Cancel
          </button>
          <button type="button" className="og-editbar__btn og-editbar__btn--go" data-testid="map-edit-done" onClick={props.onDone} disabled={props.strokes === 0}>
            <Icon path={CHECK} />
            Done
          </button>
        </div>
      </div>
    );
  }

  if (placingStop) {
    return (
      <div className="og-editbar" data-mode="placing" data-testid="map-edit-bar" role="toolbar" aria-label="Add a stop">
        <p className="og-editbar__status" aria-live="polite">
          <span className="og-editbar__pulse" aria-hidden="true" />
          Tap the map where the stop goes
        </p>
        <div className="og-editbar__row">
          <button type="button" className="og-editbar__btn" data-testid="map-edit-cancel-stop" onClick={props.onCancelPlacement}>
            <Icon path={CLOSE} />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="og-editbar" data-mode="idle" data-testid="map-edit-bar" role="toolbar" aria-label="Edit the ride">
        <div className="og-editbar__row">
          <button
            type="button"
            className="og-editbar__btn"
            data-testid="map-edit-open"
            aria-expanded="false"
            onClick={() => setOpen(true)}
          >
            <Icon path={PEN} />
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="og-editbar" data-mode="idle" data-testid="map-edit-bar" role="toolbar" aria-label="Edit the ride">
      <div className="og-editbar__row">
        <button
          type="button"
          className="og-editbar__btn"
          data-testid="map-edit-draw"
          onClick={() => {
            setOpen(false);
            props.onDraw();
          }}
        >
          <Icon path={PEN} />
          Draw
        </button>
        {hasRoute ? (
          <button
            type="button"
            className="og-editbar__btn"
            data-testid="map-edit-add-stop"
            onClick={() => {
              setOpen(false);
              props.onAddStop();
            }}
          >
            <Icon path={PIN_PLUS} />
            Add stop
          </button>
        ) : null}
        <button
          type="button"
          className="og-editbar__btn"
          data-testid="map-edit-close"
          aria-label="Close edit tools"
          onClick={() => setOpen(false)}
        >
          <Icon path={CLOSE} />
        </button>
      </div>
      {hasRoute && !tipSeen ? (
        <p className="og-editbar__tip" data-testid="map-edit-tip">
          <span>
            {props.touch
              ? "Drag a pin to move it. Hold the line, then drag, to reroute."
              : "Drag a pin to move it, or drag the line to reroute."}
          </span>
          <button type="button" className="og-editbar__tip-close" onClick={dismissTip} aria-label="Dismiss tip">
            <Icon path={CLOSE} />
          </button>
        </p>
      ) : null}
    </div>
  );
}

const COARSE_POINTER = "(pointer: coarse)";
function subscribeCoarsePointer(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}
function readCoarsePointer(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(COARSE_POINTER).matches;
}

export interface PlannerMapEditBarProps {
  readonly scene: MapScene;
  readonly activeTool: PointerTool;
  readonly placementTool: PlacementTool;
  readonly sketch: Omit<SketchPanelProps, "drawing" | "committed" | "hasAuthoredEndpoints">;
  readonly onAddStop: () => void;
  readonly onCancelPlacement: () => void;
}

/** The bar wired to the planner's own state: the workspace passes what it has. */
export function PlannerMapEditBar({
  scene,
  activeTool,
  placementTool,
  sketch,
  onAddStop,
  onCancelPlacement,
}: PlannerMapEditBarProps) {
  // A touch screen grabs the route line by a hold, so the tip says so.
  const touch = useSyncExternalStore(subscribeCoarsePointer, readCoarsePointer, () => false);
  return (
    <MapEditBar
      hasRoute={scene.routes.some((route) => route.geometry.length >= 2)}
      drawing={activeTool === "sketch"}
      placingStop={placementTool === "place-stop"}
      strokes={sketchDraftStrokeCount(sketch.draft)}
      snapStatus={sketch.snapStatus ?? null}
      touch={touch}
      onDraw={sketch.onStartDrawing}
      onAddStop={onAddStop}
      onCancelPlacement={onCancelPlacement}
      onUndo={sketch.onUndo}
      onClear={sketch.onClear}
      onDone={sketch.onDone}
      onCancelDrawing={sketch.onCancel}
    />
  );
}
