"use client";

/**
 * The planner's sheet and wide planning rail.
 *
 * The workspace supplies current view models and typed callbacks; this surface
 * lays out status, history, composition, route decisions and refinement.
 */

import { useEffect, useRef, type ComponentProps, type CSSProperties, type RefObject } from "react";

import type { MapObjectRef } from "@/application/map/types";
import type { PlannerViewModel } from "@/application/planner/planner-view-model";
import type { SheetDetent } from "@/ui/stores/planner-ui-store";
import type { RoadTapOffer } from "@/ui/planner/hooks/usePlannerRoadSpans";
import { NO_FINISH_LABEL } from "@/application/planner/planner-view-model";
import { CLEAR_RIDE_LABEL } from "@/ui/stores/ride-document-store";
import { IntentComposer } from "@/ui/planner/IntentComposer";
import { PlannerRefineWorkspace } from "@/ui/planner/PlannerRefineWorkspace";
import { PlannerResultPanel } from "@/ui/planner/PlannerResultPanel";
import { PlannerWorkspaceStatus } from "@/ui/planner/PlannerWorkspaceStatus";

export interface PlannerWorkspaceDockProps {
  readonly dockRef: RefObject<HTMLDivElement | null>;
  readonly sheetHeadRef: RefObject<HTMLDivElement | null>;
  readonly sheetHeadHeight: number;
  readonly sheetDetent: SheetDetent;
  readonly viewModel: PlannerViewModel;
  readonly status: ComponentProps<typeof PlannerWorkspaceStatus>;
  readonly overlapCandidates: readonly MapObjectRef[];
  readonly onSelectOverlap: (ref: MapObjectRef) => void;
  readonly onDismissOverlap: () => void;
  /** "Avoid this road" after a tap on the selected route (NV-14). */
  readonly roadTap?: RoadTapOffer | null;
  readonly onToggleSheet: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** True when the ride has any authored point, so there is a route to clear. */
  readonly canClear: boolean;
  readonly onClearRide: () => void;
  readonly composer: ComponentProps<typeof IntentComposer>;
  readonly planning: boolean;
  readonly onCancelPlanning: () => void;
  readonly results: ComponentProps<typeof PlannerResultPanel>;
  readonly refine: ComponentProps<typeof PlannerRefineWorkspace>;
}

function overlapChoiceKey(ref: MapObjectRef, index: number): string {
  switch (ref.kind) {
    case "route":
      return `route:${ref.routeId}:${index}`;
    case "point":
      return `point:${ref.pointId}:${index}`;
    case "stop":
      return `stop:${ref.stopId}:${index}`;
    case "avoid-area":
      return `avoid-area:${ref.avoidAreaId}:${index}`;
    case "road-span":
      return `road-span:${ref.roadSpanId}:${index}`;
  }
}

