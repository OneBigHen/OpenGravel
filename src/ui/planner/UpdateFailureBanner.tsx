"use client";

/**
 * The failed-update banner (04-PLANNER-AND-WORKSPACE-UX §21, §31; 05 §11).
 *
 * 04 §21 asks for three things when an update fails: the old route stays, the
 * attempted change is shown as failed and recoverable, and the rider gets Retry,
 * Edit and Discard change. This component is the second and third of those: it
 * names the change, states the failure in the §29 taxonomy's own words, and offers
 * exactly the three actions.
 *
 * ## Non-modal, and not a second live region
 *
 * The failure is already announced by the status line's `role="status"` (04 §9),
 * which is why the banner carries no `aria-live` of its own: two live regions
 * saying the same thing in the same second is how a screen-reader user ends up
 * hearing it twice and the ride not at all. What the banner adds is the *detail*
 * and the *controls*, reachable by keyboard like every other action in the sheet.
 *
 * ## Why the actions can be disabled
 *
 * `canEdit` is false when the attempted change cannot be attributed to an object
 * that still exists (a removal), and `canDiscard` is false when the history cursor
 * is no longer on the failed revision's entry. A disabled control with a title that
 * says why is honest; a control that silently does nothing is not, and hiding it
 * would leave the rider wondering whether they misread the failure.
 */

import type {
  UpdateFailure,
  UpdateRecoveryActions,
} from "@/application/planner/update-recovery";

export interface UpdateFailureBannerProps {
  readonly failure: UpdateFailure;
  readonly actions: UpdateRecoveryActions;
  /** Ask again for the current revision (the controller's `begin`). */
  readonly onRetry: () => void;
  /** Open the affected object's editor. */
  readonly onEdit: () => void;
  /** Undo exactly the attempted change (04 §20's whole-ride undo). */
  readonly onDiscard: () => void;
}

export function UpdateFailureBanner({
  failure,
  actions,
  onRetry,
  onEdit,
  onDiscard,
}: UpdateFailureBannerProps): React.ReactElement {
  return (
    <section
      className="og-update-failure"
      data-testid="update-failure-banner"
      data-failure-code={failure.code}
      data-recoverable={failure.recoverable ? "true" : "false"}
      aria-label={`Update failed: ${failure.attemptedCommandLabel}`}
    >
      <p className="og-update-failure__label" data-testid="update-failure-label">
        {failure.attemptedCommandLabel}
      </p>
      <p className="og-update-failure__message" data-testid="update-failure-message">
        {failure.message}
      </p>
      <p className="og-update-failure__keep">Your previous ride is still on the map.</p>
      <div className="og-update-failure__actions">
        <button
          type="button"
          className="og-chip og-update-failure__action"
          data-testid="update-retry"
          onClick={onRetry}
        >
          Retry
        </button>
        <button
          type="button"
          className="og-chip og-update-failure__action"
          data-testid="update-edit"
          disabled={!actions.canEdit}
          title={
            actions.canEdit
              ? "Open the place this change touched."
              : "This change cannot be pointed at — nothing to edit."
          }
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          type="button"
          className="og-chip og-update-failure__action"
          data-testid="update-discard"
          disabled={!actions.canDiscard}
          title={
            actions.canDiscard
              ? "Undo this change and go back to the ride you had."
              : "Only the change this failure describes can be discarded."
          }
          onClick={onDiscard}
        >
          Discard change
        </button>
      </div>
    </section>
  );
}
