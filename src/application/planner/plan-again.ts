/**
 * "Plan it again" on a saved ride (R3-1): the one sentence that says what the
 * new plan changed against the line the rider saved. Pure, so the wording can
 * be read and tested without a planner.
 */

import { formatDistance, formatDuration } from "./measurements";

export interface PlanAgainNumbers {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

/** Said once, when the new plan arrives. */
export function planAgainMessage(saved: PlanAgainNumbers, fresh: PlanAgainNumbers): string {
  const savedText = `${formatDistance(saved.distanceMeters)}, ${formatDuration(saved.durationSeconds)}`;
  const freshText = `${formatDistance(fresh.distanceMeters)}, ${formatDuration(fresh.durationSeconds)}`;
  if (savedText === freshText) return `Planned again: same as the saved line, ${freshText}.`;
  return `Planned again: now ${freshText}. The saved line was ${savedText}.`;
}