export function PlannerWorkspaceDock({
  dockRef,
  sheetHeadRef,
  sheetHeadHeight,
  sheetDetent,
  viewModel,
  status,
  overlapCandidates,
  onSelectOverlap,
  onDismissOverlap,
  roadTap = null,
  onToggleSheet,
  onUndo,
  onRedo,
  canClear,
  onClearRide,
  composer,
  planning,
  onCancelPlanning,
  results,
  refine,
}: PlannerWorkspaceDockProps) {
  const hasChoices = viewModel.routeCards.length > 0;
  // Nothing asked for yet: the phone sheet shrinks to "Where to?" and a row of
  // quick starts (Trail Glass). Any destination, loop or plan grows it back.
  const idle =
    !hasChoices &&
    !planning &&
    composer.viewModel.finishLabel === NO_FINISH_LABEL &&
    composer.rideStyle?.view.shape !== "loop";
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // A new answer leads the rail (results first), so the rail returns to the top
  // when it lands, wherever the rider had scrolled to edit the ride.
  const answerKey = viewModel.routeCards.map((card) => card.routeId).join("|");
  useEffect(() => {
    if (answerKey === "") return;
    dockRef.current?.scrollTo?.({ top: 0 });
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [answerKey, dockRef]);
  return (
    <div
      className="og-planner__dock"
      data-testid="planner-dock"
      data-detent={sheetDetent}
      ref={dockRef}
    >
      <section
        className="og-planner__panel og-planner__sheet"
        data-testid="planner-sheet"
        data-detent={sheetDetent}
        data-idle={idle ? "true" : undefined}
        aria-label="Ride planning"
        style={{ "--og-sheet-head-height": `${sheetHeadHeight}px` } as CSSProperties}
      >
        <div className="og-sheet__head" data-testid="sheet-head" ref={sheetHeadRef}>
          <PlannerWorkspaceStatus {...status} />

          {overlapCandidates.length === 0 ? null : (
            <section
              className="og-overlap"
              data-testid="overlap-chooser"
              aria-label="Overlapping rides"
            >
              <p className="og-overlap__question">
                {`${overlapCandidates.length} rides overlap here. Which one?`}
              </p>
              <ul className="og-overlap__list">
                {overlapCandidates.map((ref, index) => {
                  const card =
                    ref.kind === "route"
                      ? viewModel.routeCards.find((entry) => entry.routeId === ref.routeId)
                      : undefined;
                  return (
                    <li className="og-overlap__item" key={overlapChoiceKey(ref, index)}>
                      <button
                        type="button"
                        className="og-chip og-overlap__choice"
                        data-testid={`overlap-choice-${index}`}
                        onClick={(): void => onSelectOverlap(ref)}
                      >
                        <span className="og-overlap__label">{card?.roleLabel ?? "Ride"}</span>
                        {card === undefined ? null : (
                          <span className="og-overlap__metrics">
                            {`${card.durationLabel} · ${card.distanceLabel}`}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                className="og-secondary"
                data-testid="overlap-dismiss"
                onClick={onDismissOverlap}
              >
                Not now
              </button>
            </section>
          )}

          {roadTap === null ? null : (
            <section className="og-overlap og-road-tap" data-testid="road-tap" aria-label="Road on this ride">
              <p className="og-overlap__question" data-testid="road-tap-name">
                {roadTap.roadName ?? "This stretch of road"}
              </p>
              <div className="og-road-tap__actions">
                <button
                  type="button"
                  className="og-chip og-overlap__choice"
                  data-testid="road-tap-avoid"
                  onClick={roadTap.onAvoid}
                >
                  {roadTap.roadName === null ? "Avoid this stretch" : "Avoid this road"}
                </button>
                <button
                  type="button"
                  className="og-secondary"
                  data-testid="road-tap-dismiss"
                  onClick={roadTap.onDismiss}
                >
                  Not now
                </button>
              </div>
            </section>
          )}

          <button
            type="button"
            className="og-sheet__handle"
            data-testid="sheet-handle"
            data-detent={sheetDetent}
            aria-expanded={sheetDetent === "expanded"}
            aria-controls="og-sheet-body"
            aria-label={`${sheetDetent === "expanded" ? "Hide" : "Show"} ride choices${
              viewModel.routeCards.length === 0 ? "" : ` (${viewModel.routeCards.length})`
            }`}
            onClick={onToggleSheet}
          >
            <span className="og-sheet__handle-label" data-testid="sheet-handle-label">
              {/* Collapsed with alternatives behind it, the label says what a tap does (FT-02). */}
              {sheetDetent !== "expanded" && viewModel.routeCards.length > 1 ? "Compare rides" : "Ride choices"}
            </span>
            {viewModel.routeCards.length === 0 ? null : (
              <span className="og-sheet__handle-count" data-testid="ride-choices-count">
                {viewModel.routeCards.length}
              </span>
            )}
            <span className="og-sheet__handle-chevron" aria-hidden="true">
              {sheetDetent === "expanded" ? "⌃" : "⌄"}
            </span>
          </button>

          {/*
            Owner review 2026-09-26 (OW-01): a restored draft had no way out.
            The × clears every point in one step; right after, the same spot
            offers its undo, in peek too, where the history row is hidden.
          */}
          {canClear ? (
            <button
              type="button"
              className="og-sheet__clear"
              data-testid="clear-ride"
              aria-label="Clear route"
              title="Clear route"
              onClick={onClearRide}
            >
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
              </svg>
            </button>
          ) : viewModel.undoLabel === CLEAR_RIDE_LABEL ? (
            <button
              type="button"
              className="og-chip og-sheet__undo-clear"
              data-testid="undo-clear"
              onClick={onUndo}
            >
              Undo clear
            </button>
          ) : null}

          {viewModel.undoLabel === null && viewModel.redoLabel === null ? null : (
            <div className="og-history" data-testid="history-controls">
              <button
                type="button"
                className="og-chip og-history__button"
                data-testid="undo"
                title={viewModel.undoLabel === null ? "Undo" : `Undo · ${viewModel.undoLabel}`}
                disabled={viewModel.undoLabel === null}
                onClick={onUndo}
              >
                Undo
                {/* What it undoes is in the title; the pill shows the verb (theme-glass.css). */}
                {viewModel.undoLabel === null ? null : <span className="og-history__what">{` · ${viewModel.undoLabel}`}</span>}
              </button>
              <button
                type="button"
                className="og-chip og-history__button"
                data-testid="redo"
                title={viewModel.redoLabel === null ? "Redo" : `Redo · ${viewModel.redoLabel}`}
                disabled={viewModel.redoLabel === null}
                onClick={onRedo}
              >
                Redo
                {viewModel.redoLabel === null ? null : <span className="og-history__what">{` · ${viewModel.redoLabel}`}</span>}
              </button>
            </div>
          )}
        </div>

        <div
          className="og-sheet__body"
          id="og-sheet-body"
          data-testid="sheet-scroll"
          ref={bodyRef}
        >
          {/*
            UX rework phase 2: once there are choices, the answer comes first —
            route cards, profile and Start — and the itinerary follows to edit.
            DOM order, not CSS order, so focus order matches what is seen. On
            the wide tier the result portals to the inspector either way.
          */}
          {hasChoices ? <PlannerResultPanel {...results} /> : null}
          <IntentComposer {...composer} />
          {planning ? (
            <button
              type="button"
              className="og-secondary"
              data-testid="cancel-planning"
              onClick={onCancelPlanning}
            >
              Cancel
            </button>
          ) : null}
          {hasChoices ? null : <PlannerResultPanel {...results} />}
          <PlannerRefineWorkspace {...refine} />
        </div>
      </section>
    </div>
  );
}
