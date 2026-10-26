"use client";

/**
 * One row of the ride's object list (04-PLANNER-AND-WORKSPACE-UX §15).
 *
 * The row is the ride briefing: the pin the map draws, the place, and the leg
 * that ends there ("34 mi · ~48 min from previous"). Everything the row can do
 * is a real button — select, reorder by pointing at the `…` control, and the
 * 44 px `…` itself, which opens the same actions the map's long-press menu
 * offers (04 §31: a list-only rider never needs the map).
 *
 * Two states are deliberate:
 *
 * - **An unknown leg is words.** A leg that was not measured reads "distance not
 *   known"; a leg the drawn route does not cover reads "Not on the selected
 *   route". Neither is ever a `0`.
 * - **The grab handle is touch-only.** A pointer device reorders from the `…`
 *   sheet; the 44 px handle appears only where a thumb is the input, so the row
 *   does not spend a slot on a target a mouse user cannot use.
 */

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import {
  legLabel,
  placeFieldLines,
  type ItineraryRef,
  type PointRowVm,
} from "@/application/planner/planner-view-model";
import type { StopId } from "@/domain/ride/ids";
import type { StopArrivalIntent } from "@/domain/ride/types";
import { ARRIVAL_INTENT_LABELS } from "@/ui/planner/arrival-intent";
import type { StopDragState } from "@/ui/planner/useStopReorder";

/** The glyph for each arrival intent, in the map menu's own 24 px language. */
const INTENT_PATHS: Readonly<Record<StopArrivalIntent, string>> = {
  visit: "M12 21s-7-5.7-7-11a7 7 0 1 1 14 0c0 5.3-7 11-7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5",
  fuel: "M5 21V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15M4 21h11M6 10h7M14 8h2.5l3 3v7a1.6 1.6 0 0 1-3.2 0v-4h-2",
  food: "M7 3v6a2 2 0 1 0 4 0V3M9 9v12M16 3v18M16 3c2.5 0 3 2.6 3 5s-.5 4-3 4",
  lodging: "M4 11l8-7 8 7v9H4zM10 20v-5h4v5",
  scenic: "M3 20l5.5-10 3.5 6 2.5-4L21 20H3zM17 5a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0",
  other: "M6 12h.01M12 12h.01M18 12h.01",
};

