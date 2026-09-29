import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseContribution, type ContributionEnvelope } from "@/domain/contributions";
import { asRoadEntityId, asRoadSpanId } from "@/domain/ride/ids";
import {
  handleContributionGet,
  handleContributionPost,
} from "@/server/contributions/handler";
import {
  handleContributionGetRequest,
  handleContributionPostRequest,
  MAX_CONTRIBUTION_BODY_BYTES,
} from "@/app/api/contributions/route";
import { SQLiteContributionStore } from "@/server/contributions/store";

const NOW = "2026-09-17T12:00:00.000Z";

function envelope(overrides: Record<string, unknown> = {}): ContributionEnvelope {
  const parsed = parseContribution({
    kind: "surface",
    roadRef: { roadId: "road_main", spanId: "span_main" },
    observedAt: NOW,
    gps_precision_m: 12,
    value: "maintained-gravel",
    provenance: {
      contributorPseudoId: "123e4567-e89b-42d3-a456-426614174000",
      clientVersion: "0.1.0",
      evidenceLevel: "high",
    },
    ...overrides,
  }, { now: NOW });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDatabasePath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ogv-contributions-"));
  tempDirs.push(directory);
  return path.join(directory, "contributions.sqlite");
}

describe("SQLite contribution store", () => {
  it("round-trips an envelope, creates an inspectable SQLite file, and bounds road reads", async () => {
    const filePath = await tempDatabasePath();
    const store = new SQLiteContributionStore(filePath, { now: () => NOW });
    const first = store.append(envelope());
    store.append(envelope({ roadRef: { roadId: asRoadEntityId("road_other"), spanId: asRoadSpanId("span_other") } }));

    expect(first.id).toMatch(/^contrib_/);
    expect(existsSync(filePath)).toBe(true);
    expect(store.list({ roadId: asRoadEntityId("road_main"), spanId: asRoadSpanId("span_main") }, 10)).toEqual([
      expect.objectContaining({ id: first.id, envelope: envelope() }),
    ]);
    expect(store.list({ roadId: asRoadEntityId("road_main"), spanId: asRoadSpanId("span_main") }, 0)).toEqual([]);

    const db = new DatabaseSync(filePath);
    const schema = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'contributions'").get();
    const row = db.prepare("SELECT road_id, span_id, kind, value_json FROM contributions WHERE id = ?").get(first.id) as Record<string, unknown>;
    db.close();
    expect(schema).toEqual({ name: "contributions" });
    expect(row).toMatchObject({ road_id: "road_main", span_id: "span_main", kind: "surface" });
    expect(JSON.parse(row.value_json as string)).toBe("maintained-gravel");
    await expect(readFile(filePath)).resolves.toBeInstanceOf(Buffer);
    store.close();
  });
});

describe("contribution HTTP handlers", () => {
  it("round-trips through the Request/Response boundary", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const post = await handleContributionPostRequest(
      new Request("http://localhost/api/contributions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope()),
      }),
      store,
    );
    const get = await handleContributionGetRequest(
      new Request("http://localhost/api/contributions?roadRef=road_main%2Fspan_main"),
      store,
    );

    expect(post.status).toBe(201);
    expect((await post.json())).toMatchObject({ id: expect.stringMatching(/^contrib_/) });
    expect(get.status).toBe(200);
    expect((await get.json())).toMatchObject({ contributions: [expect.objectContaining({ envelope: envelope() })] });
    store.close();
  });

  it("returns a typed 4xx for malformed JSON at the Request/Response boundary", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const response = await handleContributionPostRequest(
      new Request("http://localhost/api/contributions", { method: "POST", body: "{not-json" }),
      store,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "validation" } });
    store.close();
  });

  it("caps a streamed body even when its length is not declared", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const response = await handleContributionPostRequest(
      new Request("http://localhost/api/contributions", {
        method: "POST",
        body: "x".repeat(MAX_CONTRIBUTION_BODY_BYTES + 1),
      }),
      store,
    );

    expect(response.status).toBe(413);
    store.close();
  });

  it("does POST -> GET round-trip with a real validated envelope", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const posted = await handleContributionPost(envelope(), { store, now: () => NOW });
    expect(posted.status).toBe(201);
    expect(posted.body).toMatchObject({ contribution: { kind: "surface", roadRef: { roadId: "road_main", spanId: "span_main" } } });

    const listed = await handleContributionGet({ roadRef: "road_main/span_main" }, { store });
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ contributions: [expect.objectContaining({ envelope: envelope() })] });
    store.close();
  });

  it("returns typed 4xx validation errors for malformed POST bodies", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const result = await handleContributionPost({ kind: "surface", value: "paved" }, { store, now: () => NOW });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "validation",
        details: { issues: expect.arrayContaining([expect.objectContaining({ field: "roadRef" })]) },
      },
    });
    store.close();
  });

  it("rejects unbounded or malformed GET road references", async () => {
    const store = new SQLiteContributionStore(":memory:", { now: () => NOW });
    const missing = await handleContributionGet({}, { store });
    const malformed = await handleContributionGet({ roadRef: "road_main".repeat(100) }, { store });

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    store.close();
  });
});
