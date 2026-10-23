/**
 * The rider's side of "Follow my ride": start a live link, stream positions to
 * it while riding, raise or clear an alert, and end it. Positions are buffered
 * and sent in batches every `LIVE_SEND_INTERVAL_MS`, so a dead zone only delays
 * them; the buffer survives a reload through the injected storage, as do the
 * link's credentials, so a ride that reloads keeps the same link.
 *
 * Everything outside is injected (fetch, clock, timers, storage, battery), so
 * the whole flow runs in a test without a network or a minute of waiting.
 */

import type { LiveAlertReason, LivePoint, LiveRouteGeometry } from "@/domain/live/types";

/** How often buffered positions go out. The server accepts one call per 3 s. */
export const LIVE_SEND_INTERVAL_MS = 10_000;
/** Points per call; the server takes at most 120. */
export const LIVE_BATCH_POINTS = 100;
/** Positions kept while offline; the oldest go first beyond this. */
export const LIVE_BUFFER_MAX = 2_000;
/** Closer than this in time to the previous buffered point, a fix is skipped. */
export const LIVE_MIN_POINT_GAP_MS = 2_000;

export type LiveShareStatus = "off" | "starting" | "sharing" | "error";

export interface LiveShareSnapshot {
  readonly status: LiveShareStatus;
  /** The link to send; `null` until the server made one. */
  readonly followUrl: string | null;
  /** The alert followers currently see, if any. */
  readonly alert: LiveAlertReason | null;
  /** When positions last reached the server (epoch ms). */
  readonly lastSentAt: number | null;
  /** Positions waiting to be sent (non-zero in a dead zone). */
  readonly pending: number;
  readonly error: string | null;
}

interface Credentials {
  readonly rideId: string;
  readonly ownerSecret: string;
  readonly followUrl: string;
}

export interface LiveShareStorage {
  read(): string | null;
  write(value: string | null): void;
}

export interface LiveShareDeps {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly setInterval: (work: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
  readonly storage?: LiveShareStorage;
  /** Battery as 0..1, or null when the device does not say. */
  readonly battery?: () => number | null;
}

export interface LiveShareSession {
  snapshot(): LiveShareSnapshot;
  subscribe(listener: (snapshot: LiveShareSnapshot) => void): () => void;
  /** Creates the link (or resumes a stored one). Resolves to the follow URL. */
  start(input: { readonly riderName: string; readonly route?: LiveRouteGeometry | null }): Promise<string | null>;
  /** One position from the ride's GPS. Ignored unless sharing. */
  accept(fix: { readonly atMs: number; readonly lat: number; readonly lon: number; readonly speedMps: number | null; readonly headingDeg: number | null; readonly accuracyM: number | null }): void;
  /** Tells followers something is wrong, now. */
  raiseAlert(reason: LiveAlertReason): Promise<void>;
  /** The rider is OK after an alert went out. */
  clearAlert(): Promise<void>;
  /** Sends what is left, marks the ride finished and forgets the link. */
  finish(): Promise<void>;
  /** Stops timers without ending the ride (screen teardown). */
  dispose(): void;
}

const EMPTY: LiveShareSnapshot = { status: "off", followUrl: null, alert: null, lastSentAt: null, pending: 0, error: null };

interface Stored {
  readonly credentials: Credentials;
  readonly buffer: readonly LivePoint[];
  readonly alert: LiveAlertReason | null;
}

function parseStored(raw: string | null): Stored | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<Stored>;
    const credentials = value.credentials;
    if (credentials === undefined || typeof credentials.rideId !== "string" || typeof credentials.ownerSecret !== "string" || typeof credentials.followUrl !== "string") return null;
    return { credentials, buffer: Array.isArray(value.buffer) ? value.buffer : [], alert: value.alert ?? null };
  } catch {
    return null;
  }
}

