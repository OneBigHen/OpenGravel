/**
 * Interception scoped to one **plan attempt** rather than to one HTTP request.
 *
 * The planner deliberately asks the server twice for every attempt
 * (`src/application/planner/client-planning-service.ts`): one request for the
 * first route only, so the rider sees a ride as soon as one exists, and a second
 * for the full answer with alternatives. Both carry the same
 * `identity.planningGeneration`, and a retry starts a new generation.
 *
 * A gate that wants to simulate "the router has no path here" therefore has to
 * answer *both* queries of the attempt. Failing only the first one describes a
 * router that is merely slower for alternatives, and the app correctly shows the
 * ride it did get — so the test would wait for a failure that is never owed.
 * Keying the interception on the generation keeps the intended shape: the whole
 * attempt fails, and the retry after it is a different attempt that reaches the
 * server normally.
 */

import type { Page, Route } from "@playwright/test";

/** The identity fields every `/api/route-plan` body carries. */
export interface PlanAttemptIdentity {
  readonly rideId?: string | null;
  readonly rideRevision: number;
  readonly planningGeneration: number;
}

export interface PlanRequestBody {
  readonly identity: PlanAttemptIdentity;
}

/** The attempt a body belongs to; `null` when it carries no usable identity. */
function attemptKey(body: PlanRequestBody | null): string | null {
  const identity = body?.identity;
  if (identity === undefined || typeof identity.planningGeneration !== "number") return null;
  return `${identity.rideId ?? ""}:${identity.rideRevision}:${identity.planningGeneration}`;
}

/**
 * Runs `handle` for every `/api/route-plan` request of the **next** attempt and
 * lets every other request through untouched.
 *
 * "Next" is the attempt of the first request this handler sees, so register it
 * immediately before the action that begins an attempt. The caller removes the
 * route with `page.unroute` on the plan endpoint, the same as any other
 * interception in these specs.
 */
export async function interceptNextPlanAttempt(
  page: Page,
  handle: (route: Route, body: PlanRequestBody) => Promise<void>,
): Promise<void> {
  let attempt: string | null = null;
  await page.route("**/api/route-plan", async (route) => {
    let body: PlanRequestBody | null = null;
    try {
      body = route.request().postDataJSON() as PlanRequestBody;
    } catch {
      // A body Playwright cannot decode is not part of a modelled attempt; the
      // spec's own request recorder reports it.
      body = null;
    }
    const key = attemptKey(body);
    if (key === null || (attempt !== null && key !== attempt) || body === null) {
      await route.continue();
      return;
    }
    attempt = key;
    await handle(route, body);
  });
}
