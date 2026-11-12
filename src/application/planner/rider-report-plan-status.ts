/**
 * What the last plan did with the rider's own reported spots: how many it
 * avoided, and whether it had to plan without them. Read by the truth lines.
 * Device-local; never sent anywhere.
 */

export interface RiderReportPlanStatus {
  readonly avoided: number;
  /** True when no route existed with the spots avoided, so the plan ignored them. */
  readonly couldNotAvoid: boolean;
}

let status: RiderReportPlanStatus = { avoided: 0, couldNotAvoid: false };
const listeners = new Set<() => void>();

export function getRiderReportPlanStatus(): RiderReportPlanStatus {
  return status;
}

export function setRiderReportPlanStatus(next: RiderReportPlanStatus): void {
  if (next.avoided === status.avoided && next.couldNotAvoid === status.couldNotAvoid) return;
  status = next;
  for (const listener of listeners) listener();
}

export function subscribeRiderReportPlanStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
