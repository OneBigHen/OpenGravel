/**
 * Internal GraphHopper profile mapping (06-ROUTING-AND-DECISION-ENGINE §6).
 *
 * The engine's profile ids are implementation detail: they are chosen by
 * OpenGravel policy from the rider's authored intent and never reach rider
 * copy, the UI, or a decision (Rule E, VNX-007). This module is the one place
 * that knows the mapping, so a policy change is a table change here rather than
 * a diff across the adapter.
 *
 * The published mapping (Task 2.2, already exercised by the deployment custom
 * models in `infra/graphhopper/custom-models/`):
 *
 * | rider intent                            | engine profile         |
 * | --------------------------------------- | ---------------------- |
 * | road character `efficient` / `balanced` | `motorcycle_fastest`   |
 * | road character `curvy`                  | `motorcycle_twisty`    |
 * | road character `backroads`              | `motorcycle_scenic`    |
 * | surface `dirt-preferred`                | `motorcycle_adventure` |
 *
 * `mixed` used to override too (OGV-D-163). It no longer does (OGV-D-262): the
 * default surface is `mixed`, so the override silently turned every default
 * ride — Curvy or Backroads included — into the adventure model, and the road
 * character a rider picked changed nothing. `mixed` now means "no surface rule";
 * seeking dirt is `dirt-preferred`.
 *
 * Two rules are deliberate and are recorded as `OGV-D-163`:
 *
 * - **Surface overrides character.** A rider who asks for dirt on backroads
 *   wants the adventure model, not the scenic one: the surface envelope is the
 *   stronger constraint on which roads are legal to ride (06 §21).
 * - **There is no `neural` profile.** The legacy vocabulary had one; VNext has
 *   no personalized engine model, and inventing an engine profile for a
 *   rider-facing label would put product policy in the adapter (Rule E).
 */

import type { RideIntent, RoadCharacterIntent, SurfaceIntent } from "@/domain/ride/types";

/** Every engine profile this deployment can serve (its `capabilities().profiles`). */
export const GRAPHHOPPER_ENGINE_PROFILES = [
  "motorcycle_fastest",
  "motorcycle_twisty",
  "motorcycle_scenic",
  "motorcycle_adventure",
] as const;

/** One GraphHopper profile id this adapter is allowed to request. */
export type GraphHopperEngineProfile = (typeof GRAPHHOPPER_ENGINE_PROFILES)[number];

/**
 * Road character → engine profile. `balanced` keeps the legacy engine profile
 * (`motorcycle_fastest`): the legacy `balanced` rider profile also resolved to
 * `motorcycle_fastest`, so porting it any other way would change route
 * behavior rather than preserve it.
 */
const CHARACTER_PROFILES: Readonly<Record<RoadCharacterIntent, GraphHopperEngineProfile>> = {
  efficient: "motorcycle_fastest",
  balanced: "motorcycle_fastest",
  curvy: "motorcycle_twisty",
  backroads: "motorcycle_scenic",
};

/**
 * Surface preferences that override the road character. Only seeking dirt
 * changes the model; `pavement`, `mostly-pavement` and `mixed` say what the rider
 * will accept, which the request-time surface rule expresses (request-builder),
 * so they leave the character mapping intact.
 */
const SURFACE_OVERRIDES: Readonly<
  Partial<Record<SurfaceIntent["preference"], GraphHopperEngineProfile>>
> = {
  "dirt-preferred": "motorcycle_adventure",
};

/**
 * The internal engine profile for one authored ride intent (06 §6).
 *
 * Pure and total: every intent resolves to a served profile, so the adapter
 * never has to guess and never sends a profile the deployment does not have.
 */
export function profileFor(intent: RideIntent): string {
  const surfaceProfile = SURFACE_OVERRIDES[intent.surface.preference];
  return surfaceProfile ?? CHARACTER_PROFILES[intent.roadCharacter];
}

/** The profile ids a non-paved surface preference can resolve to. */
const NON_PAVED_PROFILES: ReadonlySet<string> = new Set(
  Object.values(SURFACE_OVERRIDES).filter(
    (profile): profile is GraphHopperEngineProfile => profile !== undefined,
  ),
);

/**
 * True when a resolved profile can only come from a non-paved surface
 * preference — the inverse of {@link SURFACE_OVERRIDES}.
 *
 * It exists for the one caller that has the resolved profile but not the
 * authored intent: the server, which receives an already-resolved
 * `ProviderRouteRequest` and therefore cannot read `intent.surface`
 * (`OGV-D-195`). The answer is exact, never a guess: `motorcycle_adventure` is
 * reachable *only* through the surface override, so seeing it proves the rider
 * asked to leave pavement (`OGV-D-209`).
 */
export function profileImpliesNonPavedSurface(profile: string): boolean {
  return NON_PAVED_PROFILES.has(profile);
}