/** A stable, human-readable key for one row's test hooks and React key. */
export function rowKey(row: PointRowVm, index: number): string {
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
export function rowName(row: PointRowVm, index: number): string {
  switch (row.ref.kind) {
    case "start":
      return "Start";
    case "finish":
      return "Finish";
    case "stop":
      return `Stop ${row.position ?? 0}`;
    case "shaping":
      return `Point ${index + 1}`;
  }
}

/**
 * The pin the map draws, at list scale: a numbered white stop, a green start, a
 * checkered finish, a Golden Hour anchor. It states the same object the map
 * does, so a rider can match a row to a pin by shape rather than by reading.
 */
function PointPin({ row }: { readonly row: PointRowVm }) {
  const number = row.ref.kind === "stop" ? row.position ?? "" : "";
  return (
    <span
      className={`og-point__pin og-point__pin--${row.kind}`}
      aria-hidden="true"
      data-pin={row.kind}
    >
      {number}
    </span>
  );
}

function ArrivalIntentGlyph({
  intent,
  testId,
}: {
  readonly intent: StopArrivalIntent;
  readonly testId: string;
}) {
  const label = ARRIVAL_INTENT_LABELS[intent];
  return (
    <span
      className="og-point__intent"
      data-testid={testId}
      data-intent={intent}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={INTENT_PATHS[intent]} />
      </svg>
    </span>
  );
}

export interface PointRowProps {
  readonly row: PointRowVm;
  readonly index: number;
  readonly selected: boolean;
  /** True when an armed placement will replace this row's place. */
  readonly armed: boolean;
  /** True when this row's action sheet is open, for `aria-expanded`. */
  readonly menuOpen: boolean;
  /** The drag in flight, or `null` when nothing is being reordered. */
  readonly drag: StopDragState | null;
  /** Which way this row makes room for a dragged stop, or `null`. */
  readonly shift: "up" | "down" | null;
  readonly onSelect: (ref: ItineraryRef) => void;
  readonly onOpenMenu: (ref: ItineraryRef) => void;
  readonly onGrabPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    stopId: StopId,
    stopIndex: number,
  ) => void;
  readonly onGrabPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onGrabPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onGrabPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function PointRow({
  row,
  index,
  selected,
  armed,
  menuOpen,
  drag,
  shift,
  onSelect,
  onOpenMenu,
  onGrabPointerDown,
  onGrabPointerMove,
  onGrabPointerUp,
  onGrabPointerCancel,
}: PointRowProps) {
  const key = rowKey(row, index);
  const name = rowName(row, index);
  const leg = legLabel(row.leg);
  // A named place reads as its name; only a dropped pin carries the coordinate
  // as secondary text (the raw number is never the point's name).
  const lines = placeFieldLines(row.label, row.coordinateLabel);
  const stopRef = row.ref.kind === "stop" ? row.ref : null;
  const dragging = drag !== null && drag.active && stopRef !== null && drag.stopId === stopRef.stopId;
  const stopIndex = stopRef === null ? -1 : (row.position ?? 1) - 1;
  // The dragged row follows the pointer; every other row's displacement is one
  // row height, which `data-shift` expresses in CSS. Only the pointer distance
  // is a value, so it is the only thing carried inline.
  const dragStyle =
    dragging && drag !== null
      ? ({ "--og-point-drag-y": `${drag.dy}px` } as CSSProperties)
      : undefined;

  return (
    <li
      className="og-point og-point--itinerary"
      data-testid={`point-row-${key}`}
      data-selected={selected ? "true" : "false"}
      data-armed={armed ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-shift={shift ?? "none"}
      style={dragStyle}
    >
      {stopRef === null ? null : (
        <button
          type="button"
          className="og-point__grab"
          data-testid={`grab-${key}`}
          aria-label={`Reorder ${name}`}
          onPointerDown={(event): void =>
            onGrabPointerDown(event, stopRef.stopId, stopIndex)
          }
          onPointerMove={onGrabPointerMove}
          onPointerUp={onGrabPointerUp}
          onPointerCancel={onGrabPointerCancel}
        >
          <span className="og-point__grab-dots" aria-hidden="true" />
        </button>
      )}

      <PointPin row={row} />

      <button
        type="button"
        className="og-point__main"
        data-testid={`select-${key}`}
        aria-pressed={selected}
        onClick={(): void => onSelect(row.ref)}
      >
        <span className="sr-only">{`${name}: `}</span>
        {/*
          The row's value is the point's name — the rider's own, or
          `Dropped pin` — with the leg as its secondary line (04 §15, defect: a
          raw coordinate is not a place). Only a dropped pin also shows its
          coordinate, because that is the only case where the name alone would
          not identify the point. The coordinate stays machine-readable on
          `data-coordinate`, which is what the browser gate reads to prove the
          app recorded the point the rider placed.
        */}
        <span
          className="og-point__title"
          data-testid={`label-${key}`}
          data-coordinate={row.coordinateLabel}
        >
          {lines.label}
        </span>
        {leg === null ? null : (
          <span
            className="og-point__leg"
            data-testid={`leg-${key}`}
            data-leg={row.leg?.state ?? "none"}
          >
            {leg}
          </span>
        )}
        {lines.coordinate === null ? null : (
          <span className="og-point__coordinate" data-testid={`coordinate-${key}`}>
            {lines.coordinate}
          </span>
        )}
      </button>

      {row.arrivalIntent === null ? null : (
        <ArrivalIntentGlyph intent={row.arrivalIntent} testId={`intent-${key}`} />
      )}

      <button
        type="button"
        className="og-point__more"
        data-testid={`more-${key}`}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-label={`Actions for ${name}`}
        onClick={(): void => onOpenMenu(row.ref)}
      >
        <span aria-hidden="true">…</span>
      </button>
    </li>
  );
}
