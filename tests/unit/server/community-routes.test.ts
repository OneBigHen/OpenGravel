import { describe, expect, it, vi } from "vitest";

import { notifyRouteRemoved, restoreUrl, validRestoreSignature } from "@/server/community-routes/notify";
import { buildSharedRoute, cleanReason } from "@/server/community-routes/share";
import { CommunityRouteStore } from "@/server/community-routes/store";

const line = Array.from({ length: 50 }, (_v, index) => [-75.2 + index * 0.003, 40.1 + index * 0.002]);
const NOW = new Date("2026-10-05T12:00:00Z");

describe("buildSharedRoute", () => {
  it("builds a catalog entry from a name and a line", () => {
    const built = buildSharedRoute({ name: "  Hawk   Mountain loop ", geometry: line }, NOW);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.id).toMatch(/^community_/);
    expect(built.raw["name"]).toBe("Hawk Mountain loop");
    expect(built.raw["distanceKm"]).toBeGreaterThan(5);
    expect((built.raw["previewGeometry"] as unknown[]).length).toBeLessThanOrEqual(80);
  });

  it("refuses unreadable, tiny or unnamed routes", () => {
    expect(buildSharedRoute({ name: "", geometry: line }, NOW).ok).toBe(false);
    expect(buildSharedRoute({ name: "x", geometry: [[0, 0]] }, NOW).ok).toBe(false);
    expect(buildSharedRoute({ name: "x", geometry: [[0, 0], [0.0001, 0.0001]] }, NOW).ok).toBe(false);
    expect(buildSharedRoute({ name: "x", geometry: [[500, 0], [1, 1]] }, NOW).ok).toBe(false);
    expect(buildSharedRoute(null, NOW).ok).toBe(false);
  });

  it("trims a removal reason", () => {
    expect(cleanReason("  mine  ")).toBe("mine");
    expect(cleanReason(42)).toBe("");
    expect(cleanReason("a".repeat(900)).length).toBe(500);
  });
});

describe("CommunityRouteStore", () => {
  it("hides a route on removal and brings it back on restore, logging both", () => {
    const store = new CommunityRouteStore(":memory:");
    const before = store.version();
    expect(store.remove("route_a", "not happy", "2026-10-05T12:00:00Z")).toBe(true);
    expect(store.remove("route_a", "again", "2026-10-05T12:01:00Z")).toBe(false);
    expect(store.removedIds().has("route_a")).toBe(true);
    expect(store.version()).not.toBe(before);
    expect(store.restore("route_a", "2026-10-05T13:00:00Z")).toBe(true);
    expect(store.restore("route_a", "2026-10-05T13:01:00Z")).toBe(false);
    expect(store.removedIds().size).toBe(0);
  });

  it("keeps shared routes", () => {
    const store = new CommunityRouteStore(":memory:");
    store.addRoute("community_x", { id: "community_x", name: "X" }, "2026-10-05T12:00:00Z");
    expect(store.routes().map((row) => row.id)).toEqual(["community_x"]);
  });
});

describe("removal email and restore link", () => {
  const env = { OGV_RESTORE_SECRET: "a-long-enough-secret-value", OGV_PUBLIC_ORIGIN: "https://example.test", RESEND_API_KEY: "re_test", OGV_NOTIFY_EMAIL: "owner@example.test" };

  it("signs and verifies a restore link", () => {
    const url = new URL(restoreUrl("route_a", "2026-10-05T12:00:00Z", env)!);
    const sig = url.searchParams.get("sig")!;
    expect(validRestoreSignature("route_a", "2026-10-05T12:00:00Z", sig, env)).toBe(true);
    expect(validRestoreSignature("route_b", "2026-10-05T12:00:00Z", sig, env)).toBe(false);
    expect(validRestoreSignature("route_a", "2026-10-05T12:00:00Z", "0".repeat(sig.length), env)).toBe(false);
  });

  it("sends the owner the route, the reason and the restore link", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const sent = await notifyRouteRemoved({ routeId: "route_a", name: "Hawk <Mtn>", reason: "It is mine", removedAt: "2026-10-05T12:00:00Z" }, env, fetcher as unknown as typeof fetch);
    expect(sent).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body)) as { to: string[]; text: string; html: string; subject: string };
    expect(body.to).toEqual(["owner@example.test"]);
    expect(body.text).toContain("It is mine");
    expect(body.text).toContain("/api/community/restore?");
    expect(body.html).toContain("Hawk &lt;Mtn&gt;");
  });

  it("does nothing without a key and never throws on a mail outage", async () => {
    expect(await notifyRouteRemoved({ routeId: "r", name: "n", reason: "", removedAt: "t" }, {})).toBe(false);
    const failing = vi.fn(async () => { throw new Error("down"); });
    expect(await notifyRouteRemoved({ routeId: "r", name: "n", reason: "", removedAt: "t" }, env, failing as unknown as typeof fetch)).toBe(false);
  });
});

describe("owner mail", () => {
  it("is quiet without configuration", async () => {
    const { sendOwnerMail } = await import("@/server/mail/resend");
    expect(await sendOwnerMail({ subject: "s", text: "t", html: "h", event: "x" }, {})).toBe(false);
  });
});


describe("public route upload boundary", () => {
  it.each(["<script>alert(1)</script>", "Ride\u0000title", "Ride\u202etitle"])("rejects markup or control characters in a public name: %s", (name) => {
    expect(buildSharedRoute({ name, geometry: line }, NOW).ok).toBe(false);
  });

  it("rejects coordinate tuples carrying extra data", () => {
    expect(buildSharedRoute({ name: "Ride", geometry: line.map(([lon, lat]) => [lon, lat, "private"]) }, NOW).ok).toBe(false);
  });

  it("does not publish arbitrary metadata, file bytes, timestamps or client provenance", () => {
    const built = buildSharedRoute({ name: "Ride", geometry: line, authorEmail: "private", originalBytes: "bad", provenance: "verified" }, NOW);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(JSON.stringify(built.raw)).not.toMatch(/private|originalBytes|verified/);
  });
});

it("keeps bounded rider notes in the public story and rejects malformed notes", () => {
  const built = buildSharedRoute({ name: "Ride", geometry: line, description: "Fuel at the village.\nCheck seasonal closures." }, NOW);
  expect(built.ok).toBe(true);
  if (built.ok) expect(built.raw["story"]).toMatchObject({ description: "Fuel at the village.\nCheck seasonal closures.", comments: [], stops: [] });
  expect(buildSharedRoute({ name: "Ride", geometry: line, description: "x".repeat(2001) }, NOW).ok).toBe(false);
  expect(buildSharedRoute({ name: "Ride", geometry: line, description: "<script>bad</script>" }, NOW).ok).toBe(false);
});

it("enforces the shared-route capacity inside the write transaction", () => {
  const store = new CommunityRouteStore(":memory:");
  expect(store.addRoute("community_first", { name: "First" }, "2026-10-06", [], 1)).toBe(true);
  expect(store.addRoute("community_second", { name: "Second" }, "2026-10-06", [], 1)).toBe(false);
  expect(store.routeCount()).toBe(1);
});
