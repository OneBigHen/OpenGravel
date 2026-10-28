"use client";

import { useEffect, useRef } from "react";

import { setActivityMode, useActivityMode } from "@/ui/stores/activity-mode";

/**
 * Hike mode's card on the map. Riders never see it: the Ride / Hike switch
 * lives in the app menu and Settings, so the riding home stays chromeless.
 */
export function HikeActivityControls({ drawing, sketch, onEnterHike }: {
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
  return (
    <section className="og-hike-card" aria-label="Hiking" data-testid="hike-card">
      <div className="og-hike-card__head">
        <p className="og-hike-card__title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20l6-12 4 7 2-3 4 8z" />
          </svg>
          Hiking
        </p>
        <button type="button" className="og-hike-card__exit" data-testid="hike-exit" onClick={() => setActivityMode("ride")}>Back to riding</button>
      </div>
      <p className="og-hike-card__note" role="status">Trail routing is coming. Draw your hike on the map.</p>
      <div className="og-hike-card__actions">
        {drawing ? <>
          <button type="button" className="og-hike-card__action" data-testid="hike-draw-undo" onClick={sketch.onUndo}>Undo</button>
          <button type="button" className="og-hike-card__action" data-testid="hike-draw-cancel" onClick={sketch.onCancel}>Cancel</button>
          <button type="button" className="og-hike-card__action og-hike-card__action--primary" data-testid="hike-draw-done" onClick={sketch.onDone}>Done</button>
        </> : <button type="button" className="og-hike-card__action og-hike-card__action--primary" data-testid="hike-draw-start" onClick={sketch.onStartDrawing}>Draw hike</button>}
      </div>
    </section>
  );
}
