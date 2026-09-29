"use client";

/**
 * The road-span list and inspector (04-PLANNER-AND-WORKSPACE-UX §17, §20, §31;
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §20).
 *
 * 04 §31 requires a keyboard/list form for every map-only operation, and this
 * component *is* that form: arming the selection, choosing the segment, committing
 * each of the three modes, flipping Keep↔Prefer, zooming to a span and removing it
 * are all real `<button>`s. The map click is the fast path, never the only path —
 * `Select whole route` authors a span with no pointer at all.
 *
 * It renders and it calls back; it never dispatches (04 §2). The workspace owns
 * the authorities, which is what keeps "one gesture = one command = one undo unit"
 * (03 §27) in one place.
 *
 * Two product rules are visible in the markup:
 *
 * - **The verdict is measured, never assumed.** Each row's status comes from
 *   `evaluateRoadSpans` against the committed route; a required span that is not
 *   satisfied says so in warning styling with the 04 §17 copy, and a span that
 *   could not be checked says "Unavailable" rather than pretending.
 * - **A matching tolerance is never shown** (04 §17). The rider sees the mode, the
 *   direction and the verdict — never a meter figure for how close the match was.
 */

import type { RoadSpanStatusRow } from "@/application/planner/road-span-status";
import {
  ROAD_SPAN_CONFLICT_COPY,
  ROAD_SPAN_STATUS_LABELS,
  ROAD_SPAN_UNAVAILABLE_COPY,
  roadSpanStatusIsWarning,
} from "@/application/planner/road-span-status";
import {
  ROAD_SPAN_MODE_LABELS,
} from "@/application/planner/road-span-authoring";
import type { RoadSpanDraft } from "@/application/planner/road-span-draft";
import type { RoadSpanMode, SpanDirection } from "@/domain/road/spans";
import type { RoadSpanId } from "@/domain/ride/ids";

/** The three action-bar actions (04 §17), in the order they are offered. */
export const ROAD_SPAN_COMMIT_ACTIONS: readonly {
  readonly mode: RoadSpanMode;
  readonly label: string;
  readonly testId: string;
}[] = [
  { mode: "must", label: "Keep this road", testId: "commit-keep" },
  { mode: "prefer", label: "Prefer this road", testId: "commit-prefer" },
  { mode: "avoid", label: "Avoid this road", testId: "commit-avoid" },
];

/** A direction as the inspector says it; never a raw machine token. */
export function directionLabel(direction: SpanDirection): string {
  switch (direction) {
    case "forward":
      return "Forward";
    case "reverse":
      return "Reverse";
    case "either":
      return "Either direction";
  }
}

/** The row's own name, so an unnamed span still reads as a distinct object. */
export function roadSpanRowName(index: number): string {
  return `Road span ${index + 1}`;
}

/** The one-line warning a failing row carries, or `null` when it is fine. */
export function roadSpanWarningCopy(row: RoadSpanStatusRow): string | null {
  if (row.mode === "avoid" && row.status === "conflict") {
    return "Route enters this road";
  }
  if (row.status === "conflict") return ROAD_SPAN_CONFLICT_COPY;
  if (row.status === "unavailable") return ROAD_SPAN_UNAVAILABLE_COPY;
  return null;
}

export interface RoadSpansPanelProps {
  readonly rows: readonly RoadSpanStatusRow[];
  /** The selected span, or `null`. Selection is presentation state (05 §5). */
  readonly selectedSpanId: RoadSpanId | null;
  /** True while the `road-span-select` tool owns the pointer (05 §4, §20). */
  readonly selecting: boolean;
  /** The in-flight selection, or `null`. */
  readonly draft: RoadSpanDraft | null;
  /** How many route vertices the draft covers; `0` when it is stale or empty. */
  readonly draftVertexCount: number;
  /** The direction the draft would declare, or `null` when it is unusable. */
  readonly draftDirection: SpanDirection | null;
  readonly error: string | null;
  readonly onSelect: (spanId: RoadSpanId) => void;
  readonly onZoomTo: (spanId: RoadSpanId) => void;
  readonly onStartSelecting: () => void;
  /** Select the whole returned route: the keyboard path to a span. */
  readonly onSelectWholeRoute: () => void;
  readonly onCancelDraft: () => void;
  readonly onCommit: (mode: RoadSpanMode) => void;
  readonly onFlipMode: (spanId: RoadSpanId) => void;
  readonly onRemove: (spanId: RoadSpanId) => void;
}

