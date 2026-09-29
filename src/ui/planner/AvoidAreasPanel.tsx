"use client";

/**
 * The avoid-area list and inspector (04-PLANNER-AND-WORKSPACE-UX §18, §20, §31;
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §21).
 *
 * 04 §31 requires a keyboard/list form for every map-only operation, and 05 §21
 * says the same thing for avoid-area editing ("keyboard/list alternative is
 * mandatory"). This component *is* that form: draw, select, rename, enable,
 * disable, move, edit corners, zoom to and remove are all real `<button>`s and a
 * real text field, so nothing about an avoid area requires the map.
 *
 * It renders and it calls back; it never dispatches (04 §2). The workspace owns
 * the authorities, which is what keeps "one gesture = one command = one undo unit"
 * (03 §27) in one place.
 *
 * Two product rules are visible in the markup:
 *
 * - **A disabled area is authored state, not a deleted one.** It keeps its row, its
 *   name and its corners; the toggle says it is not in force, and the map stops
 *   drawing it (05 §21).
 * - **A conflict is never resolved here.** {@link AvoidAreaConflictPanel} offers the
 *   three explicit actions 04 §18 names and states the consequence in one
 *   non-blocking line — it never moves a point or drops an area on its own.
 */

import { useState } from "react";

import type { AvoidAreaConflict } from "@/application/planner/avoid-area-conflicts";
import { avoidAreaConflictMessage } from "@/application/planner/avoid-area-conflicts";
import type { AvoidAreaId } from "@/domain/ride/ids";
import type { AvoidAreaTool } from "@/ui/stores/planner-ui-store";

/** The longest rider-authored area name; it must fit the undo label and the row. */
export const MAX_AVOID_AREA_NAME_LENGTH = 60;

/** One area, as the list draws it. */
export interface AvoidAreaRowVm {
  readonly id: AvoidAreaId;
  readonly name: string | null;
  readonly enabled: boolean;
  /** Distinct corners, excluding the repeated first vertex. */
  readonly vertexCount: number;
  /** False when the geometry handle did not resolve: the map draws nothing. */
  readonly geometryResolved: boolean;
  /** How many required points this area contains (04 §18). */
  readonly conflictCount: number;
}

export interface AvoidAreaNameValidation {
  /** The name to store: `null` clears it. */
  readonly name: string | null;
  readonly error: string | null;
}

/**
 * The rename field's own validation, run before the command is built.
 *
 * An empty field **clears** the name — that is a deliberate action, not an error,
 * so a rider who removes a name gets an unnamed area rather than a refusal. A
 * name longer than the cap is refused with an inline message, because the history
 * label and the list row both render it verbatim.
 */
export function validateAvoidAreaNameInput(value: string): AvoidAreaNameValidation {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { name: null, error: null };
  if (trimmed.length > MAX_AVOID_AREA_NAME_LENGTH) {
    return {
      name: null,
      error: `A name must be ${MAX_AVOID_AREA_NAME_LENGTH} characters or fewer.`,
    };
  }
  return { name: trimmed, error: null };
}

/** The row's own name, so an unnamed area still reads as a distinct object. */
export function avoidAreaRowName(row: AvoidAreaRowVm, index: number): string {
  return row.name ?? `Avoid area ${index + 1}`;
}

/** How a conflict names the required point it found inside an area. */
export function conflictEndpointLabel(conflict: AvoidAreaConflict): string {
  switch (conflict.endpoint.kind) {
    case "start":
      return "your start";
    case "finish":
      return "your destination";
    case "stop":
      return "a stop";
  }
}

export interface AvoidAreaConflictPanelProps {
  readonly conflicts: readonly AvoidAreaConflict[];
  /** The authoring name of each area, so the panel can name it. */
  readonly areaNames: ReadonlyMap<AvoidAreaId, string>;
  /** Arm the placement that puts the endpoint somewhere else (04 §18). */
  readonly onMoveEndpoint: (conflict: AvoidAreaConflict) => void;
  /** Arm the corner editor for the area, so the rider can widen it out. */
  readonly onEditArea: (areaId: AvoidAreaId) => void;
  readonly onRemoveArea: (areaId: AvoidAreaId) => void;
}

/**
 * The endpoint-in-area conflict surface (04 §18).
 *
 * The notice is non-blocking and states the consequence, not a scolding: the
 * polygon and the point are both still authored, and the plan's own
 * `constraint-conflict` error is what appears if the rider plans anyway. There is
 * deliberately no "fix it for me" action — a silently moved endpoint or a
 * silently dropped area is exactly what 04 §18's "no silent connector" forbids.
 */
