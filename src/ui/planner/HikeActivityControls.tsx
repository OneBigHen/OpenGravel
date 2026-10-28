"use client";

import { useEffect, useRef } from "react";

import type { RouteCandidate } from "@/domain/route/types";
import { setActivityMode, useActivityMode } from "@/ui/stores/activity-mode";

/**
 * Hike mode's card on the map. Riders never see it: the Ride / Hike switch
 * lives in the app menu and Settings, so the riding home stays chromeless.
 */
export function HikeActivityControls({ drawing, sketch, onEnterHike, candidate, error, canPlan, onPlan }: {
  readonly candidate: RouteCandidate | null;
  readonly error: string | null;
  readonly canPlan: boolean;
  readonly returnToStart: boolean;
  readonly onReturnToStart: (enabled: boolean) => void;
  readonly onPlan: () => void;
  readonly drawing: boolean;
  readonly sketch: { readonly onStartDrawing: () => void; readonly onUndo: () => void; readonly onCancel: () => void; readonly onDone: () => void };
  /** Called when hike mode turns on, so any road plan in flight is dropped. */
  readonly onEnterHike: () => void;
}) {
  const mode = useActivityMode();
  const enterRef = useRef(onEnterHike);
  useEffect(() => { enterRef.current = onEnterHike; });
  useEffect(() => {
    if (mode === "hike") enterRef.current();
  }, [mode]);
  if (mode !== "hike") return null;
  const hike = candidate?.provider.profile === "hike" ? candidate : null;
  // Planned: the numbers live in the bottom sheet (phones) or the inspector
  // (wide), so the card shrinks to its title and exit, and is hidden on phones
  // unless it has something to say (an error) or the rider is drawing.
  const state = drawing ? "drawing" : hike === null ? "idle" : "planned";
  return (
    <section className="og-hike-card" aria-label="Hiking" data-testid="hike-card" data-state={state} data-error={error === null ? undefined : "true"}>
      <div className="og-hike-card__head">
        <p className="og-hike-card__title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20l6-12 4 7 2-3 4 8z" />
          </svg>
          Hiking
        </p>
        <button type="button" className="og-hike-card__exit" data-testid="hike-exit" onClick={() => setActivityMode("ride")}>Back to riding</button>
      </div>
      {state === "idle" ? <p className="og-hike-card__note" role="status">Press and hold the map to set a start and finish, or draw your hike.</p> : null}
      {error === null ? null : <p className="og-hike-card__note" role="alert">{error}</p>}
      {state === "planned" ? null : <div className="og-hike-card__actions">
        {state === "idle" ? <button type="button" className="og-hike-card__action" data-testid="hike-plan" disabled={!canPlan} onClick={onPlan}>Plan hike</button> : null}
        {state === "drawing" ? <>
          <button type="button" className="og-hike-card__action" data-testid="hike-draw-undo" onClick={sketch.onUndo}>Undo</button>
          <button type="button" className="og-hike-card__action" data-testid="hike-draw-cancel" onClick={sketch.onCancel}>Cancel</button>
          <button type="button" className="og-hike-card__action og-hike-card__action--primary" data-testid="hike-draw-done" onClick={sketch.onDone}>Done</button>
        </> : <button type="button" className="og-hike-card__action og-hike-card__action--primary" data-testid="hike-draw-start" onClick={sketch.onStartDrawing}>Draw hike</button>}
      </div>}
    </section>
  );
}
