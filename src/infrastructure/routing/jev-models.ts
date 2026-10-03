/** Provider-specific spellings for the frozen Jev 1.13 release; never aliases. */
import {
  JEV_FROZEN_RELEASE_MODEL,
  JEV_FRONTIER_PINNED_MODEL,
  isFrozenJevProviderIdentity,
} from "@/application/planner/ports/jev-model-identity";
export const JEV_DIRECT_MODEL = JEV_FROZEN_RELEASE_MODEL;
export const JEV_OPENROUTER_MODEL = JEV_FRONTIER_PINNED_MODEL;
export type JevProvider = "openrouter" | "typesafe";

export function isPinnedJevProviderModel(value: unknown, provider: JevProvider): value is string {
  return provider === "typesafe"
    ? value === JEV_DIRECT_MODEL
    : value !== JEV_DIRECT_MODEL && isFrozenJevProviderIdentity(value);
}
