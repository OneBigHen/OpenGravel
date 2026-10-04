/** Frozen provenance identities shared by transport and application validation. */
export const JEV_FRONTIER_PINNED_MODEL = "typesafe/jev-1.13";
export const JEV_FROZEN_RELEASE_MODEL = "jev-1.13.0";

/** Direct TypeSafe release identity only; this is what reaches rider-facing wire contracts. */
export function isFrozenJevModelIdentity(value: unknown): value is string {
  return value === JEV_FROZEN_RELEASE_MODEL;
}

/** Frozen 1.13 release under any supported provider spelling (direct or OpenRouter-namespaced). */
export function isFrozenJevProviderIdentity(value: unknown): value is string {
  return value === JEV_FROZEN_RELEASE_MODEL ||
    (typeof value === "string" && /^typesafe\/jev-1\.13(?:-\d{8})?$/.test(value));
}
