"use client";

/**
 * The planner's sheet and wide planning rail.
 *
 * The workspace supplies current view models and typed callbacks; this surface
 * lays out status, history, composition, route decisions and refinement.
 */

import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import type { MapObjectRef } from "@/application/map/types";
import type { PlannerViewModel } from "@/application/planner/planner-view-model";
import type { SheetDetent } from "@/ui/stores/planner-ui-store";
import type { RoadTapOffer } from "@/ui/planner/hooks/usePlannerRoadSpans";
import { useDesktopPlanner, usePhonePlanner } from "./usePhonePlanner";
import { NO_FINISH_LABEL, NO_START_LABEL } from "@/application/planner/planner-view-model";
import { CLEAR_RIDE_LABEL } from "@/ui/stores/ride-document-store";
import { IntentComposer } from "@/ui/planner/IntentComposer";
import { PlannerMapEditBar, type PlannerMapEditBarProps } from "@/ui/planner/MapEditBar";
import { PlannerRefineWorkspace } from "@/ui/planner/PlannerRefineWorkspace";
import { PlannerResultPanel } from "@/ui/planner/PlannerResultPanel";
import { PlannerWorkspaceStatus } from "@/ui/planner/PlannerWorkspaceStatus";

export interface PlannerWorkspaceDockProps {
  readonly placeSheet?: ReactNode;
  readonly showOptions?: boolean;
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
  /** Swipe or drag the sheet one height up or down (mini < resting < expanded). */
  readonly onStepSheet: (direction: "up" | "down") => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** True when the ride has any authored point, so there is a route to clear. */
  readonly canClear: boolean;
  readonly onClearRide: () => void;
  readonly composer: ComponentProps<typeof IntentComposer>;
  /**
   * The route-editing tools, when the dock owns them (the desktop rail): they sit
   * in the sheet's head beside undo/redo, next to the route they edit, instead of
   * floating over the map. Absent on the tiers where the map slot renders them.
   */
  readonly editBar?: PlannerMapEditBarProps | undefined;
  readonly planning: boolean;
  readonly onCancelPlanning: () => void;
  readonly results: ComponentProps<typeof PlannerResultPanel>;
  readonly refine: ComponentProps<typeof PlannerRefineWorkspace>;
  /**
   * The glance strip, when the dock lies over the map: it sits directly above the
   * sheet (`MapRideGlance`), so the summary stays readable while the sheet is
   * folded. On the tiers where the dock is a sibling column the strip is drawn in
   * the map slot instead and this node is hidden by CSS.
   */
  readonly glance?: ReactNode;
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

/** A curved arrow: back for undo, mirrored for redo. */
function HistoryGlyph({ direction }: { readonly direction: "undo" | "redo" }) {
  return (
    <svg
      className="og-history__glyph"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      data-direction={direction}
    >
      <path
        d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** How far a finger travels on the sheet's head before it counts as a swipe. */
const SWIPE_PX = 36;

export function PlannerWorkspaceDock({
  placeSheet,
  showOptions = false,
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
  onStepSheet,
  onUndo,
  onRedo,
  canClear,
  onClearRide,
  composer,
  editBar,
  planning,
  onCancelPlanning,
  results,
  refine,
  glance,
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
  const loopRide = composer.rideStyle?.view.shape === "loop";
  const placeLabel = loopRide ? composer.viewModel.startLabel : composer.viewModel.finishLabel;
  const destinationLine =
    placeLabel === NO_FINISH_LABEL || placeLabel === NO_START_LABEL || placeLabel === "From your sketch" || placeLabel === ""
      ? null
      : // The place name a rider says ("Hawk Mountain Sanctuary"), not its full address.
        `${loopRide ? "Loop from" : "To"} ${placeLabel.split(",")[0]?.trim() || placeLabel}`;

  const historyHidden =
    (viewModel.undoLabel === null && viewModel.redoLabel === null) || (idle && viewModel.redoLabel === null);
  const history = historyHidden ? null : (
            <div className="og-history" data-testid="history-controls">
              {/*
                Icon buttons (owner 2026-09-28: the stacked arrow-over-word pills
                "are weird"). The text stays in the button for its accessible
                name; what it undoes is in the title.
              */}
              <button
                type="button"
                className="og-chip og-history__button"
                data-testid="undo"
                title={viewModel.undoLabel === null ? "Undo" : `Undo · ${viewModel.undoLabel}`}
                disabled={viewModel.undoLabel === null}
                onClick={onUndo}
              >
                <HistoryGlyph direction="undo" />
                <span className="og-history__text">
                  Undo
                  {viewModel.undoLabel === null ? null : <span className="og-history__what">{` · ${viewModel.undoLabel}`}</span>}
                </span>
              </button>
              <button
                type="button"
                className="og-chip og-history__button"
                data-testid="redo"
                title={viewModel.redoLabel === null ? "Redo" : `Redo · ${viewModel.redoLabel}`}
                disabled={viewModel.redoLabel === null}
                onClick={onRedo}
              >
                <HistoryGlyph direction="redo" />
                <span className="og-history__text">
                  Redo
                  {viewModel.redoLabel === null ? null : <span className="og-history__what">{` · ${viewModel.redoLabel}`}</span>}
                </span>
              </button>
            </div>
  );
  const phone = usePhonePlanner();
  // The desktop rail is the only tier that puts the edit tools in the panel; the
  // frame renders them over the map everywhere else (the two checks are the same
  // query, so they can never both render the bar).
  const desktop = useDesktopPlanner();
  const detent = placeSheet ? "half" : phone ? sheetDetent === "expanded" ? "full" : sheetDetent === "half" ? "half" : "peek" : sheetDetent;
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const swipe = useRef<{ y: number; id: number; height: number } | null>(null);
  const swallowClick = useRef(false);
  const swipeHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>): void => {
      // Phone: the 48px handle drags the sheet. Elsewhere any touch on the head swipes it.
      const handle = event.target instanceof Element ? event.target.closest<HTMLElement>(".og-sheet__handle") : null;
      if (phone ? handle === null : event.pointerType === "mouse") return;
      const height = event.currentTarget.parentElement?.getBoundingClientRect().height ?? 0;
      swipe.current = { y: event.clientY, id: event.pointerId, height };
      if (phone) handle?.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>): void => {
      const start = swipe.current;
      if (start === null || start.id !== event.pointerId) return;
      const dy = event.clientY - start.y;
      if (Math.abs(dy) > 4) swallowClick.current = true;
      if (phone) setDragHeight(Math.max(120, Math.min(window.innerHeight - 72, start.height - dy)));
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>): void => {
      const start = swipe.current;
      swipe.current = null;
      setDragHeight(null);
      if (start === null || start.id !== event.pointerId) return;
      const dy = event.clientY - start.y;
      if (Math.abs(dy) >= SWIPE_PX) onStepSheet(dy < 0 ? "up" : "down");
      // Pointer-generated clicks are synchronous with release. Keyboard taps
      // after this gesture must still work.
      window.setTimeout(() => { swallowClick.current = false; }, 0);
    },
    onPointerCancel: (): void => {
      swipe.current = null;
      swallowClick.current = false;
      setDragHeight(null);
    },
    onClickCapture: (event: ReactMouseEvent<HTMLDivElement>): void => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
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
      data-detent={detent}
      ref={dockRef}
    >
      {glance}
      <section
        className="og-planner__panel og-planner__sheet"
        data-testid="planner-sheet"
        data-detent={detent}
        data-directions={showOptions && detent === "half" ? "true" : undefined}
        data-place={placeSheet ? "true" : undefined}
        data-idle={idle && !placeSheet ? "true" : undefined}
        data-has-ride={hasChoices ? "true" : "false"}
        data-dragging={dragHeight !== null ? "true" : undefined}
        aria-label="Ride planning"
        style={{ "--og-sheet-head-height": `${sheetHeadHeight}px`, ...(dragHeight === null ? {} : { "--og-sheet-drag-h": `${dragHeight}px` }) } as CSSProperties}
      >
        <div className="og-sheet__head" data-testid="sheet-head" ref={sheetHeadRef} {...swipeHandlers}>
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
            data-detent={detent}
            aria-expanded={phone ? detent !== "peek" : sheetDetent === "expanded"}
            aria-controls="og-sheet-body"
            aria-label={phone ? `Planner: ${detent}. ${detent === "full" ? "Collapse to peek" : detent === "half" ? "Expand fully" : "Expand to half"}` :
              sheetDetent === "mini"
                ? "Show planner"
                : `${sheetDetent === "expanded" ? "Hide" : "Show"} ${hasChoices ? "ride choices" : "ride style"}${
                    viewModel.routeCards.length === 0 ? "" : ` (${viewModel.routeCards.length})`
                  }`
            }
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                onStepSheet(event.key === "ArrowUp" ? "up" : "down");
              } else if (event.key === "Home" && phone) {
                event.preventDefault();
                onStepSheet("down");
              }
            }}
            onClick={onToggleSheet}
          >
            <span className="og-sheet__handle-label" data-testid="sheet-handle-label">
              {/* Collapsed with alternatives behind it, the label says what a tap does (FT-02). */}
              {sheetDetent === "mini"
                ? "Show planner"
                : hasChoices
                  ? sheetDetent !== "expanded" && viewModel.routeCards.length > 1
                    ? "Compare rides"
                    : "Ride choices"
                  : "Ride style"}
            </span>
            {viewModel.routeCards.length === 0 ? null : (
              <span className="og-sheet__handle-count" data-testid="ride-choices-count">
                {viewModel.routeCards.length}
              </span>
            )}
            <span className="og-sheet__handle-chevron" aria-hidden="true">
              {sheetDetent === "expanded" ? "⌃" : sheetDetent === "mini" ? "⌃" : "⌄"}
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

