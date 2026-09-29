/**
 * Durable RideSession storage: the checkpoint row and the append-only journal
 * (02-ARCHITECTURE-CONTRACT §14–§15; 08-RIDE-NAVIGATION-AND-FREE-RIDE §11–§13;
 * 17-IMPLEMENTATION-PLAN Task 8.1).
 *
 * Two writes, two disciplines:
 *
 * - `appendEvents` writes journal rows. Its one transaction refuses a sequence a
 *   checkpoint already folded: durable history is never rewritten, which is what
 *   makes a resumed sequence safe (the controller reuses only the slots the
 *   resume report declared dropped).
 * - `checkpoint` folds a state and deletes the rows it folded **in the same
 *   transaction**. A crash therefore cannot leave a checkpoint claiming rows that
 *   are still present, nor remove rows a checkpoint never folded. A checkpoint
 *   older than the durable one is refused, so a late write can never rewind the
 *   restored state.
 *
 * `loadSession` validates every row it reads (`isRideSessionState` /
 * `isRideSessionEvent`) and returns the unreadable ones as `dropped` entries:
 * the storage layer's job is to state what it could not read, not to invent a
 * value or to throw away the fact that something was there.
 */

import type {
  DroppedSessionEvent,
  LoadedRideSession,
  RideSessionCheckpoint,
  RideSessionJournalEntry,
  RideSessionRepositoryPort,
  RideSessionSummary,
  SessionCheckpointWriteResult,
  SessionWriteResult,
} from "@/application/persistence/ride-session-repository";
import type { RideSessionId } from "@/domain/ride-session/ids";
import { isRideSessionEvent, isRideSessionState } from "@/domain/ride-session/validate";
import type { RideSessionState } from "@/domain/ride-session/types";
import {
  type RideSessionCheckpointRow,
  type StoredRideSessionJournalRow,
  VNextDatabase,
  vnextDatabase,
} from "./db";

export type {
  DroppedSessionEvent,
  LoadedRideSession,
  RideSessionCheckpoint,
  RideSessionJournalEntry,
  RideSessionRepositoryPort,
  RideSessionSummary,
} from "@/application/persistence/ride-session-repository";

