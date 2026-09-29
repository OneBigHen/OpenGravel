import { describe, expect, it } from "vitest";

import {
  buildShareSnapshot,
  serializeShareSnapshot,
  ShareSnapshotError,
} from "@/domain/sharing/snapshot";
import { routeDistanceMeters } from "@/domain/sharing/privacy";
import { shareSourceFromRide } from "@/domain/sharing/from-ride";
import { SHARE_SNAPSHOT_VERSION, type ShareSource } from "@/domain/sharing/types";
import type { Coordinate, RideDocument } from "@/domain/ride/types";

/**
 * The snapshot's privacy boundary (10-SHARING-AND-OFFLINE §12): the share
 * snapshot carries the public metadata list and nothing else. Anything not on
 * the list — raw history, GPS observations, search queries, saved-place ids,
 * import source ids — must not be derivable from the serialized output.
 */

const ROUTE: readonly Coordinate[] = [
  { lon: -75.43, lat: 40.13 },
  { lon: -75.429, lat: 40.131 },
  { lon: -75.428, lat: 40.132 },
];

function source(overrides: Partial<ShareSource> = {}): ShareSource {
  return {
    sourceRevision: 7,
    title: "Pine Loop",
    route: { segments: [ROUTE] },
    summary: { distanceMeters: 2_100, durationSeconds: 1_800 },
    surface: { preference: "mixed", unknownSurfacePolicy: "allow-with-warning" },
    provenance: "import",
    authorPseudonym: null,
    ...overrides,
  };
}

const PRIVACY = { hideStart: false, hideFinish: false, trimMetersFromEnds: 0, blurCoordinates: false };

describe("buildShareSnapshot — the §12 public metadata allowlist", () => {
  it("carries exactly the listed fields and nothing more", () => {
    const snapshot = buildShareSnapshot(source(), PRIVACY);

    expect(Object.keys(snapshot).sort()).toEqual([
      "author",
      "distanceMeters",
      "rideDistanceMeters",
      "rideDurationSeconds",
      "route",
      "source",
      "sourceRevision",
      "surface",
      "title",
      "version",
    ]);
    expect(Object.keys(snapshot.surface).sort()).toEqual(["preference", "unknownSurfacePolicy"]);
    expect(snapshot.source).toEqual({ attribution: "import" });
    expect(snapshot.version).toBe(SHARE_SNAPSHOT_VERSION);
  });

  it("excludes every identifying part of the ride document", () => {
    const snapshot = buildShareSnapshot(source({ provenance: "import" }), PRIVACY);
    const output = serializeShareSnapshot(snapshot);

    // Identifying values and fields seeded in the source must be unfindable.
    for (const leaked of [
      "sourceId",
      "originalRef",
      "observedAt",
      "accuracyMeters",
      "savedPlaceId",
      "placeId",
      "query",
      "provider",
      "geometryRef",
      "rideId",
    ]) {
      expect(output).not.toContain(leaked);
    }
  });

  it("includes an author only when opted in, and then only the pseudonym", () => {
    const anonymous = buildShareSnapshot(source(), PRIVACY);
    expect(anonymous.author).toBeNull();
    expect(serializeShareSnapshot(anonymous)).not.toContain("pseudonym");

    const opted = buildShareSnapshot(source({ authorPseudonym: "Gravel Fox" }), PRIVACY);
    expect(opted.author).toEqual({ pseudonym: "Gravel Fox" });
  });

  it("keeps unknown summary values unknown rather than zero", () => {
    const snapshot = buildShareSnapshot(source({ summary: null }), PRIVACY);
    expect(snapshot.rideDistanceMeters).toBeNull();
    expect(snapshot.rideDurationSeconds).toBeNull();
  });

  it("derives the shared distance from the shared geometry itself", () => {
    const snapshot = buildShareSnapshot(source(), PRIVACY);
    // Derived from the exposed route (not the 2 100 m aggregate the summary
    // carries): the number always describes exactly what the link exposes.
    expect(snapshot.distanceMeters).toBe(routeDistanceMeters(snapshot.route));
    expect(snapshot.distanceMeters).toBeGreaterThan(250);
    expect(snapshot.distanceMeters).toBeLessThan(300);
    expect(snapshot.distanceMeters).not.toBe(2_100);
  });

  it("exposes the trimmed geometry, not the full one", () => {
    const long: readonly Coordinate[] = Array.from({ length: 31 }, (_, index) => ({
      lon: -75.43,
      lat: 40.13 + index * 0.001,
    }));
    const full = buildShareSnapshot(
      source({ route: { segments: [long] } }),
      PRIVACY,
    );
    const trimmed = buildShareSnapshot(
      source({ route: { segments: [long] } }),
      { hideStart: true, hideFinish: true, trimMetersFromEnds: 100, blurCoordinates: false },
    );
    expect(trimmed.distanceMeters).toBeLessThan(full.distanceMeters);
    expect(trimmed.route.segments[0]?.length).toBeLessThan(long.length);
  });

  it("refuses an empty title", () => {
    expect(() => buildShareSnapshot(source({ title: "   " }), PRIVACY)).toThrow(ShareSnapshotError);
    expect(() => buildShareSnapshot(source({ title: "" }), PRIVACY)).toThrow(/title/i);
  });

  it("refuses a snapshot whose route was fully trimmed away", () => {
    expect(() =>
      buildShareSnapshot(source(), {
        hideStart: true,
        hideFinish: true,
        trimMetersFromEnds: 500,
        blurCoordinates: false,
      }),
    ).toThrow(/route/i);
  });
});

describe("serializeShareSnapshot — stable bytes", () => {
  it("serializes identically for identical input (key order is pinned)", () => {
    const first = serializeShareSnapshot(buildShareSnapshot(source(), PRIVACY));
    const second = serializeShareSnapshot(buildShareSnapshot(source(), PRIVACY));
    expect(second).toBe(first);
    // The first bytes are the version: the serialization is a fixed-order
    // projection, not an accident of object iteration.
    expect(first.startsWith('{"version":1,')).toBe(true);
  });
});

describe("shareSourceFromRide — named derivation from RideDocument", () => {
  const document = {
    rideId: "ride_secret_123",
    schemaVersion: 1,
    revision: 5,
    createdAt: "2026-02-14T10:00:00.000Z",
    title: "Pine Loop",
    provenance: { type: "import", sourceId: "originalRef_SECRET" },
    locations: {
      start: {
        locationId: "loc_a",
        label: "Home",
        coordinate: { lon: -75.43, lat: 40.13 },
        provenance: { type: "gps", accuracyMeters: 4, observedAt: "2026-02-14T09:00:00.000Z" },
      },
    },
    intent: {
      surface: { preference: "dirt-preferred", unknownSurfacePolicy: "avoid-when-possible" },
    },
  } as unknown as RideDocument;

  it("picks only the shareable fields and never the ids", () => {
    const derived = shareSourceFromRide(document, { segments: [ROUTE] }, null, null);

    expect(derived.title).toBe("Pine Loop");
    expect(derived.sourceRevision).toBe(5);
    expect(derived.provenance).toBe("import");
    expect(derived.surface).toEqual({
      preference: "dirt-preferred",
      unknownSurfacePolicy: "avoid-when-possible",
    });
    expect(derived.summary).toBeNull();
    expect(derived.authorPseudonym).toBeNull();

    const output = serializeShareSnapshot(buildShareSnapshot(derived, PRIVACY));
    expect(output).not.toContain("SECRET");
    expect(output).not.toContain("Home");
    expect(output).not.toContain("observedAt");
  });
});
