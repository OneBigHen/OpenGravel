/**
 * How far out of the way an A-to-B ride may go, measured against the fastest
 * route's seconds on one clock. One budget replaces the three hidden caps the
 * old searches carried (1.25, 1.35, 1.75). Balanced is the default and the
 * scorecard's own limit. RM-8 adds the rider's dial; the request may already
 * carry a budget name.
 */
export type RideBudgetName = "direct" | "balanced" | "scenic";

export const RIDE_BUDGETS: Readonly<Record<RideBudgetName, number>> = {
  direct: 1.15,
  balanced: 1.35,
  scenic: 1.75,
};

export const DEFAULT_RIDE_BUDGET: RideBudgetName = "balanced";

export function isRideBudgetName(value: unknown): value is RideBudgetName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RIDE_BUDGETS, value);
}

/** The multiple of the fastest route's seconds a ride may take. */
export function rideBudgetFactor(name: RideBudgetName | undefined): number {
  return RIDE_BUDGETS[name ?? DEFAULT_RIDE_BUDGET];
}

/** The longest a ride may take, in seconds, given the fastest route's seconds. */
export function rideBudgetSeconds(fastestSeconds: number, name: RideBudgetName | undefined): number {
  return fastestSeconds * rideBudgetFactor(name);
}
