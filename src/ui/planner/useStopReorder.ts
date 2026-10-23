"use client";

/**
 * Drag-to-reorder for the itinerary's stops (04-PLANNER-AND-WORKSPACE-UX §15).
 *
 * The grab handle is the map-free reorder the list owes a rider who never looks
 * at the map. A press alone is not a drag — the pointer must travel
 * {@link STOP_REORDER_THRESHOLD_PX} before the rows preview a move — and the drop
 * is exactly **one** callback, whatever distance was travelled: the list asks the
 * workspace for one `stop.reorder`, which is one undo unit (03 §27).
 *
 * The hook owns only the gesture and the preview. It never knows a `StopId`'s
 * neighbours, so the before-which-stop answer stays in the pure ordering rule
 * (`application/planner/stop-insertion`), shared with the list's buttons.
 */

import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { StopId } from "@/domain/ride/ids";

/** A pointer that travels less than this is a press, not a reorder. */
export const STOP_REORDER_THRESHOLD_PX = 10;

/**
 * Row pitch used when no row has been laid out (a hidden list, jsdom): one row's
 * minimum height plus the list's own gap.
 */
export const STOP_REORDER_FALLBACK_PITCH_PX = 64;

/** One drag in flight, as the list renders it. */
export interface StopDragState {
  readonly stopId: StopId;
  readonly fromIndex: number;
  readonly targetIndex: number;
  /** Pointer travel since the press, in CSS pixels. */
  readonly dy: number;
  /** One row's height, measured at the press. */
  readonly pitch: number;
  /** False until the pointer has travelled the threshold. */
  readonly active: boolean;
}

/**
 * Which way the row at `stopIndex` makes room while a drag is in flight, or
 * `null` when it stays put. The dragged row itself never shifts: it follows the
 * pointer.
 */
export function stopShiftFor(
  stopIndex: number,
  drag: StopDragState,
): "up" | "down" | null {
  if (!drag.active || stopIndex === drag.fromIndex) return null;
  if (drag.targetIndex > drag.fromIndex) {
    return stopIndex > drag.fromIndex && stopIndex <= drag.targetIndex ? "up" : null;
  }
  if (drag.targetIndex < drag.fromIndex) {
    return stopIndex >= drag.targetIndex && stopIndex < drag.fromIndex ? "down" : null;
  }
  return null;
}

export interface StopReorderGesture {
  readonly drag: StopDragState | null;
  /** Starts a press on the row's grab handle. */
  readonly beginDrag: (
    event: ReactPointerEvent<HTMLElement>,
    stopId: StopId,
    stopIndex: number,
  ) => void;
  readonly moveDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Ends the press: commits the move, or nothing when the order did not change. */
  readonly endDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly cancelDrag: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface DragSession {
  readonly pointerId: number;
  readonly stopId: StopId;
  readonly fromIndex: number;
  readonly startY: number;
  readonly pitch: number;
  active: boolean;
  targetIndex: number;
}

export function useStopReorder(input: {
  readonly stopCount: number;
  readonly onReorder: (stopId: StopId, fromIndex: number, toIndex: number) => void;
}): StopReorderGesture {
  const sessionRef = useRef<DragSession | null>(null);
  const [drag, setDrag] = useState<StopDragState | null>(null);
  const { stopCount, onReorder } = input;

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, stopId: StopId, stopIndex: number): void => {
      if (event.button !== 0) return;
      if (stopCount < 2) return;
      const row = event.currentTarget.closest("li");
      const measured = row?.getBoundingClientRect().height ?? 0;
      // A hidden list reports zero; a mocked viewport in a test can report the
      // whole page. Only a plausible row height is trusted.
      const pitch =
        measured >= 40 && measured <= 240 ? measured : STOP_REORDER_FALLBACK_PITCH_PX;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      sessionRef.current = {
        pointerId: event.pointerId,
        stopId,
        fromIndex: stopIndex,
        startY: event.clientY,
        pitch,
        active: false,
        targetIndex: stopIndex,
      };
      setDrag({
        stopId,
        fromIndex: stopIndex,
        targetIndex: stopIndex,
        dy: 0,
        pitch,
        active: false,
      });
    },
    [stopCount],
  );

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    const dy = event.clientY - session.startY;
    if (!session.active) {
      if (Math.abs(dy) < STOP_REORDER_THRESHOLD_PX) return;
      session.active = true;
    }
    const steps = Math.round(dy / session.pitch);
    const targetIndex = Math.max(
      0,
      Math.min(stopCount - 1, session.fromIndex + steps),
    );
    session.targetIndex = targetIndex;
    // Touch scrolling is already off on the grab handle; preventing the default
    // here also keeps a mouse drag from selecting text.
    if (event.cancelable) event.preventDefault();
    setDrag({
      stopId: session.stopId,
      fromIndex: session.fromIndex,
      targetIndex,
      dy,
      pitch: session.pitch,
      active: true,
    });
  }, [stopCount]);

  const finish = useCallback((event: ReactPointerEvent<HTMLElement>, commit: boolean): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    sessionRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDrag(null);
    if (!commit || !session.active) return;
    if (session.targetIndex === session.fromIndex) return;
    onReorder(session.stopId, session.fromIndex, session.targetIndex);
  }, [onReorder]);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => finish(event, true),
    [finish],
  );
  const cancelDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => finish(event, false),
    [finish],
  );

  return { drag, beginDrag, moveDrag, endDrag, cancelDrag };
}
