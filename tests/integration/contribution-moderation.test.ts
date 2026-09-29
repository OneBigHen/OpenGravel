import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  handleContributionGetRequest,
  handleContributionPostRequest,
} from "@/app/api/contributions/route";
import {
  handleContributionModerationDecideRequest as decideWithToken,
  handleContributionModerationGetRequest as getQueueWithToken,
} from "@/server/contributions/http";
import { SQLiteContributionStore } from "@/server/contributions/store";

const NOW = "2026-09-17T12:00:00.000Z";
const CONTRIBUTOR = "123e4567-e89b-42d3-a456-426614174000";
const MODERATION_TOKEN = "integration-test-moderation-token";

function handleContributionModerationGetRequest(request: Request, store: SQLiteContributionStore): Promise<Response> {
  return getQueueWithToken(request, store, MODERATION_TOKEN);
}

function handleContributionModerationDecideRequest(request: Request, store: SQLiteContributionStore): Promise<Response> {
  return decideWithToken(request, store, MODERATION_TOKEN);
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: "surface",
    roadRef: { roadId: "road_main", spanId: "span_main" },
    observedAt: NOW,
    gps_precision_m: 12,
    value: "maintained-gravel",
    provenance: {
      contributorPseudoId: CONTRIBUTOR,
      clientVersion: "0.1.0",
      evidenceLevel: "high",
    },
    ...overrides,
  });
}

function postRequest(payload: string): Request {
  return new Request("http://localhost/api/contributions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
  });
}

function decideRequest(id: string, decision: unknown): Request {
  return new Request("http://localhost/api/contributions/moderation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${MODERATION_TOKEN}`,
    },
    body: JSON.stringify({ id, decision }),
  });
}

function queueRequest(limit?: string): Request {
  const query = limit === undefined ? "" : `?limit=${limit}`;
  return new Request(`http://localhost/api/contributions/moderation${query}`, {
    headers: { authorization: `Bearer ${MODERATION_TOKEN}` },
  });
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDatabasePath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ogv-moderation-"));
  tempDirs.push(directory);
  return path.join(directory, "contributions.sqlite");
}

