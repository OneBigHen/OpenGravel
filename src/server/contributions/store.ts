import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ContributionModerationPort } from "@/application/contributions/moderation";
import {
  reporterIdentityFor,
  type ContributionEnvelope,
  type ContributionModerationDecision,
  type ContributionModerationRecord,
  type ContributionModerationState,
  type ContributionRoadRef,
} from "@/domain/contributions";

export const CONTRIBUTION_STORE_MAX_RESULTS = 100;
export const DEFAULT_CONTRIBUTION_DATABASE_PATH = process.env.COMMUNITY_DB_PATH
  ?? process.env.OGV_CONTRIBUTIONS_DB_PATH
  ?? path.join(process.cwd(), "data", "community.sqlite");

/**
 * A stored contribution record: validated submission plus bounded moderation
 * state. The reporter identity is the pseudonymous provenance projection only.
 */
export type StoredContribution = ContributionModerationRecord;

export interface ContributionStoreOptions {
  readonly now?: () => string;
}

/**
 * The one contribution store. `contributions` stays append-only; moderation
 * decisions live in their own append-only decision log and the state is a
 * projection, so a terminal decision can never be silently rewritten.
 */
export interface ContributionStore extends ContributionModerationPort {
  list(roadRef: ContributionRoadRef, limit?: number): readonly StoredContribution[];
  close(): void;
}

interface ContributionRow {
  readonly id: string;
  readonly envelope_json: string;
  readonly contributor_pseudo_id: string;
  readonly received_at: string;
  readonly decision: string | null;
  readonly decided_at: string | null;
}

function ensureParentDirectory(filePath: string): void {
  if (filePath === ":memory:") return;
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return CONTRIBUTION_STORE_MAX_RESULTS;
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, Math.min(CONTRIBUTION_STORE_MAX_RESULTS, Math.trunc(limit)));
}

const SELECT_CONTRIBUTION = `
  SELECT c.id, c.envelope_json, c.contributor_pseudo_id, c.received_at,
         m.decision, m.decided_at
  FROM contributions c
  LEFT JOIN contribution_moderation m ON m.id = c.id
`;

/** Append-only SQLite adapter using Node 24's built-in node:sqlite runtime. */
export class SQLiteContributionStore implements ContributionStore {
  private readonly database: DatabaseSync;
  private readonly now: () => string;
  private closed = false;

