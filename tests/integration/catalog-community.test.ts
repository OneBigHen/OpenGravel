import { afterAll, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { submitContributionForModeration, decideContribution } from "@/application/contributions/moderation";
import { handleCatalogCommunityGet, handleCatalogCommunityPost } from "@/server/contributions/catalog-community";
import { SQLiteCatalogCommunityStore } from "@/server/contributions/catalog-community-store";
import { SQLiteContributionStore } from "@/server/contributions/store";
import { clientIpFromForwardedFor } from "@/server/contributions/catalog-community";

const deviceId = "24aaea11-a117-4d55-85de-56590a593e77";
const NOW = "2026-09-24T12:00:00.000Z";
const store = new SQLiteCatalogCommunityStore(":memory:", { now: () => NOW });
let contributions = new SQLiteContributionStore(":memory:", { now: () => NOW });
const dependencies = () => ({ store, contributions });

afterEach(() => {
  store.clearForTest();
  contributions.close();
  contributions = new SQLiteContributionStore(":memory:", { now: () => NOW });
});
afterAll(() => {
  store.close();
  contributions.close();
});

describe("catalog route community", () => {
  it("persists and aggregates ratings for the route", async () => {
    const rating = await handleCatalogCommunityPost("route-1", { kind: "rating", rating: 5, deviceId }, dependencies());
    const result = await handleCatalogCommunityGet("route-1", dependencies());

    expect(rating.status).toBe(201);
    expect(result.body).toMatchObject({ ratingAverage: 5, ratingCount: 1, comments: [] });
  });

  it("rejects invalid ratings, unmoderated comments and malformed route ids", async () => {
    expect((await handleCatalogCommunityPost("route-1", { kind: "rating", rating: 6, deviceId }, dependencies())).status).toBe(400);
    expect((await handleCatalogCommunityPost("route-1", { kind: "comment", text: "Fresh gravel.", deviceId }, dependencies())).status).toBe(400);
    expect((await handleCatalogCommunityGet("../other", dependencies())).status).toBe(400);
  });

  it("rate limits rating writes by device", async () => {
    for (let index = 0; index < 10; index += 1) {
      expect((await handleCatalogCommunityPost("route-1", { kind: "rating", rating: (index % 5) + 1, deviceId }, dependencies())).status).toBe(201);
    }
    expect((await handleCatalogCommunityPost("route-1", { kind: "rating", rating: 3, deviceId }, dependencies())).status).toBe(429);
  });

  it("rate limits rotated device ids by the first forwarded client IP", async () => {
    const ip = clientIpFromForwardedFor("203.0.113.18, 10.0.0.2");
    expect(ip).toBe("203.0.113.18");
    expect(clientIpFromForwardedFor(null)).toBe("unknown-client");
    for (let index = 1; index <= 10; index += 1) {
      const rotatedId = `24aaea11-a117-4d55-85de-${index.toString(16).padStart(12, "0")}`;
      expect((await handleCatalogCommunityPost("route-1", { kind: "rating", rating: 5, deviceId: rotatedId }, { ...dependencies(), clientIp: ip })).status).toBe(201);
    }
    const lastRotatedId = "24aaea11-a117-4d55-85de-000000000011";
    expect((await handleCatalogCommunityPost("route-1", { kind: "rating", rating: 5, deviceId: lastRotatedId }, { ...dependencies(), clientIp: ip })).status).toBe(429);
    expect((await handleCatalogCommunityPost("route-1", { kind: "rating", rating: 5, deviceId: lastRotatedId }, { ...dependencies(), clientIp: "203.0.113.19" })).status).toBe(201);
  });

  it("stores only a daily salted IP hash in community write records", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "ogv-community-ip-"));
    const filename = path.join(directory, "community.sqlite");
    let now = "2026-09-24T23:57:00.000Z";
    const fileStore = new SQLiteCatalogCommunityStore(filename, { now: () => now });
    fileStore.recordRating("route-hash", deviceId, 4, "203.0.113.45");
    now = "2026-09-25T00:03:00.000Z";
    fileStore.recordRating("route-next-day", "24aaea11-a117-4d55-85de-000000000012", 5, "203.0.113.45");
    fileStore.close();
    const database = new DatabaseSync(filename);
    const rows = database.prepare("SELECT client_ip_hash AS hash, client_ip_day AS day FROM catalog_community_writes ORDER BY client_ip_day").all() as unknown as readonly { readonly hash: string; readonly day: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.day)).toEqual(["2026-09-24", "2026-09-25"]);
    expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.hash))).toBe(true);
    expect(rows.every((row) => !row.hash.includes("203.0.113.45"))).toBe(true);
    expect(rows[0]?.hash).not.toBe(rows[1]?.hash);
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("adds IP hash columns to an existing community database without dropping its records", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "ogv-community-migration-"));
    const filename = path.join(directory, "community.sqlite");
    const oldDatabase = new DatabaseSync(filename);
    oldDatabase.exec(`
      CREATE TABLE catalog_route_ratings (route_id TEXT NOT NULL, device_id TEXT NOT NULL, rating INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (route_id, device_id));
      CREATE TABLE catalog_community_writes (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, written_at TEXT NOT NULL);
      INSERT INTO catalog_community_writes(device_id, written_at) VALUES ('existing-device', '${NOW}');
    `);
    oldDatabase.close();

    const migrated = new SQLiteCatalogCommunityStore(filename, { now: () => NOW });
    expect(migrated.recordRating("route-migrated", deviceId, 4, "203.0.113.55")).not.toBeNull();
    migrated.close();
    const database = new DatabaseSync(filename);
    const count = database.prepare("SELECT COUNT(*) AS count FROM catalog_community_writes").get() as unknown as { readonly count: number };
    const columns = database.prepare("PRAGMA table_info(catalog_community_writes)").all() as unknown as readonly { readonly name: string }[];
    expect(count.count).toBe(2);
    expect(columns.map((column) => column.name)).toContain("client_ip_hash");
    expect(columns.map((column) => column.name)).toContain("client_ip_day");
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps comments hidden until the contribution moderation core accepts them", async () => {
    const submission = submitContributionForModeration(contributions, {
      kind: "condition",
      roadRef: { roadId: "road_route-1", spanId: "span_route-1" },
      observedAt: NOW,
      gps_precision_m: 1000,
      value: { tag: "comment", severity: "minor", note: "Fresh gravel near the lake." },
      provenance: { contributorPseudoId: deviceId, clientVersion: "vnext-m7", evidenceLevel: "low" },
    }, { now: NOW });
    expect(submission.ok).toBe(true);

    expect((await handleCatalogCommunityGet("route-1", dependencies())).body).toMatchObject({ comments: [] });
    if (!submission.ok) throw new Error("Expected the contribution core to accept the comment");
    expect(decideContribution(contributions, submission.submission.id, "accept").ok).toBe(true);
    expect((await handleCatalogCommunityGet("route-1", dependencies())).body).toMatchObject({
      comments: [{ text: "Fresh gravel near the lake.", authorLabel: "Anonymous rider" }],
    });
  });
});