describe("contribution moderation over the validated submission foundation", () => {
  it("keeps submissions pending in a bounded queue with reporter identity only", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const posted = await handleContributionPostRequest(postRequest(body()), store);
    const queue = await handleContributionModerationGetRequest(queueRequest(), store);

    expect(posted.status).toBe(201);
    expect(queue.status).toBe(200);
    const queueBody = await queue.json() as { queue: { state: string; decidedAt: string | null; reporter: Record<string, unknown> }[] };
    expect(queueBody.queue).toHaveLength(1);
    expect(queueBody.queue[0]).toMatchObject({
      state: "pending",
      decidedAt: null,
      reporter: { pseudoId: CONTRIBUTOR },
    });
    expect(Object.keys(queueBody.queue[0]!.reporter)).toEqual(["pseudoId"]);
    store.close();
  });

  it("records an explicit accept decision and projects the accepted state", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const posted = await handleContributionPostRequest(postRequest(body()), store);
    const { id } = await posted.json() as { id: string };

    const decided = await handleContributionModerationDecideRequest(decideRequest(id, "accept"), store);
    const queue = await handleContributionModerationGetRequest(queueRequest(), store);
    const listed = await handleContributionGetRequest(
      new Request("http://localhost/api/contributions?roadRef=road_main%2Fspan_main"),
      store,
    );

    expect(decided.status).toBe(200);
    expect(await decided.json()).toMatchObject({
      contribution: { id, state: "accepted", decidedAt: NOW },
    });
    expect((await queue.json()) as { queue: unknown[] }).toMatchObject({ queue: [] });
    expect((await listed.json()) as { contributions: unknown[] }).toMatchObject({
      contributions: [expect.objectContaining({ id, state: "accepted" })],
    });
    store.close();
  });

  it("refuses to silently reopen a terminal decision and keeps the first state", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const posted = await handleContributionPostRequest(postRequest(body()), store);
    const { id } = await posted.json() as { id: string };
    await handleContributionModerationDecideRequest(decideRequest(id, "accept"), store);

    const reopened = await handleContributionModerationDecideRequest(decideRequest(id, "reject"), store);
    const repeated = await handleContributionModerationDecideRequest(decideRequest(id, "accept"), store);
    const listed = await handleContributionGetRequest(
      new Request("http://localhost/api/contributions?roadRef=road_main%2Fspan_main"),
      store,
    );

    for (const response of [reopened, repeated]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "conflict", details: { reason: "already-decided" } },
      });
    }
    expect((await listed.json()) as { contributions: unknown[] }).toMatchObject({
      contributions: [expect.objectContaining({ id, state: "accepted" })],
    });
    store.close();
  });

  it("returns honest typed failures for unknown ids, bad decisions, and bad bodies", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const posted = await handleContributionPostRequest(postRequest(body()), store);
    const { id } = await posted.json() as { id: string };

    const unknown = await handleContributionModerationDecideRequest(
      decideRequest("contrib_missing", "accept"),
      store,
    );
    const badDecision = await handleContributionModerationDecideRequest(
      decideRequest(id, "maybe"),
      store,
    );
    const badBody = await handleContributionModerationDecideRequest(
      new Request("http://localhost/api/contributions/moderation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${MODERATION_TOKEN}`,
        },
        body: JSON.stringify({ decision: "accept" }),
      }),
      store,
    );

    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "not-found" } });
    expect(badDecision.status).toBe(400);
    expect(await badDecision.json()).toMatchObject({
      error: { code: "validation", details: { reason: "invalid-decision" } },
    });
    expect(badBody.status).toBe(400);
    expect(await badBody.json()).toMatchObject({ error: { code: "validation" } });
    store.close();
  });

  it("enforces the reporter pending cap at the server boundary", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    let last: Response | undefined;
    for (let index = 0; index < 16; index++) {
      last = await handleContributionPostRequest(postRequest(body()), store);
    }

    expect(last?.status).toBe(429);
    expect(await last?.json()).toMatchObject({
      error: { code: "abuse", details: { reason: "reporter-pending-cap" } },
    });
    store.close();
  });

  it("enforces the reporter rate bound even when earlier reports were decided", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    for (let index = 0; index < 30; index++) {
      const posted = await handleContributionPostRequest(postRequest(body()), store);
      const { id } = await posted.json() as { id: string };
      const decided = await handleContributionModerationDecideRequest(
        decideRequest(id, index % 2 === 0 ? "accept" : "reject"),
        store,
      );
      expect(decided.status).toBe(200);
    }

    const overflow = await handleContributionPostRequest(postRequest(body()), store);

    expect(overflow.status).toBe(429);
    expect(await overflow.json()).toMatchObject({
      error: { code: "abuse", details: { reason: "reporter-rate-exceeded" } },
    });
    store.close();
  });

  it("clamps the moderation queue listing to its bound", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const queue = await handleContributionModerationGetRequest(queueRequest("1000"), store);

    expect(queue.status).toBe(200);
    expect(await queue.json()).toMatchObject({ queue: [], limit: 100 });
    store.close();
  });

  it("persists decisions across reopen while the contributions table stays append-only", async () => {
    const filePath = await tempDatabasePath();
    const store = new SQLiteContributionStore(filePath, { now: () => NOW });
    const posted = await handleContributionPostRequest(postRequest(body()), store);
    const { id } = await posted.json() as { id: string };
    await handleContributionModerationDecideRequest(decideRequest(id, "accept"), store);
    store.close();

    const reopened = new SQLiteContributionStore(filePath, { now: () => NOW });
    const listed = await handleContributionGetRequest(
      new Request("http://localhost/api/contributions?roadRef=road_main%2Fspan_main"),
      reopened,
    );
    expect((await listed.json()) as { contributions: unknown[] }).toMatchObject({
      contributions: [expect.objectContaining({ id, state: "accepted", decidedAt: NOW })],
    });
    reopened.close();

    const database = new DatabaseSync(filePath);
    const contributionColumns = (database.prepare("SELECT name FROM pragma_table_info('contributions')").all() as { name: string }[])
      .map((row) => row.name);
    const decisionRow = database.prepare("SELECT id, decision, decided_at FROM contribution_moderation WHERE id = ?").get(id) as Record<string, unknown>;
    database.close();
    expect(contributionColumns).not.toContain("moderation_state");
    expect(contributionColumns).not.toContain("decided_at");
    expect(decisionRow).toEqual({ id, decision: "accept", decided_at: NOW });
  });
});
