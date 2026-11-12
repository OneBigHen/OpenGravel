"use client";

/**
 * "Road blocked" on the ride screen (R3-6). One tap says "I could not get
 * through here"; a two-choice sheet with glove-size buttons asks what kind; the
 * spot is kept on this device and the rider's next plans avoid it. Nothing is
 * sent anywhere and nothing here says a road is closed to anyone else.
 *
 * The rail button and the Menu row share one hook so the sheet and the toast
 * exist once. All styling reuses the Ride Focus and emergency card classes.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { deleteRiderReport, saveRiderReport } from "@/application/persistence/rider-report-repository";
import { newRiderReport, type RiderReportKind } from "@/application/roads/rider-reports";
import type { Coordinate } from "@/domain/ride/types";
import type { NavigationPosition } from "@/domain/ride-session/navigation";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

/** 5 mph in metres per second. The rail button shows only below this. */
export const ROAD_BLOCKED_MAX_SPEED_MPS = 2.2352;
export const ROAD_BLOCKED_UNDO_MS = 8000;

/** Whether the rail button shows: a good fix and a known speed under 5 mph. Unknown speed hides it. */
export function roadBlockedRailShown(position: NavigationPosition | null): boolean {
  if (position === null || position.coordinate === null || position.quality !== "fresh-good") return false;
  return position.speedMps !== null && position.speedMps < ROAD_BLOCKED_MAX_SPEED_MPS;
}

interface Marked {
  readonly id: string;
  readonly saved: boolean;
}

export function useRoadBlocked(position: NavigationPosition | null) {
  const [spot, setSpot] = useState<{ readonly point: Coordinate; readonly heading: number | null } | null>(null);
  const [marked, setMarked] = useState<Marked | null>(null);
  const canReport = position !== null && position.coordinate !== null && position.quality === "fresh-good";

  const open = useCallback((): void => {
    if (position === null || position.coordinate === null || position.quality !== "fresh-good") return;
    setMarked(null);
    setSpot({ point: position.coordinate, heading: position.headingDegrees });
  }, [position]);
  const cancel = useCallback((): void => setSpot(null), []);
  const choose = useCallback((kind: RiderReportKind): void => {
    if (spot === null) return;
    const now = Date.now();
    const report = newRiderReport({ id: `rr_${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`, point: spot.point, headingDegrees: spot.heading, kind, nowMs: now });
    const saved = saveRiderReport(report, now);
    setSpot(null);
    setMarked({ id: report.id, saved });
  }, [spot]);
  const undo = useCallback((): void => {
    if (marked !== null) deleteRiderReport(marked.id, Date.now());
    setMarked(null);
  }, [marked]);

  useEffect(() => {
    if (marked === null) return;
    const timer = window.setTimeout(() => setMarked(null), ROAD_BLOCKED_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [marked]);

  return { canReport, sheetOpen: spot !== null, marked, open, cancel, choose, undo };
}

export type RoadBlockedState = ReturnType<typeof useRoadBlocked>;

export function RoadBlockedRailButton({ state }: { readonly state: RoadBlockedState }) {
  return (
    <button
      type="button"
      className="og-ride__rail-button"
      data-testid="ride-road-blocked"
      aria-label="Road blocked"
      title="Road blocked"
      onClick={state.open}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 21V4M6 5h12l-3 4 3 4H6" />
      </svg>
    </button>
  );
}

export function RoadBlockedMenuRow({ state, onOpened }: { readonly state: RoadBlockedState; readonly onOpened?: () => void }) {
  return (
    <div className="og-ride__menu-group" data-testid="ride-menu-road-blocked">
      <button
        type="button"
        className="og-ride__sheet-row"
        data-testid="ride-menu-road-blocked-row"
        disabled={!state.canReport}
        title={state.canReport ? undefined : "Waiting for a good location"}
        onClick={(): void => { state.open(); onOpened?.(); }}
      >
        <span className="og-ride__sheet-row-label">Road blocked</span>
        <span className="og-ride__sheet-row-hint">{state.canReport ? "Gate closed, road too rough" : "Waiting for your location"}</span>
      </button>
    </div>
  );
}

/** The two-choice sheet and, after a choice, the toast. Render once inside the ride screen. */
export function RoadBlockedOverlay({ state, onReroute, rerouteBusy = false }: {
  readonly state: RoadBlockedState;
  /** Offered only on a guided ride; absent otherwise. */
  readonly onReroute?: (() => void) | undefined;
  readonly rerouteBusy?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useDialogFocus(panelRef, state.cancel);
  return (
    <>
      {!state.sheetOpen ? null : (
        <div className="og-emergency" data-testid="road-blocked-layer">
          <div className="og-emergency__scrim" aria-hidden="true" />
          <div ref={panelRef} className="og-emergency__panel" role="dialog" aria-modal="true" aria-labelledby={headingId} data-testid="road-blocked-sheet" tabIndex={-1}>
            <h2 className="og-emergency__title" id={headingId}>What stopped you?</h2>
            <button type="button" className="og-ride__sheet-row" data-testid="road-blocked-gate" onClick={(): void => state.choose("gate-closed")}>
              <span className="og-ride__sheet-row-label">Gate closed</span>
            </button>
            <button type="button" className="og-ride__sheet-row" data-testid="road-blocked-rough" onClick={(): void => state.choose("road-bad")}>
              <span className="og-ride__sheet-row-label">Road too rough</span>
            </button>
            <button type="button" className="og-ride__sheet-row" data-testid="road-blocked-cancel" onClick={state.cancel}>
              <span className="og-ride__sheet-row-label">Cancel</span>
            </button>
          </div>
        </div>
      )}
      {state.marked === null ? null : (
        <div className="og-ride__toast og-ride__toast--report" data-testid="road-blocked-toast" role="status">
          <span>{state.marked.saved ? "Marked. Your next routes avoid this spot." : "Could not save this spot on this device."}</span>
          {!state.marked.saved ? null : (
            <button type="button" className="og-ride__toast-action" data-testid="road-blocked-undo" onClick={state.undo}>Undo</button>
          )}
          {onReroute === undefined || !state.marked.saved ? null : (
            <button type="button" className="og-ride__toast-action" data-testid="road-blocked-reroute" disabled={rerouteBusy} onClick={onReroute}>New route from here</button>
          )}
        </div>
      )}
    </>
  );
}
