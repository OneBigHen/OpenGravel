/** Frozen provenance identities shared by transport and application validation. */
export const JEV_FRONTIER_PINNED_MODEL = "typesafe/jev-1.13";
export const JEV_FROZEN_RELEASE_MODEL = "jev-1.13.0";

export function isFrozenJevModelIdentity(value: unknown): value is string {
  return value === JEV_FROZEN_RELEASE_MODEL ||
    (typeof value === "string" && /^typesafe\/jev-1\.13(?:-\d{8})?$/.test(value));
}
