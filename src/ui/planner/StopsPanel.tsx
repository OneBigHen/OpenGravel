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

import { useState } from "react";

import {
  canMoveStopDown,
  canMoveStopUp,
} from "@/application/planner/stop-insertion";
import type {
  ItineraryRef,
  PlannerViewModel,
  PointRowVm,
} from "@/application/planner/planner-view-model";
import type { StopId } from "@/domain/ride/ids";
import type { Coordinate, StopArrivalIntent } from "@/domain/ride/types";
import type { PlacementTool } from "@/ui/stores/planner-ui-store";

/** The rider-facing arrival intents (03 §4), in menu order. */
export const ARRIVAL_INTENT_LABELS: Readonly<Record<StopArrivalIntent, string>> = {
  visit: "Visit",
  fuel: "Fuel",
  food: "Food",
  lodging: "Lodging",
  scenic: "Scenic",
  other: "Other",
};

/** Declaration order for the selector; `""` is the cleared option. */
export const ARRIVAL_INTENTS: readonly StopArrivalIntent[] = [
  "visit",
  "fuel",
  "food",
  "lodging",
  "scenic",
  "other",
];

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
  readonly onRemove: (ref: ItineraryRef) => void;
  readonly onConvert: (ref: ItineraryRef) => void;
  readonly onAddStop: () => void;
  readonly onEditCoordinate: (ref: ItineraryRef, coordinate: Coordinate) => void;
  readonly onSetArrivalIntent: (
    stopId: StopId,
    arrivalIntent: StopArrivalIntent | null,
  ) => void;
}

/** A stable, human-readable key for one row's test hooks and React key. */
function rowKey(row: PointRowVm, index: number): string {
  switch (row.ref.kind) {
    case "start":
      return "start";
    case "finish":
      return "finish";
    case "stop":
      return `stop-${row.position ?? 0}`;
    case "shaping":
      // Anchors have no position in the itinerary, so their list index is the
      // stable handle a test (or a rider) can name them by.
      return `shape-${index + 1}`;
  }
}

/** The row's own name: the ordinal for stops, the role for everything else. */
function rowName(row: PointRowVm, index: number): string {
  switch (row.ref.kind) {
    case "start":
      return "Start";
    case "finish":
      return "Finish";
    case "stop":
      return `Stop ${row.position ?? 0}`;
    case "shaping":
      return `Shaping ${index + 1}`;
  }
}

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
  onRemove,
  onConvert,
  onAddStop,
  onEditCoordinate,
  onSetArrivalIntent,
}: StopsPanelProps) {
  const stopCount = viewModel.itinerary.filter((row) => row.ref.kind === "stop").length;
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

  const renderRow = (row: PointRowVm, index: number) => {
    const key = rowKey(row, index);
    const selected = sameRef(selectedRef, row.ref);
    const isStop = row.ref.kind === "stop";
    // The reorder bounds are the stop's own ordinal among the stops (04 §15): the
    // itinerary index counts the start row too, so it is not the position.
    const stopIndex = (row.position ?? 1) - 1;
    const armed =
      armedTool === "place-stop" &&
      row.ref.kind === "stop" &&
      armedStopId === row.ref.stopId;
    return (
      <li
        key={key}
        className="og-point"
        data-testid={`point-row-${key}`}
        data-selected={selected ? "true" : "false"}
        data-armed={armed ? "true" : "false"}
      >
        <div className="og-point__head">
          <button
            type="button"
            className="og-point__select"
            data-testid={`select-${key}`}
            aria-pressed={selected}
            onClick={(): void => onSelect(row.ref)}
          >
            <span className="og-point__name">{rowName(row, index)}</span>
            {/*
              The row's value is the point's name — the rider's own, or
              `Dropped pin` — with its coordinate as the secondary line (04 §15,
              defect: a raw coordinate is not a place). The coordinate stays
              machine-readable on `data-coordinate`, which is what the browser
              gate reads to prove the app recorded the point the rider placed.
            */}
            <span
              className="og-point__value"
              data-testid={`label-${key}`}
              data-coordinate={row.coordinateLabel}
            >
              <span className="og-point__value-name">{row.label}</span>
              <span className="og-point__coordinate" data-testid={`coordinate-${key}`}>
                {row.coordinateLabel}
              </span>
            </span>
          </button>
          {row.arrivalIntent === null ? null : (
            <span className="og-point__intent" data-testid={`intent-${key}`}>
              {ARRIVAL_INTENT_LABELS[row.arrivalIntent]}
            </span>
          )}
        </div>

        <div className="og-point__actions">
          <button
            type="button"
            className="og-point__action"
            data-testid={`zoom-${key}`}
            onClick={(): void => onZoomTo(row.ref)}
          >
            Zoom to
          </button>
          <button
            type="button"
            className="og-point__action"
            data-testid={`replace-${key}`}
            data-armed={armed ? "true" : "false"}
            onClick={(): void => onReplacePlace(row.ref)}
          >
            Replace place
          </button>
          {isStop ? (
            <>
              <button
                type="button"
                className="og-point__action"
                data-testid={`move-up-${key}`}
                disabled={!canMoveStopUp(stopIndex)}
                onClick={(): void => {
                  if (row.ref.kind === "stop") onMoveStop(row.ref.stopId, "up");
                }}
              >
                Move up
              </button>
              <button
                type="button"
                className="og-point__action"
                data-testid={`move-down-${key}`}
                disabled={!canMoveStopDown(stopIndex, stopCount)}
                onClick={(): void => {
                  if (row.ref.kind === "stop") onMoveStop(row.ref.stopId, "down");
                }}
              >
                Move down
              </button>
            </>
          ) : null}
          {row.ref.kind === "shaping" ? (
            <button
              type="button"
              className="og-point__action"
              data-testid={`convert-${key}`}
              onClick={(): void => onConvert(row.ref)}
            >
              Make a stop
            </button>
          ) : null}
          {isStop ? (
            <button
              type="button"
              className="og-point__action"
              data-testid={`convert-${key}`}
              onClick={(): void => onConvert(row.ref)}
            >
              Make a shaping point
            </button>
          ) : null}
          <button
            type="button"
            className="og-point__action og-point__action--remove"
            data-testid={`remove-${key}`}
            onClick={(): void => onRemove(row.ref)}
          >
            Remove
          </button>
        </div>
      </li>
    );
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
    </section>
  );
}
