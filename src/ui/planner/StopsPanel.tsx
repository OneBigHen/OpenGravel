"use client";

/**
 * The ordered object list (04-PLANNER-AND-WORKSPACE-UX §14–§15, §20, §31).
 *
 * 04 §15 names the objects — Start, the stops in order, Finish — and the actions
 * every one of them supports: replace place, drag on map, reorder, remove,
 * convert stop ↔ shaping point, zoom to. This component is the **list form** of
 * all of them (04 §31): the map is not required for anything, every operation is a
 * real `<button>`, and the numeric inspector is the accessible way to move a point
 * to an exact position.
 *
 * Each row states the leg that ends at it ("34 mi · ~48 min from previous"), so
 * the list reads as the ride briefing rather than as a set of pins. The legs are
 * projected by the view model from the selected route's own line; this component
 * only prints what it was given, and prints words where the line measured
 * nothing.
 *
 * It renders and it calls back; it never dispatches. The workspace owns the
 * authorities (04 §2), so "one gesture = one command = one undo unit" (03 §27) is
 * enforced in one place — here a button press is one intent, whatever the command
 * that satisfies it turns out to be.
 *
 * Two product rules are visible in the markup:
 *
 * - **Shaping anchors are not stops.** They never appear in the itinerary
 *   (04 §15: they exist so a route goes through a place, not so a rider visits
 *   it), so they get their own section, and the conversion action is the one
 *   deliberate bridge between the two lists.
 * - **Truthful states.** Reorder is disabled at the ends of the list, "convert"
 *   says which direction it converts, and the numeric editor validates before it
 *   submits and announces the failure inline rather than dispatching a command the
 *   reducer would refuse.
 */

import { useCallback, useMemo, useState, type ReactElement } from "react";

import {
  canMoveStopDown,
  canMoveStopUp,
  reorderTargetFor,
} from "@/application/planner/stop-insertion";
import type {
  ItineraryRef,
  PlannerViewModel,
  PointRowVm,
} from "@/application/planner/planner-view-model";
import type { StopId } from "@/domain/ride/ids";
import type { Coordinate, StopArrivalIntent } from "@/domain/ride/types";
import type { PlacementTool } from "@/ui/stores/planner-ui-store";
import { ARRIVAL_INTENT_LABELS, ARRIVAL_INTENTS } from "@/ui/planner/arrival-intent";
import { PointActionSheet, type PointSheetAction } from "@/ui/planner/PointActionSheet";
import { PointRow, rowKey, rowName } from "@/ui/planner/PointRow";
import { stopShiftFor, useStopReorder } from "@/ui/planner/useStopReorder";

export { ARRIVAL_INTENTS, ARRIVAL_INTENT_LABELS } from "@/ui/planner/arrival-intent";

export interface StopsPanelProps {
  readonly viewModel: PlannerViewModel;
  /** The point the map selection names, or `null` (04 §31 "select stop"). */
  readonly selectedRef: ItineraryRef | null;
  /** The armed placement, so a row's chip can show that it owns the next tap. */
  readonly armedTool: PlacementTool;
  /** The stop an armed `place-stop` tap will replace, or `null`. */
  readonly armedStopId: StopId | null;
  readonly onSelect: (ref: ItineraryRef) => void;
  readonly onZoomTo: (ref: ItineraryRef) => void;
  readonly onReplacePlace: (ref: ItineraryRef) => void;
  readonly onMoveStop: (stopId: StopId, direction: "up" | "down") => void;
  /**
   * Places a dragged stop in front of a named neighbour — the reducer's own
   * `stop.reorder` vocabulary, so one drag is one command (03 §27).
   * `undefined` appends, which is where the last slot ends up.
   */
  readonly onReorder: (stopId: StopId, beforeStopId: StopId | undefined) => void;
  readonly onRemove: (ref: ItineraryRef) => void;
  readonly onConvert: (ref: ItineraryRef) => void;
  readonly onAddStop: () => void;
  readonly onEditCoordinate: (ref: ItineraryRef, coordinate: Coordinate) => void;
  readonly onSetArrivalIntent: (
    stopId: StopId,
    arrivalIntent: StopArrivalIntent | null,
  ) => void;
}