          {/*
            The first screen is From / Where to? only (owner 2026-10-04), unless
            the rider just undid back to it and Redo is the way forward. On the
            desktop rail the edit tools join undo/redo here, so the map carries no
            floating bar and the route is edited from the panel that holds it.
          */}
          {phone ? null : editBar === undefined || !desktop ? history : (
            <div className="og-sheet__tools" data-testid="sheet-edit-tools">
              <PlannerMapEditBar {...editBar} />
              {history}
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
            At the peek detent the summary offers Compare rides, and the options
            plus the one-tap ride style need more room than the peek block has,
            so that tap steps the sheet up once instead of hiding its own list.
          */}
          {placeSheet ? <div className="og-place-sheet-slot">{placeSheet}</div> : null}
          {hasChoices ? (
            <PlannerResultPanel
              {...results}
              showOptions={showOptions && detent !== "peek"}
              destinationLine={destinationLine}
              {...(detent === "peek" ? { onExpandSheet: (): void => onStepSheet("up") } : {})}
            />
          ) : null}
          {phone && (hasChoices || history !== null) ? (
            <div className="og-phone-tools" data-testid="phone-tools">
              {hasChoices ? <button type="button" className="og-phone-edit" data-testid="edit-route" onClick={() => {
                bodyRef.current?.querySelector(".og-composer")?.scrollIntoView({ block: "start" });
                bodyRef.current?.querySelector<HTMLInputElement>("input")?.focus();
              }}>Edit route</button> : null}
              {history}
            </div>
          ) : null}
          <IntentComposer {...composer} hideIdleSearch={idle && !desktop} {...(planning ? { onCancelPlanning } : {})} />
          {hasChoices ? null : <PlannerResultPanel {...results} />}
          <PlannerRefineWorkspace {...refine} />
        </div>
      </section>
    </div>
  );
}
