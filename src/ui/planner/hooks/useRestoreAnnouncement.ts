"use client";

/**
 * The restore confirmation is a one-shot announcement, not a second status.
 *
 * A boot that adopts a durable draft sets `restoreStatus` to `restored` and only
 * a ride command clears it again (undo/redo and the automatic replan write
 * elsewhere), so a surface that shows the message indefinitely replaces every
 * later plan status with "Restored your draft" for the whole session. This hook
 * hands the message out only while it is news: each restore status is announced
 * for a short window, and after that the plan owns the status line again.
 */

import { useEffect, useState } from "react";

import type { RestoreStatus } from "@/ui/stores/ride-document-store";

/** How long the confirmation may stand in for the plan status. */
export const RESTORE_ANNOUNCEMENT_MS = 4_000;

export function useRestoreAnnouncement(input: {
  readonly restoreStatus: RestoreStatus;
}): string | null {
  const { restoreStatus } = input;
  /**
   * The status object whose window has already passed. Keying by the object (a
   * store `set` replaces it) means a second restore announces itself again,
   * while a rerender of the same status does not restart the countdown.
   */
  const [expiredFor, setExpiredFor] = useState<RestoreStatus | null>(null);
  const announcement =
    restoreStatus.state === "restored" &&
    restoreStatus.message !== null &&
    expiredFor !== restoreStatus
      ? restoreStatus.message
      : null;

  useEffect(() => {
    if (announcement === null) return;
    const timer = setTimeout(() => setExpiredFor(restoreStatus), RESTORE_ANNOUNCEMENT_MS);
    return (): void => clearTimeout(timer);
  }, [announcement, restoreStatus]);

  return announcement;
}
