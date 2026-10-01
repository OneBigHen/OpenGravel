/** Frozen provenance identities shared by transport and application validation. */
export const JEV_FROZEN_RELEASE_MODEL = "jev-1.13.0";

export function isFrozenJevModelIdentity(value: unknown): value is string {
  return value === JEV_FROZEN_RELEASE_MODEL;
}