export function createLiveShareSession(deps: LiveShareDeps): LiveShareSession {
  let credentials: Credentials | null = null;
  let buffer: LivePoint[] = [];
  let state: LiveShareSnapshot = EMPTY;
  let timer: unknown = null;
  let sending = false;
  let lastBuffered = -Infinity;
  /** The newest position, kept to carry an alert when nothing new is buffered. */
  let lastPoint: LivePoint | null = null;
  const listeners = new Set<(snapshot: LiveShareSnapshot) => void>();

  function publish(patch: Partial<LiveShareSnapshot>): void {
    state = { ...state, ...patch, pending: buffer.length };
    for (const listener of listeners) listener(state);
  }

  function persist(): void {
    if (deps.storage === undefined) return;
    deps.storage.write(credentials === null ? null : JSON.stringify({ credentials, buffer: buffer.slice(-LIVE_BUFFER_MAX), alert: state.alert }));
  }

  function arm(): void {
    if (timer !== null) return;
    timer = deps.setInterval(() => { void send(); }, LIVE_SEND_INTERVAL_MS);
  }

  function disarm(): void {
    if (timer === null) return;
    deps.clearInterval(timer);
    timer = null;
  }

  async function post(path: string, body: unknown): Promise<Response | null> {
    if (credentials === null) return null;
    try {
      return await deps.fetch(`/api/live/${encodeURIComponent(credentials.rideId)}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-live-secret": credentials.ownerSecret },
        body: JSON.stringify(body),
      });
    } catch {
      return null;
    }
  }

  /** Sends one batch, with an alert change when there is one. */
  async function send(alert?: { readonly reason: LiveAlertReason } | null): Promise<boolean> {
    if (credentials === null || sending) return false;
    if (buffer.length === 0 && alert === undefined) return true;
    // A status change needs a point to carry it; the last known one will do.
    const batch = buffer.length > 0 ? buffer.slice(0, LIVE_BATCH_POINTS) : lastPoint === null ? [] : [lastPoint];
    if (batch.length === 0) return false;
    sending = true;
    try {
      const response = await post("/points", {
        points: batch,
        ...(alert === undefined ? {} : alert === null ? { alert: null } : { status: "alert", alert }),
      });
      if (response === null) {
        publish({ error: "No signal — positions will send when it returns." });
        return false;
      }
      if (response.status === 404 || response.status === 403) {
        // The link ended (expired or revoked): stop quietly.
        credentials = null;
        buffer = [];
        disarm();
        persist();
        publish({ status: "off", followUrl: null, alert: null, error: "The live link ended." });
        return false;
      }
      if (!response.ok) {
        publish({ error: response.status === 429 ? null : "Live sharing hit a problem; retrying." });
        return false;
      }
      if (buffer.length > 0) buffer = buffer.slice(batch.length);
      persist();
      publish({ lastSentAt: deps.now(), error: null });
      return true;
    } finally {
      sending = false;
    }
  }

  const stored = parseStored(deps.storage?.read() ?? null);
  if (stored !== null) {
    credentials = stored.credentials;
    buffer = [...stored.buffer];
    lastPoint = buffer.at(-1) ?? null;
    state = { ...EMPTY, status: "sharing", followUrl: stored.credentials.followUrl, alert: stored.alert, pending: buffer.length };
    arm();
  }

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start({ riderName, route = null }) {
      if (credentials !== null) return credentials.followUrl;
      publish({ status: "starting", error: null });
      try {
        const response = await deps.fetch("/api/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ riderName, ...(route === null ? {} : { route }) }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
          publish({ status: "error", error: body.message ?? body.error?.message ?? "Could not start live sharing." });
          return null;
        }
        const created = (await response.json()) as Partial<Credentials>;
        if (typeof created.rideId !== "string" || typeof created.ownerSecret !== "string" || typeof created.followUrl !== "string") {
          publish({ status: "error", error: "Could not start live sharing." });
          return null;
        }
        credentials = { rideId: created.rideId, ownerSecret: created.ownerSecret, followUrl: created.followUrl };
        persist();
        arm();
        publish({ status: "sharing", followUrl: credentials.followUrl, error: null });
        return credentials.followUrl;
      } catch {
        publish({ status: "error", error: "No signal — try again in a moment." });
        return null;
      }
    },
    accept(fix) {
      if (credentials === null) return;
      if (fix.atMs - lastBuffered < LIVE_MIN_POINT_GAP_MS) return;
      lastBuffered = fix.atMs;
      const point: LivePoint = {
        t: Math.round(fix.atMs),
        lat: fix.lat,
        lon: fix.lon,
        speed: fix.speedMps,
        heading: fix.headingDeg,
        accuracy: fix.accuracyM,
        battery: deps.battery?.() ?? null,
      };
      lastPoint = point;
      buffer.push(point);
      if (buffer.length > LIVE_BUFFER_MAX) buffer = buffer.slice(-LIVE_BUFFER_MAX);
      if (buffer.length % 10 === 0) persist();
      publish({});
    },
    async raiseAlert(reason) {
      if (credentials === null) return;
      publish({ alert: reason });
      persist();
      // Try hard: an alert is the one message that must arrive.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await send({ reason })) return;
      }
    },
    async clearAlert() {
      if (credentials === null || state.alert === null) return;
      publish({ alert: null });
      persist();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await send(null)) return;
      }
    },
    async finish() {
      if (credentials === null) return;
      while (buffer.length > 0 && (await send())) { /* drain */ }
      await post("/finish", {});
      credentials = null;
      buffer = [];
      disarm();
      persist();
      publish({ ...EMPTY });
    },
    dispose() {
      disarm();
      listeners.clear();
    },
  };
}
