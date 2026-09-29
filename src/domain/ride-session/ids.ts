/**
 * Stable branded identifiers for the physical activity authority
 * (03-DOMAIN-MODEL §1, 02-ARCHITECTURE-CONTRACT §2.3).
 *
 * RideSession owns its own identity space: a session is one physical activity
 * (8 §1), so it gets a `sess_…` id of its own, and the maneuver identities the
 * guidance engine issues live in `instr_…`. Both follow the ride module's two
 * rules — `new*` factories mint an identity that is being created, `as*`
 * helpers only narrow one another authority already minted (a persisted
 * session, a recovered journal row).
 */

export type RideSessionId = string & { readonly __brand: "RideSessionId" };
export type SessionInstructionId = string & { readonly __brand: "SessionInstructionId" };

/** Branded-ID constructor. Private: each factory names its own prefix. */
function mintId<T extends string>(prefix: string): T {
  return `${prefix}${crypto.randomUUID()}` as T;
}

/** `sess_…` — one physical activity (guided, free, track, paused, completed). */
export function newRideSessionId(): RideSessionId {
  return mintId<RideSessionId>("sess_");
}

/** Narrows an existing session identity (a persisted session, a URL, a log). */
export function asRideSessionId(value: string): RideSessionId {
  return value as RideSessionId;
}

/** `instr_…` — one issued maneuver in the session's guidance state. */
export function newSessionInstructionId(): SessionInstructionId {
  return mintId<SessionInstructionId>("instr_");
}

/** Narrows an existing maneuver identity (a persisted state, an ack event). */
export function asSessionInstructionId(value: string): SessionInstructionId {
  return value as SessionInstructionId;
}
