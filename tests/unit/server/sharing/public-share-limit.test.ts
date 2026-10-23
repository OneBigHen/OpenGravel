import { afterEach, describe, expect, it } from "vitest";

import { handlePublishShareRequest } from "@/app/api/shares/route";
import { newShareId, newShareToken } from "@/domain/sharing/ids";
import { defaultPrivacyTrim } from "@/domain/sharing/privacy";
import { buildShareSnapshot } from "@/domain/sharing/snapshot";
import type { ShareRecord } from "@/application/sharing/ports/share-repository";
import { SQLitePublicShareStore } from "@/server/sharing/public-share-store";

/**
 * One address cannot spend the site's share budget. The publish route used to
 * accept any number of snapshots from one page: the only limits were the
 * same-origin check (satisfiable by a script) and the store's site-wide budget,
 * so sixty posts from one address refused every rider for the rest of the hour.
 */

const stores: SQLitePublicShareStore[] = [];
/** A documentation address per test, so module-level budgets do not leak. */
const ADDRESS = "203.0.113.42";

function store(): SQLitePublicShareStore {
  const created = new SQLitePublicShareStore(":memory:");
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

function publishRequest(address: string): Request {
  return new Request("https://opengravel.test/api/shares", {
    method: "POST",
    headers: {
      origin: "https://opengravel.test",
      "content-type": "application/json",
      "x-real-ip": address,
    },
    body: JSON.stringify(record()),
  });
}

afterEach(() => {
  for (const created of stores.splice(0)) created.close();
});

describe("share creation is metered per client address", () => {
  it("answers the eleventh link from one address with 429 and a retry-after", async () => {
    const target = store();
    for (let index = 0; index < 10; index += 1) {
      const response = await handlePublishShareRequest(publishRequest(ADDRESS), target);
      expect(response.status, `link ${index + 1}`).toBe(201);
    }

    const overflow = await handlePublishShareRequest(publishRequest(ADDRESS), target);
    expect(overflow.status).toBe(429);
    expect(overflow.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await overflow.json()).toMatchObject({ message: expect.stringMatching(/too many share links/i) });
  });

  it("does not spend another address's budget", async () => {
    const target = store();
    for (let index = 0; index < 10; index += 1) {
      await handlePublishShareRequest(publishRequest("198.51.100.17"), target);
    }
    expect((await handlePublishShareRequest(publishRequest("198.51.100.17"), target)).status).toBe(429);
    expect((await handlePublishShareRequest(publishRequest("198.51.100.18"), target)).status).toBe(201);
  });
});
