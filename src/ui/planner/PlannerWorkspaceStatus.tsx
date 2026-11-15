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
import { IDLE_PLAN_STATUS } from "@/application/planner/planner-view-model";
import { useActivityMode } from "@/ui/stores/activity-mode";

/** The planner's status in a hiker's words ("Hike ready.", "Finding your hike…"). */
export function hikeStatus(message: string): string {
  return message.replace(/\bRide\b/g, "Hike").replace(/\bride\b/g, "hike").replace("Finding other roads…", "Checking other trails…");
}

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
  /**
   * The one retry of a failed plan (OG-04). Offered inside the error row, so the
   * message and its action read as one line; absent while the failed-update
   * banner is on screen, because that banner already carries its own Retry.
   */
  readonly onRetryPlan?: (() => void) | undefined;
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
  onRetryPlan,
  renderError,
  mapLoadStatus,
  onRetryMap,
}: PlannerWorkspaceStatusProps) {
  const errorRetry = onRetryPlan !== undefined && (updateRecovery === null || recoveryActions === null);
  const hiking = useActivityMode() === "hike";
  // "No plan yet." is pure filler in the rail's head: the composer already says
  // what to do next. The live region stays mounted (empty) so the next real
  // status is still announced.
  const message = statusMessage === IDLE_PLAN_STATUS ? "" : statusMessage;
  return (
    <>
      <p
        className="og-planner__status"
        data-testid="status-line"
        role="status"
        aria-live="polite"
      >
        {hiking ? hikeStatus(message) : message}
      </p>

      <SaveIndicator state={saveStatus.state} savedBefore={saveStatus.result !== null} />

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

      {/*
        OG-04: one error row — the whole message, never clipped, and (when no
        banner already offers it) the one Retry beside it.
      */}
      {errorMessage === null ? null : (
        <div className="og-planner__error-row" data-testid="planner-error-row">
          <svg className="og-planner__error-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5M12 16.5v.01" />
          </svg>
          <p className="og-planner__error" data-testid="planner-error" role="alert">
            {errorMessage}
          </p>
          {errorRetry ? (
            <button type="button" className="og-secondary og-planner__error-retry" data-testid="planner-error-retry" onClick={onRetryPlan}>
              Retry
            </button>
          ) : null}
        </div>
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