export interface RideSessionRepositoryOptions {
  readonly database?: VNextDatabase;
  readonly databaseName?: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionId(value: unknown): value is RideSessionId {
  return typeof value === "string" && value.startsWith("sess_") && value.length > "sess_".length;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * The journal row's addressable identity. Padded so the compound index and the
 * primary key agree on ordering, and so a row is locatable without scanning.
 */
export function journalRecordId(sessionId: RideSessionId, seq: number): string {
  return `${sessionId}#${String(seq).padStart(8, "0")}`;
}

/** A stored checkpoint row that is structurally the row this module writes. */
function isCheckpointRow(value: unknown): value is RideSessionCheckpointRow {
  if (!isRecord(value)) return false;
  return (
    isSessionId(value.sessionId) &&
    Number.isInteger(value.checkpointSeq) &&
    (value.checkpointSeq as number) >= 0 &&
    Number.isInteger(value.revision) &&
    typeof value.writerToken === "string" &&
    typeof value.updatedAt === "string" &&
    value.state !== undefined
  );
}

/** Additive schema defaults for sessions written before M6's two folded fields. */
function normalizeStoredState(value: unknown): RideSessionState | null {
  if (!isRecord(value)) return null;
  const normalized = {
    ...value,
    suggestions: value.suggestions ?? "off",
    pausedDurationMs: value.pausedDurationMs ?? 0,
    pausedAt:
      value.pausedAt === undefined
        ? value.activity === "paused"
          ? value.updatedAt
          : null
        : value.pausedAt,
    sessionStartPosition:
      value.sessionStartPosition === undefined
        ? isRecord(value.position) && isRecord(value.position.coordinate)
          ? value.position.coordinate
          : null
        : value.sessionStartPosition,
  };
  return isRideSessionState(normalized) ? (normalized as RideSessionState) : null;
}

type JournalRowRead =
  | { readonly entry: RideSessionJournalEntry }
  | { readonly dropped: DroppedSessionEvent };

/**
 * One stored row, read honestly. A row with no `event` at all is the truncated
 * write `missing-event` names; a row whose event is present but malformed is
 * `unreadable-record`; both are dropped rather than trusted.
 */
function readJournalRow(value: unknown, sessionId: RideSessionId): JournalRowRead {
  if (!isRecord(value)) {
    return {
      dropped: {
        seq: null,
        reason: "unreadable-record",
        message: "a journal row is not a record",
      },
    };
  }
  if (!isPositiveInteger(value.seq)) {
    return {
      dropped: {
        seq: null,
        reason: "unreadable-record",
        message: "a journal row carries no usable sequence",
      },
    };
  }
  if (value.sessionId !== sessionId) {
    return {
      dropped: {
        seq: value.seq,
        reason: "unreadable-record",
        message: `a journal row at ${value.seq} belongs to another session`,
      },
    };
  }
  if (value.event === undefined || value.event === null) {
    return {
      dropped: {
        seq: value.seq,
        reason: "missing-event",
        message: `the journal row at ${value.seq} has no event; the write was incomplete`,
      },
    };
  }
  const rawEvent = value.event;
  const event =
    isRecord(rawEvent) && rawEvent.type === "session.started"
      ? { ...rawEvent, suggestions: rawEvent.suggestions ?? "off" }
      : rawEvent;
  if (!isRideSessionEvent(event)) {
    return {
      dropped: {
        seq: value.seq,
        reason: "unreadable-record",
        message: `the journal row at ${value.seq} carries a malformed event`,
      },
    };
  }
  return { entry: { seq: value.seq, event } };
}

class RideSessionRepository implements RideSessionRepositoryPort {
  constructor(private readonly database: VNextDatabase) {}

  async appendEvents(
    sessionId: RideSessionId,
    entries: readonly RideSessionJournalEntry[],
  ): Promise<SessionWriteResult> {
    if (!isSessionId(sessionId)) {
      return { ok: false, reason: "invalid", message: "the session id is not a sess_ identifier" };
    }
    for (const entry of entries) {
      if (!isPositiveInteger(entry.seq)) {
        return {
          ok: false,
          reason: "invalid",
          message: "a journal sequence must be a positive integer",
        };
      }
      if (!isRideSessionEvent(entry.event)) {
        return {
          ok: false,
          reason: "invalid",
          message: `the journal event at ${entry.seq} is malformed`,
        };
      }
    }
    if (entries.length === 0) return { ok: true };

    let refusal: SessionWriteResult | null = null;
    try {
      await this.database.transaction(
        "rw",
        this.database.rideSessions,
        this.database.rideSessionJournal,
        async () => {
          const stored = await this.database.rideSessions.get(sessionId);
          const foldedSeq = isCheckpointRow(stored) ? stored.checkpointSeq : 0;
          const stale = entries.find((entry) => entry.seq <= foldedSeq);
          if (stale !== undefined) {
            refusal = {
              ok: false,
              reason: "stale-sequence",
              message: `sequence ${stale.seq} is already folded into the checkpoint at ${foldedSeq}`,
            };
            return;
          }
          const rows: StoredRideSessionJournalRow[] = entries.map((entry) => ({
            id: journalRecordId(sessionId, entry.seq),
            sessionId,
            seq: entry.seq,
            event: entry.event,
          }));
          await this.database.rideSessionJournal.bulkPut(rows);
        },
      );
    } catch (error: unknown) {
      return { ok: false, reason: "write-failed", error };
    }
    return refusal ?? { ok: true };
  }

  async checkpoint(input: {
    readonly state: RideSessionState;
    readonly checkpointSeq: number;
    readonly writerToken: string;
  }): Promise<SessionCheckpointWriteResult> {
    const { state, checkpointSeq, writerToken } = input;
    if (!isRideSessionState(state)) {
      return { ok: false, reason: "invalid", message: "the checkpoint state is malformed" };
    }
    if (!isPositiveInteger(checkpointSeq)) {
      return {
        ok: false,
        reason: "invalid",
        message: "a checkpoint sequence must be a positive integer",
      };
    }
    if (typeof writerToken !== "string" || writerToken.length === 0) {
      return { ok: false, reason: "invalid", message: "the writer token must not be empty" };
    }
    const sessionId = state.sessionId;

    let refusal: SessionCheckpointWriteResult | null = null;
    try {
      await this.database.transaction(
        "rw",
        this.database.rideSessions,
        this.database.rideSessionJournal,
        async () => {
          const stored = await this.database.rideSessions.get(sessionId);
          const previous = isCheckpointRow(stored) ? stored : null;
          if (previous !== null && previous.checkpointSeq > checkpointSeq) {
            refusal = {
              ok: false,
              reason: "stale-checkpoint",
              storedCheckpointSeq: previous.checkpointSeq,
              message: `a newer checkpoint at ${previous.checkpointSeq} is already durable`,
            };
            return;
          }
          await this.database.rideSessions.put({
            sessionId,
            checkpointSeq,
            revision: (previous?.revision ?? 0) + 1,
            writerToken,
            updatedAt: state.updatedAt,
            state,
          });
          // Compaction shares the transaction: the rows this checkpoint folded
          // are gone only if the checkpoint itself is durable.
          const rows = await this.database.rideSessionJournal
            .where("sessionId")
            .equals(sessionId)
            .toArray();
          const obsolete = rows
            .filter((row) => isPositiveInteger(row.seq) && row.seq <= checkpointSeq)
            .map((row) => row.id);
          if (obsolete.length > 0) await this.database.rideSessionJournal.bulkDelete(obsolete);
        },
      );
    } catch (error: unknown) {
      return { ok: false, reason: "write-failed", error };
    }
    return refusal ?? { ok: true };
  }

  async loadSession(sessionId: RideSessionId): Promise<LoadedRideSession | null> {
    let result: LoadedRideSession | null = null;
    await this.database.transaction(
      "rw",
      this.database.rideSessions,
      this.database.rideSessionJournal,
      async () => {
        const stored = await this.database.rideSessions.get(sessionId);
        const rows = await this.database.rideSessionJournal
          .where("sessionId")
          .equals(sessionId)
          .sortBy("seq");
        if (stored === undefined && rows.length === 0) {
          result = null;
          return;
        }

        const dropped: DroppedSessionEvent[] = [];
        let checkpoint: RideSessionCheckpoint | null = null;
        if (stored !== undefined) {
          if (
            !isCheckpointRow(stored) ||
            normalizeStoredState(stored.state) === null ||
            normalizeStoredState(stored.state)?.sessionId !== sessionId
          ) {
            dropped.push({
              seq: null,
              reason: "unreadable-record",
              message: "the session checkpoint could not be read",
            });
          } else {
            checkpoint = {
              state: normalizeStoredState(stored.state) as RideSessionState,
              checkpointSeq: stored.checkpointSeq,
              revision: stored.revision,
            };
          }
        }

        const events: RideSessionJournalEntry[] = [];
        for (const row of rows) {
          const read = readJournalRow(row, sessionId);
          if ("entry" in read) events.push(read.entry);
          else dropped.push(read.dropped);
        }

        result = { checkpoint, events, dropped };
      },
    );
    return result;
  }

  async listSessions(): Promise<readonly RideSessionSummary[]> {
    const rows = await this.database.rideSessions.toArray();
    const summaries: RideSessionSummary[] = [];
    for (const row of rows) {
      if (!isCheckpointRow(row)) continue;
      const state = normalizeStoredState(row.state);
      if (state === null) continue;
      summaries.push({
        sessionId: state.sessionId,
        activity: state.activity,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        endedAt: state.endedAt,
        checkpointSeq: row.checkpointSeq,
      });
    }
    return summaries;
  }

  async deleteSession(sessionId: RideSessionId): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.rideSessions,
      this.database.rideSessionJournal,
      async () => {
        await this.database.rideSessions.delete(sessionId);
        const rows = await this.database.rideSessionJournal
          .where("sessionId")
          .equals(sessionId)
          .toArray();
        await this.database.rideSessionJournal.bulkDelete(rows.map((row) => row.id));
      },
    );
  }
}

/** Creates the durable adapter against the shared database or an injected one. */
export function createRideSessionRepository(
  options: RideSessionRepositoryOptions = {},
): RideSessionRepositoryPort {
  const database =
    options.database ??
    (options.databaseName === undefined
      ? vnextDatabase()
      : new VNextDatabase(options.databaseName));
  return new RideSessionRepository(database);
}
