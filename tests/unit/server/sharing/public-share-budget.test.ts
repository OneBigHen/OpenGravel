import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newShareId, newShareToken } from "@/domain/sharing/ids";
import { defaultPrivacyTrim } from "@/domain/sharing/privacy";
import { buildShareSnapshot } from "@/domain/sharing/snapshot";
import type { ShareRecord } from "@/application/sharing/ports/share-repository";
import { handlePublishShare, handleRevokeShare } from "@/server/sharing/public-share-handler";
import { SQLitePublicShareStore, type PublicShareStoreOptions } from "@/server/sharing/public-share-store";

/**
 * Public share budgets are per browser, capacity counts live links, and a link
 * older than the retention window is gone. The previous store counted every row
 * (revoked ones included) against one site-wide hourly budget and never deleted
 * anything, so a busy hour refused every other rider and 2000 ever-created links
 * refused everyone forever.
 */

const stores: SQLitePublicShareStore[] = [];
const clock = { time: 1_700_000_000_000 };

function store(options: PublicShareStoreOptions = {}): SQLitePublicShareStore {
  const created = new SQLitePublicShareStore(":memory:", { now: () => clock.time, ...options });
  stores.push(created);
  return created;
}

function record(): ShareRecord {
  return {
    shareId: newShareId(),
    token: newShareToken(),
    state: "active",
    createdAt: "2026-09-30T00:00:00.000Z",
    revokedAt: null,
    snapshot: buildShareSnapshot({
      sourceRevision: 1,
      title: "Synthetic public ride",
      route: { segments: [[{ lon: -75.4, lat: 40.1 }, { lon: -75.4, lat: 40.2 }, { lon: -75.4, lat: 40.3 }]] },
      summary: { distanceMeters: 22000, durationSeconds: 1800 },
      surface: { preference: "mostly-pavement", unknownSurfacePolicy: "allow-with-warning" },
      provenance: "new",
      authorPseudonym: null,
    }, defaultPrivacyTrim()),
  };
}

function publishRequest(body: unknown, cookie?: string): Request {
  return new Request("https://opengravel.test/api/shares", {
    method: "POST",
    headers: {
      origin: "https://opengravel.test",
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

interface Published {
  readonly record: ShareRecord;
  readonly response: Response;
  readonly cookie: string | null;
}

async function publish(target: SQLitePublicShareStore, cookie?: string): Promise<Published> {
  const share = record();
  const response = await handlePublishShare(publishRequest(share, cookie), target);
  return { record: share, response, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null };
}

function revokeRequest(shareId: string, cookie: string): Request {
  return new Request(`https://opengravel.test/api/shares/${shareId}`, {
    method: "DELETE",
    headers: { origin: "https://opengravel.test", cookie },
  });
}

beforeEach(() => {
  clock.time = 1_700_000_000_000;
});

afterEach(() => {
  for (const created of stores.splice(0)) created.close();
});

describe("public share hourly budget is per browser, not site-wide", () => {
  it("lets one browser spend its own hour without refusing another rider", async () => {
    const target = store({ perOwnerPerHour: 2, capacity: 1000 });
    const first = await publish(target);
    expect(first.response.status).toBe(201);
    expect((await publish(target, first.cookie ?? undefined)).response.status).toBe(201);

    const refused = await publish(target, first.cookie ?? undefined);
    expect(refused.response.status).toBe(429);
    expect(refused.response.headers.get("retry-after")).not.toBeNull();
    const body = await refused.response.json() as { message: string };
    expect(body.message).toMatch(/this browser/i);
    expect(body.message).not.toMatch(/temporarily/i);

    // A different browser in the same hour is unaffected.
    expect((await publish(target)).response.status).toBe(201);
  });
});

describe("public share capacity counts live links only", () => {
  it("frees a slot when the owner revokes a link", async () => {
    const target = store({ capacity: 2, perOwnerPerHour: 60 });
    const first = await publish(target);
    expect(first.response.status).toBe(201);
    const second = await publish(target, first.cookie ?? undefined);
    expect(second.response.status).toBe(201);

    const full = await publish(target);
    expect(full.response.status).toBe(429);
    const body = await full.response.json() as { message: string };
    expect(body.message).not.toMatch(/temporarily/i);

    const revoked = await handleRevokeShare(revokeRequest(first.record.shareId, first.cookie ?? ""), first.record.shareId, target);
    expect(revoked.status).toBe(200);

    expect((await publish(target)).response.status).toBe(201);
  });
});

describe("public share retention", () => {
  it("drops a link past the retention window instead of counting it forever", async () => {
    const target = store({ capacity: 1, perOwnerPerHour: 60, retentionMs: 60_000 });
    const first = await publish(target);
    expect(first.response.status).toBe(201);
    expect(target.resolve(first.record.token).state).toBe("active");

    clock.time += 60_001;
    expect(target.resolve(first.record.token).state).toBe("not-found");
    expect((await publish(target)).response.status).toBe(201);
  });
});
