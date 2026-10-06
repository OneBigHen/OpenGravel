import { mkdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Rider feedback (launch kit, 2026-09-28): what testers found broken or
 * confusing, kept on the server for the owner. No account, no device id; the
 * client address is only ever stored as a hash salted per process, and only
 * to cap how often one address can write.
 */

export const FEEDBACK_WRITE_LIMIT = 5;
export const FEEDBACK_WINDOW_MS = 10 * 60_000;
export const FEEDBACK_MESSAGE_MAX = 2_000;
export const FEEDBACK_CONTACT_MAX = 200;
export const FEEDBACK_PAGE_MAX = 200;

export const DEFAULT_FEEDBACK_DATABASE_PATH = process.env.OGV_FEEDBACK_DB_PATH
  ?? path.join(process.cwd(), "data", "feedback.sqlite");

export interface FeedbackEntry {
  readonly message: string;
  readonly contact: string | null;
  readonly page: string | null;
  readonly userAgent: string | null;
}

export interface StoredFeedback extends FeedbackEntry {
  readonly id: number;
  readonly createdAt: string;
}

export interface FeedbackStoreOptions {
  readonly now?: () => Date;
}

export class SQLiteFeedbackStore {
  private readonly database: DatabaseSync;
  private readonly now: () => Date;
  private readonly salt = randomBytes(32).toString("hex");

  public constructor(filePath: string = DEFAULT_FEEDBACK_DATABASE_PATH, options: FeedbackStoreOptions = {}) {
    if (filePath !== ":memory:") mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    this.database = new DatabaseSync(filePath);
    this.now = options.now ?? (() => new Date());
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        message TEXT NOT NULL,
        contact TEXT,
        page TEXT,
        user_agent TEXT,
        client_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS feedback_by_client ON feedback(client_hash, created_at DESC);
    `);
  }

  /** Stores one entry, or returns `null` when this address is over its budget. */
  public add(entry: FeedbackEntry, clientIp: string): StoredFeedback | null {
    const now = this.now();
    const clientHash = createHash("sha256").update(`${this.salt}:${clientIp}`).digest("hex");
    const since = new Date(now.getTime() - FEEDBACK_WINDOW_MS).toISOString();
    const { count } = this.database
      .prepare("SELECT COUNT(*) AS count FROM feedback WHERE client_hash = ? AND created_at > ?")
      .get(clientHash, since) as { readonly count: number };
    if (count >= FEEDBACK_WRITE_LIMIT) return null;
    const createdAt = now.toISOString();
    const result = this.database
      .prepare("INSERT INTO feedback(created_at, message, contact, page, user_agent, client_hash) VALUES (?, ?, ?, ?, ?, ?)")
      .run(createdAt, entry.message, entry.contact, entry.page, entry.userAgent, clientHash);
    return { ...entry, id: Number(result.lastInsertRowid), createdAt };
  }

  /** Newest first, for the owner's reader script. */
  public list(limit = 100): readonly StoredFeedback[] {
    const rows = this.database
      .prepare("SELECT id, created_at, message, contact, page, user_agent FROM feedback ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as readonly {
        readonly id: number;
        readonly created_at: string;
        readonly message: string;
        readonly contact: string | null;
        readonly page: string | null;
        readonly user_agent: string | null;
      }[];
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      message: row.message,
      contact: row.contact,
      page: row.page,
      userAgent: row.user_agent,
    }));
  }
}

export interface FeedbackResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

/** Validates one submission and stores it. Pure over its store. */
export function handleFeedbackPost(
  body: unknown,
  store: Pick<SQLiteFeedbackStore, "add">,
  clientIp: string,
  userAgent: string | null,
  onStored?: (entry: FeedbackEntry) => void,
): FeedbackResult {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const message = text(record.message, FEEDBACK_MESSAGE_MAX);
  if (message === null || message.length < 3) {
    return { status: 400, body: { error: "Write a few words about what happened." } };
  }
  const entry: FeedbackEntry = {
    message,
    contact: text(record.contact, FEEDBACK_CONTACT_MAX),
    page: text(record.page, FEEDBACK_PAGE_MAX),
    userAgent: userAgent === null ? null : userAgent.slice(0, 300),
  };
  const stored = store.add(entry, clientIp);
  if (stored === null) {
    return { status: 429, body: { error: "Thanks — that's a lot of feedback at once. Try again in a few minutes." } };
  }
  onStored?.(entry);
  return { status: 201, body: { ok: true } };
}
