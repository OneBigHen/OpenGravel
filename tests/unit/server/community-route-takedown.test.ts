import { describe, expect, it } from "vitest";

import {
  hashOwnerToken,
  handleOperatorTakedown,
  handleRouteRemoval,
} from "@/server/community-routes/removal";
import { CommunityRouteStore } from "@/server/community-routes/store";

/**
 * Two gaps in rider-shared routes: a removal only hides the row, so every
 * takedown kept occupying one of the 2000 sharing slots, and only the browser
 * that still held the localStorage owner secret could take an abusive upload
 * down. A takedown now frees the slot, and an operator can remove any shared
 * route with the moderation token.
 */

const NOW = "2026-10-05T12:00:00Z";
const OWNER_TOKEN = "owner-token-for-this-device-0123456789abcdef";

function route(id: string): Record<string, unknown> {
  return {
    id,
    name: `Route ${id}`,
    region: "Shared by riders",
    summary: "A route shared by a rider.",
    distanceKm: null,
    geometry: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }],
    previewGeometry: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }],
    provenance: "OpenGravel riders",
  };
}

describe("shared-route capacity", () => {
  it("frees a slot when a shared route is taken down", () => {
    const store = new CommunityRouteStore(":memory:");
    try {
      expect(store.addRoute("community_first", route("community_first"), NOW, [], 1, hashOwnerToken(OWNER_TOKEN))).toBe(true);
      expect(store.addRoute("community_second", route("community_second"), NOW, [], 1)).toBe(false);

      expect(store.remove("community_first", "reported", NOW)).toBe(true);

      expect(store.liveRouteCount()).toBe(0);
      expect(store.addRoute("community_second", route("community_second"), NOW, [], 1)).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("operator takedown", () => {
  function dependencies(store: CommunityRouteStore) {
    return {
      store,
      catalogRouteExists: (id: string) => id === "catalog_built_in",
      now: () => NOW,
    };
  }

  it("removes a shared route without the uploader's device secret", () => {
    const store = new CommunityRouteStore(":memory:");
    try {
      expect(store.addRoute("community_abusive", route("community_abusive"), NOW, [], 10, hashOwnerToken(OWNER_TOKEN))).toBe(true);
      // The device that shared it is not available: no owner secret is presented.
      expect(handleRouteRemoval(
        { id: "community_abusive", ownerToken: "", reason: "" },
        dependencies(store),
      )).toMatchObject({ status: 403 });

      expect(handleOperatorTakedown(
        { id: "community_abusive", reason: "Abusive upload" },
        dependencies(store),
      )).toMatchObject({ status: 200, removed: true, name: "Route community_abusive" });
      expect(store.removal("community_abusive")?.reason).toBe("Abusive upload");
    } finally {
      store.close();
    }
  });

  it("refuses an unknown route and a built-in catalog route", () => {
    const store = new CommunityRouteStore(":memory:");
    try {
      expect(handleOperatorTakedown({ id: "community_missing", reason: "" }, dependencies(store))).toMatchObject({ status: 404 });
      expect(handleOperatorTakedown({ id: "catalog_built_in", reason: "" }, dependencies(store))).toMatchObject({ status: 403 });
    } finally {
      store.close();
    }
  });
});
