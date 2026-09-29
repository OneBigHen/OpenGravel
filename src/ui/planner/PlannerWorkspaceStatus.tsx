"use client";

/**
 * The status and recovery area above the planner sheet's scrolling body.
 *
 * All values come from the existing stores and lifecycle model; the surface only
 * presents their current state and forwards the actions the workspace owns.
 */

import type { MapLoadStatus, MapRenderError } from "@/application/map/map-host";
import type { AvoidAreaConflict } from "@/application/planner/avoid-area-conflicts";
import type {
  UpdateFailure,
  UpdateRecoveryActions,
} from "@/application/planner/update-recovery";
import type { AvoidAreaId } from "@/domain/ride/ids";
import type { RideDocumentState } from "@/ui/stores/ride-document-store";
import { AvoidAreaConflictPanel } from "@/ui/planner/AvoidAreasPanel";
import { RouteDeltaChip } from "@/ui/planner/RouteDeltaChip";
import { RIDE_EXPORT_AVAILABLE, SaveIndicator } from "@/ui/planner/SaveIndicator";
import { UpdateFailureBanner } from "@/ui/planner/UpdateFailureBanner";
import type { PlannerUpdateHighlight } from "@/ui/planner/usePlannerAnswerLifecycle";
import { MAP_ERROR_NOTICE } from "@/ui/map/PlannerMap";

export interface PlannerWorkspaceStatusProps {
  readonly statusMessage: string;
  readonly saveStatus: RideDocumentState["saveStatus"];
  readonly updateHighlight: PlannerUpdateHighlight | null;
  readonly updateRecovery: UpdateFailure | null;
  readonly recoveryActions: UpdateRecoveryActions | null;
  readonly onRetryFailedUpdate: () => void;
  readonly onEditFailedUpdate: () => void;
  readonly onDiscardFailedUpdate: () => void;
  readonly onRetrySave: () => void;
  readonly conflict: RideDocumentState["conflict"];
  readonly onReloadLatest: RideDocumentState["reloadLatest"];
  readonly onKeepMyCopy: RideDocumentState["keepMyCopy"];
  readonly conflicts: readonly AvoidAreaConflict[];
  readonly areaNames: ReadonlyMap<AvoidAreaId, string>;
  readonly onMoveConflictEndpoint: (conflict: AvoidAreaConflict) => void;
  readonly onEditConflictArea: (areaId: AvoidAreaId) => void;
  readonly onRemoveConflictArea: (areaId: AvoidAreaId) => void;
  readonly errorMessage: string | null;
  readonly renderError: MapRenderError | null;
  readonly mapLoadStatus: MapLoadStatus;
  readonly onRetryMap: () => void;
}

export function PlannerWorkspaceStatus({
  statusMessage,
  saveStatus,
  updateHighlight,
  updateRecovery,
  recoveryActions,
  onRetryFailedUpdate,
  onEditFailedUpdate,
  onDiscardFailedUpdate,
  onRetrySave,
  conflict,
  onReloadLatest,
  onKeepMyCopy,
  conflicts,
  areaNames,
  onMoveConflictEndpoint,
  onEditConflictArea,
  onRemoveConflictArea,
  errorMessage,
  renderError,
  mapLoadStatus,
  onRetryMap,
}: PlannerWorkspaceStatusProps) {
  return (
    <>
      <p
        className="og-planner__status"
        data-testid="status-line"
        role="status"
        aria-live="polite"
      >
        {statusMessage}
      </p>

      <SaveIndicator state={saveStatus.state} />

      {/*
        05 §12: the delta of the update that just landed sits beside its status.
        The status line already announces it, so this is not a second live region.
      */}
      {updateHighlight === null ? null : <RouteDeltaChip delta={updateHighlight.delta} />}

      {/* 04 §21: a failed update keeps the last-good answer and names its actions. */}
      {updateRecovery === null || recoveryActions === null ? null : (
        <UpdateFailureBanner
          failure={updateRecovery}
          actions={recoveryActions}
          onRetry={onRetryFailedUpdate}
          onEdit={onEditFailedUpdate}
          onDiscard={onDiscardFailedUpdate}
        />
      )}

      {saveStatus.state === "quota" ? (
        <div className="og-planner__save-banner" data-testid="save-quota-banner" role="alert">
          {RIDE_EXPORT_AVAILABLE ? (
            <button type="button" className="og-secondary">
              Export ride
            </button>
          ) : (
            <>
              <span>
                Storage is full. Try again after freeing space in your browser settings.
              </span>
              <button
                type="button"
                className="og-secondary"
                onClick={onRetrySave}
                title="Try saving again after freeing browser storage."
              >
                Try again
              </button>
            </>
          )}
        </div>
      ) : null}

      {conflict === null ? null : (
        <section
          className="og-planner__conflict"
          data-testid="save-conflict-panel"
          aria-label="Ride edit conflict"
        >
          <p>
            Another tab has a newer ride (revision {conflict.storedRevision}); your copy is
            revision {conflict.ourRevision}.
          </p>
          <div className="og-planner__conflict-actions">
            <button
              type="button"
              className="og-secondary"
              onClick={() => void onReloadLatest()}
            >
              Reload latest
            </button>
            <button
              type="button"
              className="og-secondary"
              onClick={() => void onKeepMyCopy()}
            >
              Keep my copy
            </button>
          </div>
        </section>
      )}

      {/*
        04 §18: endpoint conflicts remain explicit and non-blocking. The rider
        chooses which authored object to change; this panel never changes either.
      */}
      <AvoidAreaConflictPanel
        conflicts={conflicts}
        areaNames={areaNames}
        onMoveEndpoint={onMoveConflictEndpoint}
        onEditArea={onEditConflictArea}
        onRemoveArea={onRemoveConflictArea}
      />

      {errorMessage === null ? null : (
        <p className="og-planner__error" data-testid="planner-error" role="alert">
          {errorMessage}
        </p>
      )}

      {/* A renderer notice yields to the fuller failure surface when the map is down. */}
      {renderError === null || mapLoadStatus.state === "failed" ? null : (
        <p
          className="og-planner__map-error"
          data-testid="map-error-notice"
          data-map-error-kind={renderError.kind}
          role="status"
        >
          {MAP_ERROR_NOTICE[renderError.kind]}
        </p>
      )}

      {mapLoadStatus.state === "failed" ? (
        <p
          className="og-planner__map-error og-planner__map-failed"
          data-testid="map-load-notice"
          data-map-load-reason={mapLoadStatus.reason ?? "unknown"}
          role="status"
        >
          {"The map didn't load — "}
          <button
            type="button"
            className="og-secondary og-planner__map-retry"
            data-testid="map-retry"
            onClick={onRetryMap}
          >
            Retry map
          </button>
          {mapLoadStatus.reason === null ? null : (
            <span className="og-planner__map-failed-detail">
              {MAP_ERROR_NOTICE[mapLoadStatus.reason]}
            </span>
          )}
        </p>
      ) : null}
    </>
  );
}
