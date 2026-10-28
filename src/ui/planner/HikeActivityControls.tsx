"use client";

import { useEffect, useRef, useState } from "react";

import type { RouteCandidate } from "@/domain/route/types";
import { setActivityMode, useActivityMode } from "@/ui/stores/activity-mode";

const TIP_KEY = "og-hike-tip-dismissed";

function readTipDismissed(): boolean {
  try { return window.localStorage.getItem(TIP_KEY) === "1"; } catch { return false; }
}

/**
 * Hike mode's card on the map. Riders never see it: the Ride / Hike switch
 * lives in the app menu and Settings, so the riding home stays chromeless.
 * On phones it is one slim row (title, Draw, Plan, exit) so it does not cover
 * the map a hiker presses and holds on; the how-to line can be dismissed.
 */
export function HikeActivityControls({ drawing, sketch, onEnterHike, candidate, breadcrumb = false, error, canPlan, onPlan }: {
  readonly candidate: RouteCandidate | null;
  /** A breadcrumb (such as a trail opened from Explore) is on the map: its sheet owns the actions. */
  readonly breadcrumb?: boolean;
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
  const [tipDismissed, setTipDismissed] = useState(false);
  useEffect(() => { enterRef.current = onEnterHike; });
  useEffect(() => {
    if (mode === "hike") enterRef.current();
  }, [mode]);
  useEffect(() => { if (readTipDismissed()) queueMicrotask(() => setTipDismissed(true)); }, []);
  if (mode !== "hike") return null;
  const hike = candidate?.provider.profile === "hike" ? candidate : null;
  // Planned (or a breadcrumb is open): the numbers and actions live in the
  // bottom sheet (phones) or the inspector (wide), so the card shrinks to its
  // title and exit, and is hidden on phones unless it carries an error.
  const state = drawing ? "drawing" : hike === null && !breadcrumb ? "idle" : "planned";
  const dismissTip = () => {
    setTipDismissed(true);
    try { window.localStorage.setItem(TIP_KEY, "1"); } catch { /* the tip just comes back next time */ }
  };
  return (
    <section className="og-hike-card" aria-label="Hiking" data-testid="hike-card" data-state={state} data-error={error === null ? undefined : "true"}>
      <div className="og-hike-card__head">
        <p className="og-hike-card__title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20l6-12 4 7 2-3 4 8z" />
          </svg>
          <span className="og-hike-card__title-text">Hiking</span>
        </p>
        {state === "planned" ? null : <div className="og-hike-card__actions">
          {state === "drawing" ? <>
            <button type="button" className="og-hike-card__action" data-testid="hike-draw-undo" onClick={sketch.onUndo}>Undo</button>
            <button type="button" className="og-hike-card__action" data-testid="hike-draw-cancel" onClick={sketch.onCancel}>Cancel</button>
            <button type="button" className="og-hike-card__action og-hike-card__action--primary" data-testid="hike-draw-done" onClick={sketch.onDone}>Done</button>
          </> : <>
            <button type="button" className="og-hike-card__action" data-testid="hike-draw-start" onClick={sketch.onStartDrawing}>Draw</button>
            <button type="button" className="og-hike-card__action og-hike-card__action--primary" data-testid="hike-plan" disabled={!canPlan} onClick={onPlan}>Plan hike</button>
          </>}
        </div>}
        <button type="button" className="og-hike-card__exit" data-testid="hike-exit" aria-label="Back to riding" title="Back to riding" onClick={() => setActivityMode("ride")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          <span className="og-hike-card__exit-label">Back to riding</span>
        </button>
      </div>
      {state === "idle" && !tipDismissed ? (
        <p className="og-hike-card__tip" role="status">
          <span>{canPlan ? "Start and finish set. Plan the hike on trails." : "Press and hold the map to set a start and finish, or draw your hike."}</span>
          <button type="button" className="og-hike-card__tip-close" data-testid="hike-tip-dismiss" aria-label="Hide tip" onClick={dismissTip}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </p>
      ) : null}
      {error === null ? null : <p className="og-hike-card__note" role="alert">{error}</p>}
    </section>
  );
}
