/**
 * The navigation-state port the 8.2 GPS/matching engine consumes
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §26, §3–§5).
 *
 * It is deliberately one read-only method returning a derived value: the engine
 * needs to know what to present *now* (position quality, the next pending stop,
 * the outstanding maneuver, whether ahead guidance is suspended) and it must not
 * be able to mutate the activity while doing it. Freshness is derived by the
 * domain from an injected clock, so two readers of the same session cannot
 * disagree about what is current.
 */

import type { SessionNavigationState } from "@/domain/ride-session/navigation";

export interface RideSessionNavigationPort {
  /**
   * The present-tense navigation view of the active session, or `null` when no
   * session is open. A null answer is the honest one: there is nothing to guide.
   */
  navigationState(): SessionNavigationState | null;
}
