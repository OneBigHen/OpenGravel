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
  type ReactNode,
  type RefObject,
} from "react";

import { RideStylePanel } from "./RideStyleControls";
import { Sheet } from "@/ui/sheet/Sheet";
import type { MapObjectRef } from "@/application/map/types";
import type { PlannerViewModel } from "@/application/planner/planner-view-model";
import type { SheetDetent } from "@/ui/stores/planner-ui-store";
import type { RoadTapOffer } from "@/ui/planner/hooks/usePlannerRoadSpans";
import { useCompactPlanner, useDesktopPlanner, usePhonePlanner } from "./usePhonePlanner";
import { NO_FINISH_LABEL, NO_START_LABEL } from "@/application/planner/planner-view-model";
import { CLEAR_RIDE_LABEL } from "@/ui/stores/ride-document-store";
import { IntentComposer } from "@/ui/planner/IntentComposer";
import { PlannerMapEditBar, type PlannerMapEditBarProps } from "@/ui/planner/MapEditBar";
import { PlannerRefineWorkspace } from "@/ui/planner/PlannerRefineWorkspace";
import { PlannerResultPanel } from "@/ui/planner/PlannerResultPanel";
import { PlannerWorkspaceStatus } from "@/ui/planner/PlannerWorkspaceStatus";

export interface PlannerWorkspaceDockProps {
  readonly placeSheet?: ReactNode;
  readonly onDismissPlace?: (() => void) | undefined;
  readonly showOptions?: boolean;
  readonly onFullSheet?: () => void;
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

export function PlannerWorkspaceDock({
  placeSheet,
  onDismissPlace,
  showOptions = false,
  onFullSheet,
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
  useEffect(() => {
    dockRef.current?.style.setProperty("--og-sheet-head-height", `${sheetHeadHeight}px`);
  }, [dockRef, sheetHeadHeight]);
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
  const compact = useCompactPlanner();
  const [sheetView, setSheetView] = useState<"choices" | "edit" | "options">("choices");
  const optionsMode = showOptions && compact && hasChoices && !placeSheet;
  const activeSheetView = sheetDetent === "expanded" ? sheetView : "choices";
  const openEditor = (next: "edit" | "options") => { setSheetView(next); onFullSheet?.(); };
  const detent = compact ? sheetDetent === "expanded" ? "full" : sheetDetent === "half" || sheetDetent === "ride" ? "half" : "peek" : sheetDetent;
  useEffect(() => {
    if (!optionsMode || activeSheetView === "choices") return;
    bodyRef.current?.querySelector<HTMLElement>("[data-sheet-focus]")?.focus({ preventScroll: true });
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [optionsMode, activeSheetView]);
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
      <Sheet
        className="og-planner__panel og-planner__sheet"
        data-testid="planner-sheet"
        data-detent={detent}
        data-directions={optionsMode ? "true" : undefined}
        data-sheet-view={activeSheetView}
        data-place={placeSheet ? "true" : undefined}
        data-idle={idle && !placeSheet ? "true" : undefined}
        data-has-ride={hasChoices ? "true" : "false"}
        label="Ride planning"
        detent={sheetDetent === "expanded" ? "full" : sheetDetent === "half" || sheetDetent === "ride" ? "half" : "peek"}
        rail={!compact}
        onToggle={onToggleSheet}
        onStep={onStepSheet}
        headRef={sheetHeadRef}
        bodyRef={bodyRef}
        onDismiss={placeSheet ? onDismissPlace : undefined}
        focusKey={optionsMode ? `options:${activeSheetView}` : undefined}
        handleLabel={compact ? undefined : sheetDetent === "mini" ? "Show planner" : `${sheetDetent === "expanded" ? "Hide" : "Show"} ${hasChoices ? "ride choices" : "ride style"}${hasChoices ? ` (${viewModel.routeCards.length})` : ""}`}
        head={<>
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
        </>}
        handleContent={<>
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
        </>}
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
          {optionsMode && activeSheetView !== "choices" ? <div className="og-route-options__editor-head">
            <button type="button" data-testid="back-to-options" onClick={() => setSheetView("choices")}>‹ Route options</button>
            <h2 tabIndex={-1} data-sheet-focus>{activeSheetView === "edit" ? "Edit ride" : "Options"}</h2>
          </div> : null}
          {hasChoices && (!optionsMode || activeSheetView === "choices") ? (
            <PlannerResultPanel
              {...results}
              showOptions={optionsMode}
              startLabel={results.actions.document.intent.start?.provenance.type === "gps" ? "My location" : results.actions.document.intent.start?.label ?? composer.viewModel.startLabel}
              finishLabel={results.actions.document.intent.finish?.provenance.type === "gps" ? "My location" : results.actions.document.intent.finish?.label ?? composer.viewModel.finishLabel}
              onEditOptions={() => openEditor("edit")}
              onOpenOptions={() => openEditor("options")}
              destinationLine={destinationLine}
              {...(detent === "peek" ? { onExpandSheet: (): void => onStepSheet("up") } : {})}
            />
          ) : null}
          {!optionsMode && phone && (hasChoices || history !== null) ? (
            <div className="og-phone-tools" data-testid="phone-tools">
              {hasChoices ? <button type="button" className="og-phone-edit" data-testid="edit-route" onClick={() => {
                bodyRef.current?.querySelector(".og-composer")?.scrollIntoView({ block: "start" });
                bodyRef.current?.querySelector<HTMLInputElement>("input")?.focus();
              }}>Edit route</button> : null}
              {history}
            </div>
          ) : null}
          {(!optionsMode || activeSheetView === "edit") && <IntentComposer {...composer} hideIdleSearch={idle && !desktop} {...(planning ? { onCancelPlanning } : {})} />}
          {hasChoices ? null : <PlannerResultPanel {...results} />}
          {optionsMode && activeSheetView === "options" && composer.rideStyle !== undefined ? <RideStylePanel model={composer.rideStyle} expanded/> : null}
          {(!optionsMode || activeSheetView !== "choices") && <PlannerRefineWorkspace {...refine} />}

      </Sheet>
    </div>
  );
}