export function AvoidAreaConflictPanel({
  conflicts,
  areaNames,
  onMoveEndpoint,
  onEditArea,
  onRemoveArea,
}: AvoidAreaConflictPanelProps) {
  if (conflicts.length === 0) return null;
  return (
    <section
      className="og-avoid-conflict"
      data-testid="avoid-conflict-panel"
      aria-label="Avoid area conflict"
    >
      <p className="og-avoid-conflict__notice" role="status">
        {avoidAreaConflictMessage()}
      </p>
      <ul className="og-avoid-conflict__list">
        {conflicts.map((conflict, index) => (
          <li
            className="og-avoid-conflict__item"
            key={`${conflict.areaId}:${conflict.endpoint.id}`}
            data-testid={`avoid-conflict-${index}`}
          >
            <p className="og-avoid-conflict__what">
              {`${areaNames.get(conflict.areaId) ?? "An avoid area"} contains ${conflictEndpointLabel(conflict)}.`}
            </p>
            <div className="og-avoid-conflict__actions">
              <button
                type="button"
                className="og-chip"
                data-testid={`conflict-move-${index}`}
                onClick={(): void => onMoveEndpoint(conflict)}
              >
                Move endpoint
              </button>
              <button
                type="button"
                className="og-chip"
                data-testid={`conflict-edit-${index}`}
                onClick={(): void => onEditArea(conflict.areaId)}
              >
                Edit area
              </button>
              <button
                type="button"
                className="og-secondary"
                data-testid={`conflict-remove-${index}`}
                onClick={(): void => onRemoveArea(conflict.areaId)}
              >
                Remove area
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface AvoidAreasPanelProps {
  readonly rows: readonly AvoidAreaRowVm[];
  /** The selected area, or `null`. Selection is presentation state (05 §5). */
  readonly selectedAreaId: AvoidAreaId | null;
  readonly tool: AvoidAreaTool;
  /** How many corners the polygon draft holds, so the panel can say what it has. */
  readonly draftVertexCount: number;
  /** The ring validator's refusal, or `null`. */
  readonly error: string | null;
  readonly onSelect: (areaId: AvoidAreaId) => void;
  readonly onZoomTo: (areaId: AvoidAreaId) => void;
  readonly onStartTool: (tool: AvoidAreaTool, targetId?: AvoidAreaId | null) => void;
  readonly onCloseDraft: () => void;
  readonly onRemoveLastVertex: () => void;
  readonly onCancelDraft: () => void;
  readonly onRename: (areaId: AvoidAreaId, name: string | null) => void;
  readonly onSetEnabled: (areaId: AvoidAreaId, enabled: boolean) => void;
  readonly onRemove: (areaId: AvoidAreaId) => void;
}

export function AvoidAreasPanel({
  rows,
  selectedAreaId,
  tool,
  draftVertexCount,
  error,
  onSelect,
  onZoomTo,
  onStartTool,
  onCloseDraft,
  onRemoveLastVertex,
  onCancelDraft,
  onRename,
  onSetEnabled,
  onRemove,
}: AvoidAreasPanelProps) {
  /**
   * The rename drafts, keyed by area, with the value each one started from.
   *
   * Keyed by area rather than stored per row component so a rename that fails
   * validation keeps the rider's text while an undo or a reload retires it: the
   * key carries the name the field was opened on, and a name that moved under the
   * field means the draft is no longer about what the rider is looking at.
   */
  const [drafts, setDrafts] = useState<
    Readonly<Record<string, { readonly from: string; readonly value: string; readonly error: string | null }>>
  >({});

  const draftFor = (row: AvoidAreaRowVm): string => {
    // A draft is *about the name the field was opened on*: an undo (or a reload)
    // that changes the name under the field retires it, so the rider can never
    // overwrite an edit they did not make with a stale field value.
    const draft = drafts[row.id];
    if (draft === undefined || draft.from !== (row.name ?? "")) return row.name ?? "";
    return draft.value;
  };

  const submitRename = (row: AvoidAreaRowVm): void => {
    const validation = validateAvoidAreaNameInput(draftFor(row));
    if (validation.error !== null) {
      setDrafts((current) => ({
        ...current,
        [row.id]: { from: row.name ?? "", value: draftFor(row), error: validation.error },
      }));
      return;
    }
    setDrafts((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    onRename(row.id, validation.name);
  };

  const drawing = tool === "rectangle" || tool === "polygon";

  return (
    <section className="og-avoid" aria-label="Avoid areas" data-testid="avoid-areas-panel">
      <div className="og-avoid__head">
        <h2 className="og-points__title">Avoid areas</h2>
        <div className="og-avoid__tools">
          <button
            type="button"
            className="og-chip"
            data-testid="draw-rectangle"
            data-armed={tool === "rectangle" ? "true" : "false"}
            aria-pressed={tool === "rectangle"}
            onClick={(): void => onStartTool("rectangle")}
          >
            Draw rectangle
          </button>
          <button
            type="button"
            className="og-chip"
            data-testid="draw-polygon"
            data-armed={tool === "polygon" ? "true" : "false"}
            aria-pressed={tool === "polygon"}
            onClick={(): void => onStartTool("polygon")}
          >
            Draw polygon
          </button>
        </div>
      </div>

      {/*
        The armed tool says what the next gesture does, and the polygon draft says
        what it has so far — the keyboard-complete half of a gesture whose only
        other feedback is the shape on the map (04 §31).
      */}
      {tool === "rectangle" ? (
        <p className="og-avoid__hint" role="note" data-testid="avoid-rectangle-hint">
          Drag on the map to draw the area.
        </p>
      ) : null}

      {tool === "polygon" ? (
        <div className="og-avoid__draft" data-testid="avoid-polygon-draft">
          <p className="og-avoid__hint" role="note">
            {`Tap the map to add corners — ${draftVertexCount} placed. Double-click or press Enter to close.`}
          </p>
          <div className="og-avoid__tools">
            <button
              type="button"
              className="og-chip"
              data-testid="close-avoid-polygon"
              disabled={draftVertexCount < 3}
              onClick={onCloseDraft}
            >
              Close area
            </button>
            <button
              type="button"
              className="og-secondary"
              data-testid="remove-avoid-vertex"
              disabled={draftVertexCount === 0}
              onClick={onRemoveLastVertex}
            >
              Remove last corner
            </button>
            <button
              type="button"
              className="og-secondary"
              data-testid="cancel-avoid-polygon"
              onClick={onCancelDraft}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error === null ? null : (
        <p className="og-point__error" role="alert" data-testid="avoid-area-error">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="og-points__empty" data-testid="avoid-areas-empty">
          No avoid areas yet. Draw one on the map, or with the buttons above.
        </p>
      ) : (
        <ol className="og-avoid__list" data-testid="avoid-areas-list">
          {rows.map((row, index) => {
            const key = `avoid-area-${index + 1}`;
            const selected = row.id === selectedAreaId;
            const editingCorners = selected && tool === "vertices";
            const moving = selected && tool === "move";
            const draft = drafts[row.id];
            return (
              <li
                key={row.id}
                className="og-point og-avoid__row"
                data-testid={`avoid-area-row-${index}`}
                data-selected={selected ? "true" : "false"}
                data-enabled={row.enabled ? "true" : "false"}
              >
                <div className="og-point__head">
                  <button
                    type="button"
                    className="og-point__select"
                    data-testid={`select-${key}`}
                    aria-pressed={selected}
                    onClick={(): void => onSelect(row.id)}
                  >
                    <span className="og-point__name">{avoidAreaRowName(row, index)}</span>
                    <span className="og-point__value" data-testid={`corners-${key}`}>
                      {row.geometryResolved
                        ? `${row.vertexCount} corners`
                        : "Geometry unavailable"}
                    </span>
                  </button>
                  {row.conflictCount === 0 ? null : (
                    <span className="og-avoid__badge" data-testid={`conflict-badge-${key}`}>
                      {`${row.conflictCount} inside`}
                    </span>
                  )}
                </div>

                <div className="og-point__actions">
                  <button
                    type="button"
                    className="og-point__action"
                    data-testid={`toggle-${key}`}
                    aria-pressed={row.enabled}
                    onClick={(): void => onSetEnabled(row.id, !row.enabled)}
                  >
                    {row.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="og-point__action"
                    data-testid={`move-${key}`}
                    data-armed={moving ? "true" : "false"}
                    aria-pressed={moving}
                    onClick={(): void => onStartTool("move", row.id)}
                  >
                    Move area
                  </button>
                  <button
                    type="button"
                    className="og-point__action"
                    data-testid={`vertices-${key}`}
                    data-armed={editingCorners ? "true" : "false"}
                    aria-pressed={editingCorners}
                    onClick={(): void => onStartTool("vertices", row.id)}
                  >
                    Edit corners
                  </button>
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

                {/*
                  Rename is inline (04 §18) and keyed to the name the field was
                  opened on: an undo that renames the area under the field retires
                  the draft instead of letting the rider overwrite an edit they
                  did not make.
                */}
                <div className="og-avoid__rename">
                  <label className="og-point__field">
                    <span className="og-point__field-label">Name</span>
                    <input
                      className="og-point__input"
                      data-testid={`rename-${key}`}
                      type="text"
                      value={draftFor(row)}
                      onChange={(event): void => {
                        setDrafts((current) => ({
                          ...current,
                          [row.id]: {
                            from: row.name ?? "",
                            value: event.target.value,
                            error: null,
                          },
                        }));
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="og-chip"
                    data-testid={`apply-rename-${key}`}
                    onClick={(): void => submitRename(row)}
                  >
                    Apply
                  </button>
                </div>
                {draft?.error == null ? null : (
                  <p
                    className="og-point__error"
                    role="alert"
                    data-testid={`rename-error-${key}`}
                  >
                    {draft.error}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {drawing ? null : (
        <p className="og-avoid__footnote" data-testid="avoid-area-footnote">
          Move area and Edit corners arm the map; the same actions work without it from
          this list.
        </p>
      )}
    </section>
  );
}
