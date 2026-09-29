import type { Coordinate } from "@/domain/ride/types";
import type { ExplicitReturnTarget } from "./return-routing";

/** Resolves only explicit saved/session locations; the authored finish is never considered. */
export function resolveHeadHomeTarget(input: {
  readonly savedHome: Coordinate | null;
  readonly sessionStart: Coordinate | null;
}): ExplicitReturnTarget | null {
  if (input.savedHome !== null) {
    return { kind: "saved-home", coordinate: { ...input.savedHome }, label: "saved Home" };
  }
  if (input.sessionStart !== null) {
    return {
      kind: "session-start",
      coordinate: { ...input.sessionStart },
      label: "your session start",
    };
  }
  return null;
}
