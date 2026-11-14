import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCatalogEntries, createExploreDerivative, entryFromLibraryRide, type CatalogEntry } from "@/application/explore/catalog";
import { buildPlannedRouteGpx, buildPlannedTrackGpx } from "@/application/export/gpx-export";
import { curatedRideFeature } from "@/application/map-layers/curated-rides";
import { creditText, isRideCredit, parseRideCredit, type RideCredit } from "@/domain/ride/credit";
import { isRideProvenance } from "@/domain/ride/validate";
import { buildShareSnapshot } from "@/domain/sharing/snapshot";
import { shareSourceFromRide } from "@/domain/sharing/from-ride";
import { RouteDetail } from "@/ui/explore/RouteDetail";
import { RideCreditLine } from "@/ui/credit/RideCreditLine";
import { sharedRideDocument } from "@/application/sharing/ride-this";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function productionCatalog(): readonly Record<string, unknown>[] {
  const file = path.join(process.cwd(), "data", "catalog", "routes.json.gz");
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Record<string, unknown>[];
}

const credit: RideCredit = {
  author: "Brady Brown",
  sourceName: "PA Adventure Bike Rides",
  sourceUrl: "https://www.facebook.com/groups/214850105910753/permalink/2158947971500947/",
};

const entry: CatalogEntry = {
  id: "route-1",
  source: "catalog",
  name: "Loyalsock State Forest Loop",
  region: "Pennsylvania",
  summary: "Loop through Loyalsock state forest.",
  distanceKm: 154,
  bounds: { west: -76.8, south: 41.3, east: -76.5, north: 41.5 },
  geometry: [{ lon: -76.8, lat: 41.3 }, { lon: -76.5, lat: 41.5 }],
  provenance: "PA Adventure Bike Rides · Loyalsock_Forest_.gpx",
  credit,
};

describe("every imported catalog ride credits its source", () => {
  const routes = productionCatalog();

  it("ships 112 rides and every one has an author or an explicit unknown, plus a named source", () => {
    expect(routes).toHaveLength(112);
    for (const route of routes) {
      const parsed = parseRideCredit(route["credit"]);
      expect(parsed, `ride ${String(route["id"])} needs a credit`).toBeTruthy();
      expect(parsed!.sourceName.length).toBeGreaterThan(0);
      expect(parsed!.author === null || parsed!.author.trim().length > 0).toBe(true);
      expect(parsed!.sourceUrl, `ride ${String(route["id"])} needs a source link`).toBeDefined();
    }
  });

  it("keeps the credit when the catalog is read back", () => {
    const entries = parseCatalogEntries(routes.map((route) => ({ ...route, geometry: [{ lon: -76, lat: 41 }, { lon: -76.1, lat: 41.1 }] })));
    expect(entries).toHaveLength(112);
    expect(entries.every((item) => item.credit !== undefined)).toBe(true);
  });

  it("rejects a malformed credit instead of dropping it", () => {
    expect(parseRideCredit({ author: "", sourceName: "x" })).toBeNull();
    expect(parseRideCredit({ author: "A", sourceName: "x", sourceUrl: "javascript:alert(1)" })).toBeNull();
    expect(isRideCredit({ author: null, sourceName: "Roost GPX locker" })).toBe(true);
  });
});

describe("the credit line", () => {
  it("reads 'Route by <author> · <source>' and links the source", () => {
    render(<RideCreditLine credit={credit} />);
    const line = screen.getByTestId("ride-credit");
    expect(line.textContent).toContain("Route by Brady Brown · PA Adventure Bike Rides");
    expect(screen.getByRole("link", { name: /PA Adventure Bike Rides/ }).getAttribute("href")).toBe(credit.sourceUrl);
  });

  it("says plainly when the author is not named, and shows nothing for a rider's own ride", () => {
    expect(creditText({ author: null, sourceName: "Roost GPX locker" })).toBe("Route from Roost GPX locker · author unknown");
    const { container } = render(<RideCreditLine credit={undefined} />);
    expect(container.textContent).toBe("");
  });

  it("renders on the Explore ride detail", () => {
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);
    expect(screen.getByTestId("ride-credit").textContent).toContain("Route by Brady Brown · PA Adventure Bike Rides");
  });

  it("does not render on a ride the rider made", () => {
    const own: CatalogEntry = { ...entry, id: "mine", source: "personal", provenance: "Your saved ride" };
    delete (own as { credit?: RideCredit }).credit;
    render(<RouteDetail entry={own} onUse={vi.fn()} />);
    expect(screen.queryByTestId("ride-credit")).toBeNull();
  });
});

describe("credit travels with the ride", () => {
  it("is on the ride document made from an Explore ride, and valid as stored provenance", () => {
    const document = createExploreDerivative(entry, "2026-11-12T12:00:00.000Z");
    expect(document.provenance.credit).toEqual(credit);
    expect(isRideProvenance(document.provenance)).toBe(true);
  });

  it("survives a library copy and comes back out as an Explore entry", () => {
    const document = createExploreDerivative(entry, "2026-11-12T12:00:00.000Z");
    const back = entryFromLibraryRide({
      summary: { credit: document.provenance.credit } as never,
      document,
      geometry: entry.geometry,
    } as never);
    expect(back.credit).toEqual(credit);
  });

  it("goes into a share snapshot and into the ride opened from a share", () => {
    const document = createExploreDerivative(entry, "2026-11-12T12:00:00.000Z");
    const source = shareSourceFromRide(document, { segments: [entry.geometry] }, null, null);
    const snapshot = buildShareSnapshot(source, { hideStart: false, hideFinish: false, trimMetersFromEnds: 0, blurCoordinates: false });
    expect(snapshot.credit).toEqual(credit);
    const opened = sharedRideDocument(snapshot, "token", "2026-11-12T12:00:00.000Z");
    expect(opened.provenance.credit).toEqual(credit);
  });

  it("shows on the map card of a curated ride", () => {
    const item = curatedRideFeature({
      id: "route-1",
      name: entry.name,
      provenance: "PA Adventure Bike Rides · x.gpx",
      distanceKm: 154,
      bounds: entry.bounds,
      geometry: entry.geometry,
      credit,
    });
    expect(item?.feature.catalogRide?.credit).toEqual(credit);
  });
});

describe("GPX export names the author", () => {
  const input = { title: entry.name, geometry: entry.geometry, credit };

  it("writes author, link and description into the track file", () => {
    const xml = buildPlannedTrackGpx(input);
    expect(xml).toContain("<author><name>Brady Brown</name></author>");
    expect(xml).toContain(`<link href="${credit.sourceUrl}"><text>PA Adventure Bike Rides</text></link>`);
    expect(xml).toContain("<desc>Route by Brady Brown · PA Adventure Bike Rides");
  });

  it("writes it into the route file too", () => {
    expect(buildPlannedRouteGpx(input)).toContain("<author><name>Brady Brown</name></author>");
  });

  it("says the author is not named instead of inventing one", () => {
    const xml = buildPlannedTrackGpx({ ...input, credit: { author: null, sourceName: "Roost GPX locker", sourceUrl: "https://roostlocker.com/" } });
    expect(xml).not.toContain("<author>");
    expect(xml).toContain("author unknown");
  });

  it("adds nothing for a rider's own ride", () => {
    const xml = buildPlannedTrackGpx({ title: "Mine", geometry: entry.geometry });
    expect(xml).not.toContain("<author>");
    expect(xml).not.toContain("<desc>");
  });
});
