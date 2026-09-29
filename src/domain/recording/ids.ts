/** Identity for the local trace that a RideSession references. */
export type RecordingId = string & { readonly __brand: "RecordingId" };

/** Mints the identity used by the append-only recording trace. */
export function newRecordingId(): RecordingId {
  return `rec_${crypto.randomUUID()}` as RecordingId;
}

/** Narrows an identity already carried by a session or durable row. */
export function asRecordingId(value: string): RecordingId {
  return value as RecordingId;
}