/** The 24 px glyph shared by the sheet's actions, in the map menu's language. */
const ACTION_PATHS = {
  show: "M12 21s-7-5.7-7-11a7 7 0 1 1 14 0c0 5.3-7 11-7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5",
  replace: "M12 11v6M12 7v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  up: "M12 19V5M5 12l7-7 7 7",
  down: "M12 5v14M5 12l7 7 7-7",
  convert: "M4 8h13l-3-3M20 16H7l3 3",
  remove: "M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13",
} as const;

function sameRef(left: ItineraryRef | null, right: ItineraryRef): boolean {
  if (left === null || left.kind !== right.kind) return false;
  if (left.kind === "stop" && right.kind === "stop") return left.stopId === right.stopId;
  if (left.kind === "shaping" && right.kind === "shaping") {
    return left.shapingId === right.shapingId;
  }
  return true;
}

/** Six decimals is ~11 cm: enough to round-trip a position through the editor. */
function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

interface CoordinateValidation {
  readonly coordinate: Coordinate | null;
  readonly error: string | null;
}

/**
 * Range validation for the numeric editor (03 §4: WGS84). It runs before the
 * command is built, so a mistyped digit becomes an inline message instead of an
 * `invalid` reducer result the rider never sees.
 */
export function validateCoordinateInput(latText: string, lonText: string): CoordinateValidation {
  const lat = Number(latText.trim());
  const lon = Number(lonText.trim());
  if (latText.trim().length === 0 || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { coordinate: null, error: "Latitude must be a number between -90 and 90." };
  }
  if (lonText.trim().length === 0 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { coordinate: null, error: "Longitude must be a number between -180 and 180." };
  }
  return { coordinate: { lat, lon }, error: null };
}