  public constructor(
    filePath: string = DEFAULT_CONTRIBUTION_DATABASE_PATH,
    options: ContributionStoreOptions = {},
  ) {
    ensureParentDirectory(filePath);
    this.database = new DatabaseSync(filePath);
    this.now = options.now ?? (() => new Date().toISOString());
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS contributions (
        id TEXT PRIMARY KEY NOT NULL,
        road_id TEXT NOT NULL,
        span_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('surface', 'gate', 'condition')),
        observed_at TEXT NOT NULL,
        gps_precision_m REAL NOT NULL,
        value_json TEXT NOT NULL,
        contributor_pseudo_id TEXT NOT NULL,
        client_version TEXT NOT NULL,
        evidence_level TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contributions_road_span_received
        ON contributions (road_id, span_id, received_at DESC);
      CREATE TABLE IF NOT EXISTS contribution_moderation (
        id TEXT PRIMARY KEY NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('accept', 'reject')),
        decided_at TEXT NOT NULL
      );
    `);
  }

  public append(envelope: ContributionEnvelope): StoredContribution {
    this.assertOpen();
    const id = `contrib_${crypto.randomUUID()}`;
    const receivedAt = this.now();
    this.database.prepare(`
      INSERT INTO contributions (
        id, road_id, span_id, kind, observed_at, gps_precision_m,
        value_json, contributor_pseudo_id, client_version, evidence_level,
        envelope_json, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      envelope.roadRef.roadId,
      envelope.roadRef.spanId,
      envelope.kind,
      envelope.observedAt,
      envelope.gps_precision_m,
      JSON.stringify(envelope.value),
      envelope.provenance.contributorPseudoId,
      envelope.provenance.clientVersion,
      envelope.provenance.evidenceLevel,
      JSON.stringify(envelope),
      receivedAt,
    );
    return {
      id,
      envelope,
      reporter: reporterIdentityFor(envelope),
      receivedAt,
      state: "pending",
      decidedAt: null,
    };
  }

  public find(id: string): StoredContribution | null {
    this.assertOpen();
    const row = this.database.prepare(`${SELECT_CONTRIBUTION} WHERE c.id = ?`).get(id) as
      | ContributionRow
      | undefined;
    return row === undefined ? null : toRecord(row);
  }

  /**
   * Appends one decision to the decision log, stamped with the server clock.
   * The primary key is a hard backstop: a second decision for the same record
   * cannot be stored at all.
   */
  public recordDecision(
    id: string,
    decision: ContributionModerationDecision,
  ): StoredContribution | null {
    this.assertOpen();
    const existing = this.find(id);
    if (existing === null) return null;
    const decidedAt = this.now();
    this.database.prepare(`
      INSERT INTO contribution_moderation (id, decision, decided_at) VALUES (?, ?, ?)
    `).run(id, decision, decidedAt);
    return {
      ...existing,
      state: decision === "accept" ? "accepted" : "rejected",
      decidedAt,
    };
  }

  public listPending(limit: number): readonly StoredContribution[] {
    this.assertOpen();
    const bounded = boundedLimit(limit);
    if (bounded === 0) return [];
    const rows = this.database.prepare(`
      ${SELECT_CONTRIBUTION}
      WHERE m.id IS NULL
      ORDER BY c.received_at DESC, c.id DESC
      LIMIT ?
    `).all(bounded) as unknown as readonly ContributionRow[];
    return rows.map(toRecord);
  }

  public pendingCount(): number {
    this.assertOpen();
    const row = this.database.prepare(`
      SELECT COUNT(*) AS pending FROM contributions c
      LEFT JOIN contribution_moderation m ON m.id = c.id
      WHERE m.id IS NULL
    `).get() as { pending: number };
    return row.pending;
  }

  public pendingCountFor(pseudoId: string): number {
    this.assertOpen();
    const row = this.database.prepare(`
      SELECT COUNT(*) AS pending FROM contributions c
      LEFT JOIN contribution_moderation m ON m.id = c.id
      WHERE m.id IS NULL AND c.contributor_pseudo_id = ?
    `).get(pseudoId) as { pending: number };
    return row.pending;
  }

  public recentSubmissionCount(pseudoId: string, windowMs: number): number {
    this.assertOpen();
    const boundedWindowMs = Number.isFinite(windowMs) ? Math.max(0, Math.trunc(windowMs)) : 0;
    const since = new Date(Date.parse(this.now()) - boundedWindowMs).toISOString();
    const row = this.database.prepare(`
      SELECT COUNT(*) AS recent FROM contributions
      WHERE contributor_pseudo_id = ? AND received_at >= ?
    `).get(pseudoId, since) as { recent: number };
    return row.recent;
  }

  public list(
    roadRef: ContributionRoadRef,
    limit = CONTRIBUTION_STORE_MAX_RESULTS,
  ): readonly StoredContribution[] {
    this.assertOpen();
    const bounded = boundedLimit(limit);
    if (bounded === 0) return [];
    const rows = this.database.prepare(`
      ${SELECT_CONTRIBUTION}
      WHERE c.road_id = ? AND c.span_id = ?
      ORDER BY c.received_at DESC, c.id DESC
      LIMIT ?
    `).all(roadRef.roadId, roadRef.spanId, bounded) as unknown as readonly ContributionRow[];
    return rows.map(toRecord);
  }

  public close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Contribution store is closed");
  }
}

function toRecord(row: ContributionRow): StoredContribution {
  const envelope = JSON.parse(row.envelope_json) as ContributionEnvelope;
  const state: ContributionModerationState =
    row.decision === null ? "pending" : row.decision === "accept" ? "accepted" : "rejected";
  return {
    id: row.id,
    envelope,
    reporter: reporterIdentityFor(envelope),
    receivedAt: row.received_at,
    state,
    decidedAt: row.decided_at,
  };
}