export function RoadSpansPanel({
  rows,
  selectedSpanId,
  selecting,
  draft,
  draftVertexCount,
  draftDirection,
  error,
  onSelect,
  onZoomTo,
  onStartSelecting,
  onSelectWholeRoute,
  onCancelDraft,
  onCommit,
  onFlipMode,
  onRemove,
}: RoadSpansPanelProps) {
  const committable = draft !== null && draftVertexCount >= 2;

  return (
    <section className="og-spans" aria-label="Road spans" data-testid="road-spans-panel">
      <div className="og-spans__head">
        <h2 className="og-points__title">Roads to keep, prefer or avoid</h2>
        <div className="og-spans__tools">
          <button
            type="button"
            className="og-chip"
            data-testid="select-road-span"
            data-armed={selecting ? "true" : "false"}
            aria-pressed={selecting}
            onClick={onStartSelecting}
          >
            Select road span
          </button>
          <button
            type="button"
            className="og-chip"
            data-testid="select-whole-route"
            onClick={onSelectWholeRoute}
          >
            Select whole route
          </button>
        </div>
      </div>

      {/*
        The armed tool says what the next gesture does, and the draft says what it
        has so far — the keyboard-complete half of a selection whose only other
        feedback is on the map (04 §31).
      */}
      {selecting ? (
        <div className="og-spans__draft" data-testid="span-draft">
          <p className="og-spans__hint" role="note">
            {draft === null
              ? "Tap the route to start a road span."
              : `Span selected — ${draftVertexCount} points${draftDirection === null ? "" : `, ${directionLabel(draftDirection)}`}.`}
          </p>
          <div className="og-spans__tools">
            {ROAD_SPAN_COMMIT_ACTIONS.map((action) => (
              <button
                key={action.mode}
                type="button"
                className="og-chip"
                data-testid={action.testId}
                disabled={!committable}
                onClick={(): void => onCommit(action.mode)}
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              className="og-secondary"
              data-testid="cancel-span-draft"
              onClick={onCancelDraft}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error === null ? null : (
        <p className="og-point__error" role="alert" data-testid="span-error">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="og-points__empty" data-testid="road-spans-empty">
          No road spans yet. Select a road on the map, or select the whole route.
        </p>
      ) : (
        <ol className="og-spans__list" data-testid="road-spans-list">
          {rows.map((row, index) => {
            const key = `road-span-${index + 1}`;
            const selected = row.id === selectedSpanId;
            const warning = roadSpanStatusIsWarning(row);
            const warningCopy = warning ? roadSpanWarningCopy(row) : null;
            return (
              <li
                key={row.id}
                className="og-point og-spans__row"
                data-testid={`road-span-row-${index}`}
                data-selected={selected ? "true" : "false"}
                data-warning={warning ? "true" : "false"}
                data-status={row.status}
              >
                <div className="og-point__head">
                  <button
                    type="button"
                    className="og-point__select"
                    data-testid={`select-${key}`}
                    aria-pressed={selected}
                    onClick={(): void => onSelect(row.id)}
                  >
                    <span className="og-point__name">{roadSpanRowName(index)}</span>
                    <span className="og-point__value" data-testid={`span-mode-${index}`}>
                      {ROAD_SPAN_MODE_LABELS[row.mode]}
                    </span>
                  </button>
                  <span
                    className="og-spans__status"
                    data-testid={`span-status-${index}`}
                    data-status={row.status}
                  >
                    {ROAD_SPAN_STATUS_LABELS[row.status]}
                  </span>
                </div>

                <p className="og-spans__direction" data-testid={`span-direction-${index}`}>
                  {directionLabel(row.direction)}
                  {row.geometryResolved ? "" : " · Geometry unavailable"}
                </p>

                {warningCopy === null ? null : (
                  <p
                    className="og-point__error og-spans__warning"
                    role="status"
                    data-testid={`span-warning-${index}`}
                  >
                    {warningCopy}
                  </p>
                )}

                <div className="og-point__actions">
                  {row.mode === "avoid" ? null : (
                    <button
                      type="button"
                      className="og-point__action"
                      data-testid={`flip-${key}`}
                      onClick={(): void => onFlipMode(row.id)}
                    >
                      {row.mode === "must" ? "Prefer instead" : "Keep instead"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="og-point__action"
                    data-testid={`zoom-${key}`}
                    onClick={(): void => onZoomTo(row.id)}
                  >
                    Zoom to
                  </button>
                  <button
                    type="button"
                    className="og-point__action og-point__action--remove"
                    data-testid={`remove-${key}`}
                    onClick={(): void => onRemove(row.id)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {selecting ? null : (
        <p className="og-spans__footnote" data-testid="road-spans-footnote">
          Select road span arms the map; the same actions work without it from this
          list.
        </p>
      )}
    </section>
  );
}