export function StopsPanel({
  viewModel,
  selectedRef,
  armedTool,
  armedStopId,
  onSelect,
  onZoomTo,
  onReplacePlace,
  onMoveStop,
  onReorder,
  onRemove,
  onConvert,
  onAddStop,
  onEditCoordinate,
  onSetArrivalIntent,
}: StopsPanelProps) {
  /** The stops in ride order; the itinerary also holds the two endpoints. */
  const stopIds = useMemo(
    () =>
      viewModel.itinerary.flatMap((row) => (row.ref.kind === "stop" ? [row.ref.stopId] : [])),
    [viewModel.itinerary],
  );
  const stopCount = stopIds.length;

  const selectedRow =
    viewModel.itinerary.find((row) => sameRef(selectedRef, row.ref)) ??
    viewModel.shapingPoints.find((row) => sameRef(selectedRef, row.ref)) ??
    null;

  const selectedKey =
    selectedRow === null
      ? null
      : rowKey(
          selectedRow,
          selectedRow.ref.kind === "shaping"
            ? viewModel.shapingPoints.indexOf(selectedRow)
            : 0,
        );
  const selectedLat = selectedRow?.coordinate.lat ?? null;
  const selectedLon = selectedRow?.coordinate.lon ?? null;

  /**
   * The editor is a *draft keyed to one position of one object*, not a copy of
   * it: the key changes when the rider selects something else **or** when the
   * selected object moves (a map drag, an undo), which retires a stale draft
   * without an effect and without an editor that could silently undo the rider's
   * own last edit.
   */
  const draftKey =
    selectedKey === null || selectedLat === null || selectedLon === null
      ? null
      : `${selectedKey}|${formatCoordinate(selectedLat)}|${formatCoordinate(selectedLon)}`;
  const [draft, setDraft] = useState<{ readonly key: string; readonly lat: string; readonly lon: string } | null>(
    null,
  );
  const [draftError, setDraftError] = useState<{ readonly key: string; readonly message: string } | null>(
    null,
  );
  const liveDraft = draft !== null && draft.key === draftKey ? draft : null;
  const latText =
    liveDraft?.lat ?? (selectedLat === null ? "" : formatCoordinate(selectedLat));
  const lonText =
    liveDraft?.lon ?? (selectedLon === null ? "" : formatCoordinate(selectedLon));
  const editorError =
    draftError !== null && draftError.key === draftKey ? draftError.message : null;

  const submitCoordinate = (): void => {
    if (selectedRow === null || draftKey === null) return;
    const validation = validateCoordinateInput(latText, lonText);
    if (validation.coordinate === null) {
      setDraftError({ key: draftKey, message: validation.error ?? "Invalid coordinate." });
      return;
    }
    setDraftError(null);
    onEditCoordinate(selectedRow.ref, validation.coordinate);
  };

  /** The row whose action sheet is open, or `null` when it is closed. */
  const [menuRef, setMenuRef] = useState<ItineraryRef | null>(null);
  const menuPlace = useMemo((): { readonly row: PointRowVm; readonly index: number } | null => {
    if (menuRef === null) return null;
    const itineraryIndex = viewModel.itinerary.findIndex((row) => sameRef(menuRef, row.ref));
    const itineraryRow = viewModel.itinerary[itineraryIndex];
    if (itineraryRow !== undefined) return { row: itineraryRow, index: itineraryIndex };
    const shapingIndex = viewModel.shapingPoints.findIndex((row) => sameRef(menuRef, row.ref));
    const shapingRow = viewModel.shapingPoints[shapingIndex];
    if (shapingRow !== undefined) return { row: shapingRow, index: shapingIndex };
    return null;
  }, [menuRef, viewModel.itinerary, viewModel.shapingPoints]);

  /**
   * A drag asks the pure ordering rule which neighbour the drop lands before, so
   * the drag and the sheet's Move up/Move down share one vocabulary and one
   * command shape.
   */
  const commitReorder = useCallback(
    (stopId: StopId, fromIndex: number, toIndex: number): void => {
      const target = reorderTargetFor(stopIds, fromIndex, toIndex);
      if (target === null) return;
      onReorder(stopId, target.beforeStopId);
    },
    [onReorder, stopIds],
  );
  const reorder = useStopReorder({ stopCount, onReorder: commitReorder });

  const renderRow = (row: PointRowVm, index: number): ReactElement => {
    const key = rowKey(row, index);
    const stopIndex = row.ref.kind === "stop" ? (row.position ?? 1) - 1 : -1;
    const shift =
      reorder.drag === null || stopIndex < 0 ? null : stopShiftFor(stopIndex, reorder.drag);
    return (
      <PointRow
        key={key}
        row={row}
        index={index}
        selected={sameRef(selectedRef, row.ref)}
        armed={
          armedTool === "place-stop" &&
          row.ref.kind === "stop" &&
          armedStopId === row.ref.stopId
        }
        menuOpen={menuRef !== null && sameRef(menuRef, row.ref)}
        drag={reorder.drag}
        shift={shift}
        onSelect={onSelect}
        onOpenMenu={setMenuRef}
        onGrabPointerDown={reorder.beginDrag}
        onGrabPointerMove={reorder.moveDrag}
        onGrabPointerUp={reorder.endDrag}
        onGrabPointerCancel={reorder.cancelDrag}
      />
    );
  };

  /** The sheet's actions for one row, in the order a rider is likely to want. */
  const sheetActions = (row: PointRowVm, index: number): readonly PointSheetAction[] => {
    const key = rowKey(row, index);
    const ref = row.ref;
    const isStop = ref.kind === "stop";
    const stopIndex = isStop ? (row.position ?? 1) - 1 : -1;
    const actions: PointSheetAction[] = [
      {
        testId: `zoom-${key}`,
        label: "Show on map",
        path: ACTION_PATHS.show,
        onSelect: () => onZoomTo(ref),
      },
      {
        testId: `replace-${key}`,
        label: "Replace place",
        path: ACTION_PATHS.replace,
        armed:
          armedTool === "place-stop" && ref.kind === "stop" && armedStopId === ref.stopId,
        onSelect: () => onReplacePlace(ref),
      },
    ];
    if (isStop && ref.kind === "stop") {
      const stopId = ref.stopId;
      actions.push(
        {
          testId: `move-up-${key}`,
          label: "Move up",
          path: ACTION_PATHS.up,
          disabled: !canMoveStopUp(stopIndex),
          onSelect: () => onMoveStop(stopId, "up"),
        },
        {
          testId: `move-down-${key}`,
          label: "Move down",
          path: ACTION_PATHS.down,
          disabled: !canMoveStopDown(stopIndex, stopCount),
          onSelect: () => onMoveStop(stopId, "down"),
        },
      );
    }
    // The endpoints are not convertible (04 §15 offers convert only between a
    // stop and a shaping point), so the arrow is absent rather than a button the
    // workspace would ignore.
    if (ref.kind === "stop" || ref.kind === "shaping") {
      actions.push({
        testId: `convert-${key}`,
        label: ref.kind === "shaping" ? "Make a stop" : "Make a shaping point",
        path: ACTION_PATHS.convert,
        onSelect: () => onConvert(ref),
      });
    }
    actions.push({
      testId: `remove-${key}`,
      label: "Remove",
      path: ACTION_PATHS.remove,
      danger: true,
      onSelect: () => onRemove(ref),
    });
    return actions;
  };

  return (
    <section className="og-points" aria-label="Ride points" data-testid="stops-panel">
      <div className="og-points__head">
        <h2 className="og-points__title">Ride points</h2>
        <button
          type="button"
          className="og-chip"
          data-testid="add-stop"
          data-armed={armedTool === "place-stop" && armedStopId === null ? "true" : "false"}
          onClick={onAddStop}
        >
          Add stop
        </button>
      </div>

      {/*
        The list renders its rows and nothing else when the ride is empty.

        There used to be a third "Nothing placed yet. Tap the map, or use the
        buttons above." line here, and it was the second telling of the same
        emptiness: the sheet's status line already says "No plan yet." above the
        composer, which already says which point is missing and why the
        commitment button is disabled. One primary empty state, not three
        (04 §3, defect: duplicate emptiness). The panel keeps its heading and its
        `Add stop` control, so the surface still says what it is for.
      */}
      {viewModel.itinerary.length === 0 ? null : (
        <ol className="og-points__list" data-testid="stops-list">
          {viewModel.itinerary.map(renderRow)}
        </ol>
      )}

      {viewModel.shapingPoints.length === 0 ? null : (
        <section className="og-points__section" aria-label="Shaping points">
          <h3 className="og-points__title">Shaping points</h3>
          <ol className="og-points__list" data-testid="shaping-list">
            {viewModel.shapingPoints.map(renderRow)}
          </ol>
        </section>
      )}

      {selectedRow === null ? null : (
        <div className="og-point__inspector" data-testid="point-inspector">
          <h3 className="og-points__title" data-testid="inspector-title">
            {`Edit ${rowName(selectedRow, 0)}`}
          </h3>
          <div className="og-point__fields">
            <label className="og-point__field">
              <span className="og-point__field-label">Latitude</span>
              <input
                className="og-point__input"
                data-testid="point-lat"
                inputMode="decimal"
                value={latText}
                onChange={(event): void => {
                  if (draftKey === null) return;
                  setDraft({ key: draftKey, lat: event.target.value, lon: lonText });
                }}
              />
            </label>
            <label className="og-point__field">
              <span className="og-point__field-label">Longitude</span>
              <input
                className="og-point__input"
                data-testid="point-lon"
                inputMode="decimal"
                value={lonText}
                onChange={(event): void => {
                  if (draftKey === null) return;
                  setDraft({ key: draftKey, lat: latText, lon: event.target.value });
                }}
              />
            </label>
            <button
              type="button"
              className="og-chip"
              data-testid="apply-coordinate"
              onClick={submitCoordinate}
            >
              Apply
            </button>
          </div>

          {editorError === null ? null : (
            <p className="og-point__error" role="alert" data-testid="inspector-error">
              {editorError}
            </p>
          )}

          {selectedRow.ref.kind === "stop" ? (
            <label className="og-point__field">
              <span className="og-point__field-label">Arrival intent</span>
              <select
                className="og-point__input"
                data-testid="arrival-intent"
                value={selectedRow.arrivalIntent ?? ""}
                onChange={(event): void => {
                  if (selectedRow.ref.kind !== "stop") return;
                  const value = event.target.value;
                  onSetArrivalIntent(
                    selectedRow.ref.stopId,
                    value === "" ? null : (value as StopArrivalIntent),
                  );
                }}
              >
                <option value="">None</option>
                {ARRIVAL_INTENTS.map((intent) => (
                  <option key={intent} value={intent}>
                    {ARRIVAL_INTENT_LABELS[intent]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      )}

      {menuPlace === null ? null : (
        <PointActionSheet
          title={rowName(menuPlace.row, menuPlace.index)}
          subtitle={menuPlace.row.label}
          actions={sheetActions(menuPlace.row, menuPlace.index)}
          onClose={() => setMenuRef(null)}
        />
      )}
    </section>
  );
}
