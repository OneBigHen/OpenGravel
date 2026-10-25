import { describe, expect, it } from "vitest";

// The shared community store defaults to an on-disk database; this suite proves
// the live-catalog behaviour against an in-memory store and the fixture catalog.
process.env["COMMUNITY_DB_PATH"] = ":memory:";
process.env["OGV_CATALOG_FIXTURE"] = "1";

const { knownRouteName, liveCatalogEntries } = await import("@/server/community-routes/live-catalog");
const { hashOwnerToken, handleRouteRemoval } = await import("@/server/community-routes/removal");
const { sharedCommunityRouteStore } = await import("@/server/community-routes/store");

const NOW = "2026-10-05T12:00:00Z";
const OWNER_TOKEN = "owner-token-for-this-device-0123456789abcdef";

function removeWith(id: string, ownerToken: string) {
  return handleRouteRemoval(
    { id, ownerToken, reason: "" },
    {
      store: sharedCommunityRouteStore(),
      catalogRouteExists: (routeId) => knownRouteName(routeId) !== null,
      now: () => NOW,
    },
  );
}

describe("live catalog and route removal", () => {
  it("refuses a built-in route and keeps it visible for everyone", () => {
    const builtIn = liveCatalogEntries().find((entry) => entry.source === "catalog");
    expect(builtIn).toBeDefined();
    const id = builtIn!.id;

    expect(removeWith(id, "")).toMatchObject({ status: 403 });
    expect(sharedCommunityRouteStore().removedIds().has(id)).toBe(false);
    expect(liveCatalogEntries().some((entry) => entry.id === id)).toBe(true);
  });

  it("lets the site operator take down an abusive route the sharer keeps online", async () => {
    const store = sharedCommunityRouteStore();
    const id = "community_operator_takedown";
    store.addRoute(id, {
      id,
      name: "Abusive upload",
      region: "Shared by riders",
      summary: "A route shared by a rider.",
      distanceKm: null,
      geometry: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }],
      previewGeometry: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }],
      provenance: "OpenGravel riders",
    }, NOW, [], 10, hashOwnerToken(OWNER_TOKEN));
    const { POST } = await import("@/app/api/community/routes/[id]/remove/route");
    const context = { params: Promise.resolve({ id }) };
    const request = (headers: Record<string, string>) => new Request(`https://opengravel.test/api/community/routes/${id}/remove`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ reason: "Abusive upload" }),
    });

    // The uploader's browser is not cooperating, so there is no owner secret.
    expect((await POST(request({}), context)).status).toBe(403);
    expect(liveCatalogEntries().some((entry) => entry.id === id)).toBe(true);

    process.env["OGV_MODERATION_TOKEN"] = "operator-token-for-tests";
    try {
      const response = await POST(request({ authorization: "Bearer operator-token-for-tests" }), context);
      expect(response.status).toBe(200);
      expect(store.removal(id)?.reason).toBe("Abusive upload");
      expect(liveCatalogEntries().some((entry) => entry.id === id)).toBe(false);
    } finally {
      delete process.env["OGV_MODERATION_TOKEN"];
    }
  });

  it("removes a route shared by this device and restores it from the signed path", () => {
    const store = sharedCommunityRouteStore();
    const id = "community_owner_test";
    store.addRoute(id, {
      id,
      name: "Owner's route",
      region: "Shared by riders",
      summary: "A route shared by a rider.",
      distanceKm: null,
      geometry: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }],
      previewGeometry: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }],
      provenance: "OpenGravel riders",
    }, NOW, [], 10, hashOwnerToken(OWNER_TOKEN));
    expect(liveCatalogEntries().some((entry) => entry.id === id)).toBe(true);

    expect(removeWith(id, "wrong-token-for-this-device-0123456789abcdef")).toMatchObject({ status: 403 });
    expect(liveCatalogEntries().some((entry) => entry.id === id)).toBe(true);

    expect(removeWith(id, OWNER_TOKEN)).toMatchObject({ status: 200, removed: true });
    expect(liveCatalogEntries().some((entry) => entry.id === id)).toBe(false);

    expect(store.restore(id, "2026-10-05T13:00:00Z")).toBe(true);
    expect(liveCatalogEntries().some((entry) => entry.id === id)).toBe(true);
  });
});
