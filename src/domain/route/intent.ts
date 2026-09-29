/**
 * The rider-intent view the candidate pipeline reads (Task 3.1).
 *
 * The pipeline is fed a `RideIntent` by the client controller and a resolved
 * `ProviderRouteRequest` by the server (`OGV-D-178`). Rather than fabricate the
 * authored intent on the server, both callers pass this **narrow view**, and a
 * full `RideIntent` satisfies it structurally.
 *
 * Only facts with a reader today live here. Hard eligibility reads `shape`
 * (a loop must close); scoring reads `roadCharacter` (which policy weight
 * vector applies); lane resolution reads `surface` (whether the
 * surface-targeted lane is offered). Terrain, bike and time facts are
 * deliberately absent until the wave that reads them lands, so nothing
 * downstream can treat an unread field as a decision.
 */

import type {
  RoadCharacterIntent,
  RideIntent,
  SurfaceIntent,
} from "../ride/types";

/** How strongly discovery should value personally unridden roads. */
export type NoveltyPreference =
  | "prefer-new-to-me"
  | "balanced"
  | "prefer-familiar";

/** Optional weather policy for discovery; it is inert without usable evidence. */
export type WeatherPreference = "avoid-adverse" | "no-preference";

/** The intent facts the pipeline reads; a `RideIntent` is assignable to it. */
export interface PipelineIntent {
  /** Trip shape; `loop` requires the line to return to its start. */
  readonly shape?: RideIntent["shape"] | undefined;
  /** Rider road character; policy selects its weight vector (`06 §6`). */
  readonly roadCharacter?: RoadCharacterIntent | undefined;
  /**
   * The rider's surface preference, read by lane resolution (`06 §4`/§21): the
   * `surface-targeted` lane exists only when this prefers non-paved.
   *
   * Typed as the one field the lane set reads rather than as the whole
   * `SurfaceIntent`, so a full `RideIntent` (whose `surface` carries more) is
   * still assignable while nothing downstream can treat an unread surface field
   * as a decision.
   */
  readonly surface?: { readonly preference: SurfaceIntent["preference"] } | undefined;
  /** Personal novelty direction; absent evidence remains neutral. */
  readonly noveltyPreference?: NoveltyPreference | undefined;
}
