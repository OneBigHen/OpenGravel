import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExplorePanel } from "@/ui/explore/ExplorePanel";
import { ExploreMap } from "@/ui/explore/ExploreMap";
import { RouteDetail } from "@/ui/explore/RouteDetail";
import { RouteCommunity } from "@/ui/explore/RouteCommunity";
import type { CatalogEntry } from "@/application/explore/catalog";
import { TRAFFIC_CORRIDOR_POINTS } from "@/application/preparation/planner-context";
import type { RoutePreparationContext } from "@/application/preparation/prepare-route";
import type { PreparationProviderRegistry, ProviderResult, TrafficData } from "@/application/preparation/providers";
import { discoverRoads } from "@/application/roads/discovery";
import { createRoadEntity } from "@/domain/roads/road-entity";
import { asRoadEntityId } from "@/domain/ride/ids";
import { aggregateSurface } from "@/domain/roads/surface";
import { createStubMapHostFactory } from "../support/stub-map-host";

const entry: CatalogEntry = {
  id: "route-1",
  source: "catalog",
  name: "Lehigh sample route",
  region: "Lehigh Valley",
  summary: "A route with no computed surface evidence.",
  distanceKm: 27.5,
  bounds: { west: -75.5, south: 40.5, east: -75.2, north: 40.7 },
  geometry: [
    { lon: -75.5, lat: 40.5 },
    { lon: -75.2, lat: 40.7 },
  ],
  provenance: "Sample route — built from real roads, not a recommendation.",
  provenanceDetail: "Geometry was produced from real road data between two anchor points.",
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Explore UI", () => {
  it("keeps the regional map quiet while still drawing a highlighted route outside its sample", async () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({ ...entry, id: `route-${index}`, name: `Route ${index}` }));
    const hosts = createStubMapHostFactory();
    render(<ExploreMap entries={entries} highlightedId="route-99" onOpen={vi.fn()} hostFactory={hosts.factory} basemap="empty" />);

    await waitFor(() => expect(hosts.hosts[0]?.lastScene()?.routes.length).toBeGreaterThan(0));
    const routes = hosts.hosts[0]?.lastScene()?.routes ?? [];
    expect(routes.length).toBeLessThanOrEqual(12);
    expect(routes.some((route) => route.id === "route-99" && route.state === "selected")).toBe(true);
    expect(screen.getByText(/routes shown of 100/i)).toBeInTheDocument();
  });

  it("filters by distance in one tap and opens the full filters as a sheet that Escape closes", () => {
    render(<ExplorePanel entries={[entry]} />);

    const underThirty = screen.getByRole("button", { name: "Under 30 mi" });
    expect(underThirty).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(underThirty);
    expect(underThirty).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Filter by distance" })).toHaveValue("short");

    const toggle = screen.getByRole("button", { name: "Filters, 1 on" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(underThirty).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "false");
  });

  it("says how far each route starts from a rider who already shared their location, without asking", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { longitude: -75.5, latitude: 40.6 } } as GeolocationPosition));
    vi.stubGlobal("navigator", {
      ...navigator,
      permissions: { query: vi.fn(async () => ({ state: "granted" })) },
      geolocation: { getCurrentPosition },
    });
    render(<ExplorePanel entries={[entry]} />);
    expect(await screen.findByTestId("explore-card-away")).toHaveTextContent(/mi away|Starts near you/);
    vi.unstubAllGlobals();
  });

  it("never asks for location on its own when the rider has not allowed it", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", {
      ...navigator,
      permissions: { query: vi.fn(async () => ({ state: "prompt" })) },
      geolocation: { getCurrentPosition },
    });
    render(<ExplorePanel entries={[entry]} />);
    await waitFor(() => expect(navigator.permissions.query).toHaveBeenCalled());
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.queryByTestId("explore-card-away")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("labels the catalog source clearly, and keeps the long provenance off the card", () => {
    // Defect (owner review 2026-09-21): a badge reading `Curated` sat next to copy
    // saying the route was not curated. The card now carries the honest source
    // word, and the paragraph of engine mechanics is not on a card at all.
    render(<ExplorePanel entries={[entry]} />);

    expect(screen.getByRole("heading", { name: "Explore" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lehigh sample route/i })).toBeInTheDocument();
    // Both the badge and the source filter speak the same honest word.
    expect(screen.getByText("Catalog", { selector: ".og-explore-card__source" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Catalog" })).toBeInTheDocument();
    expect(screen.getByText("Surface unknown")).toBeInTheDocument();
    expect(screen.getByText("Curvature unknown")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search routes" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Filter by region" })).toHaveAttribute("placeholder", "e.g. Pennsylvania");
    expect(screen.getByRole("combobox", { name: "Sort routes" })).toHaveValue("recommended");
    expect(screen.getByRole("combobox", { name: "Filter by surface" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Curvy routes only" })).toBeDisabled();
    expect(screen.queryByText("Curated")).not.toBeInTheDocument();
    expect(screen.queryByText(entry.provenance)).not.toBeInTheDocument();
    expect(screen.queryByText(/GraphHopper|motorcycle_scenic/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by source" }), {
      target: { value: "personal" },
    });
    expect(screen.getByText("No routes match these filters.")).toBeInTheDocument();
  });

  it("shows an inline note when geolocation is denied", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_success: unknown, error: (reason: { code: number }) => void) => error({ code: 1 }) },
    });
    render(<ExplorePanel entries={[entry]} />);

    fireEvent.click(screen.getByRole("button", { name: "Sort by distance from me" }));
    expect(await screen.findByText(/location permission was not granted/i)).toBeInTheDocument();
  });

  it("shows one honest provenance line and puts the mechanics behind a disclosure", () => {
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);

    expect(
      screen.getByText("Sample route — built from real roads, not a recommendation."),
    ).toBeInTheDocument();
    expect(screen.getByText("Catalog route")).toBeInTheDocument();
    expect(screen.queryByText("Curated route")).not.toBeInTheDocument();

    // The detail exists, and it is a disclosure rather than a paragraph in the
    // header the rider reads first.
    const disclosure = screen.getByText("Where this route came from");
    expect(disclosure.closest("details")).not.toBeNull();
    expect(disclosure.closest("details")).toHaveTextContent(entry.provenanceDetail ?? "");
  });

  it("shares a route through the share sheet, or copies its link where there is none", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);
    fireEvent.click(screen.getByTestId("route-share"));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    cleanup();

    const share = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);
    fireEvent.click(screen.getByTestId("route-share"));
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: window.location.href })));
    vi.unstubAllGlobals();
  });

  it("keeps a donor file path and attribution inside the provenance disclosure", () => {
    const donorEntry = {
      ...entry,
      provenance: "rideplanner · rideplanner/output/gpx/long-route.gpx",
      provenanceDetail: "Author: 54warrior · License: not specified by the source",
    };
    render(<RouteDetail entry={donorEntry} onUse={vi.fn()} />);

    expect(screen.getByText("Source: rideplanner")).toBeInTheDocument();
    expect(screen.queryByText(donorEntry.provenance)).not.toBeInTheDocument();
    const disclosure = screen.getByText("Where this route came from").closest("details");
    expect(disclosure).toHaveTextContent(donorEntry.provenance);
    expect(disclosure).toHaveTextContent(donorEntry.provenanceDetail);
  });

  it("lists repeated exports and separate tracks on the route detail page", () => {
    render(<RouteDetail
      entry={entry}
      onUse={vi.fn()}
      variants={[
        { id: "route-1", label: "Track 1", name: "Lehigh sample route", distanceKm: 27.5, copyCount: 3 },
        { id: "route-2", label: "Track 2", name: "Lehigh sample route · track 2", distanceKm: 29, copyCount: 1 },
      ]}
    />);
    expect(screen.getByRole("region", { name: "Catalog variants and tracks" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lehigh sample route.*3 exports/i })).toHaveAttribute("href", "/explore/route-1");
    expect(screen.getByRole("link", { name: /track 2/i })).toBeInTheDocument();
  });

  it("uses the route and keeps unknown metrics as an accessible em dash", () => {
    const onUse = vi.fn().mockResolvedValue(undefined);
    render(<RouteDetail entry={entry} onUse={onUse} />);

    // No catalog ride time: estimated from the distance at a stated pace (EX-08).
    expect(screen.getByRole("region", { name: "Route stats" })).toHaveTextContent("Est. time~30 min at 28 mph");
    expect(screen.getAllByText("Surface unknown").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Plan this ride" }));
    return waitFor(() => expect(onUse).toHaveBeenCalledWith(entry));
  });

  it("offers no map link the planner cannot open (DI-01)", () => {
    // The planner reads no `?route=` query; "Plan this ride" is the one way onto its map.
    const { container } = render(<RouteDetail entry={entry} onUse={vi.fn()} />);
    expect(container.querySelector('a[href^="/?route="]')).toBeNull();
    expect(screen.queryByRole("link", { name: "View on map" })).toBeNull();
  });

  it("bounds catalog geometry before asking the live traffic endpoint", async () => {
    const geometry = Array.from({ length: 200 }, (_, index) => ({ lon: -75 + index / 10_000, lat: 40 + index / 10_000 }));
    const largeEntry = { ...entry, id: "long-catalog-route", geometry };
    const unavailable: ProviderResult<TrafficData> = {
      state: "unavailable",
      reason: "No live traffic fixture.",
      provenance: "test",
    };
    const refresh = vi.fn(async (context: RoutePreparationContext) => {
      void context;
      return unavailable;
    });
    const traffic: PreparationProviderRegistry["traffic"] = {
      id: "traffic-test",
      kind: "traffic",
      capabilities: () => ({ kind: "traffic", availability: "available", freshness: "time-bound", reason: null, provenance: "test" }),
      getTraffic: () => unavailable,
      refresh,
    };

    render(<RouteDetail entry={largeEntry} onUse={vi.fn()} preparationProviders={{ traffic }} />);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    const context = refresh.mock.calls[0]?.[0];
    expect(context?.trafficCorridor).toHaveLength(TRAFFIC_CORRIDOR_POINTS);
    expect(context?.trafficCorridor?.[0]).toEqual(geometry[0]);
    expect(context?.trafficCorridor?.at(-1)).toEqual(geometry.at(-1));
  });

  it("shows long-trip considerations for a long fixture and none for a short fixture", () => {
    const longEntry: CatalogEntry = {
      ...entry,
      id: "long-fixture",
      name: "Long-trip fixture",
      distanceKm: 300,
      estimatedTimeMinutes: 360,
      longTripFacts: {
        daylight: {
          sunset: "2026-09-20T15:30:00.000Z",
          source: "NOAA solar calculation",
          sourceRef: "daylight:noaa:fixture",
        },
        weather: {
          state: "ready",
          fetchedAt: "2026-09-20T12:30:00.000Z",
          source: "NWS",
          sourceRef: "weather:nws:fixture",
          maxPrecipChance: 70,
          alerts: [],
        },
        service: {
          status: "gap",
          gapKm: 86,
          summary: "No mapped service point in the next catalog segment.",
          source: "road knowledge",
          sourceRef: "road:fixture:service",
        },
      },
    };

    render(<RouteDetail entry={longEntry} onUse={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Long-trip considerations" })).toBeInTheDocument();
    expect(screen.getByTestId("long-trip-consideration-fuel")).toHaveTextContent("conservative default assumption");
    expect(screen.getByTestId("long-trip-consideration-weather")).toHaveTextContent("70% precipitation chance");
    expect(screen.getByTestId("long-trip-consideration-service")).toHaveTextContent("53 mi gap reported");

    cleanup();
    render(<RouteDetail entry={{ ...longEntry, id: "short-fixture", distanceKm: 27.5, estimatedTimeMinutes: 32.1 }} onUse={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Long-trip considerations" })).not.toBeInTheDocument();
  });

  it("submits an anonymous rating, comment, and road condition through their server paths", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/contributions") {
        const contribution = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ id: "contrib_route", contribution, receivedAt: new Date().toISOString() }, { status: 201 });
      }
      if (init?.method === "POST") return Response.json({ ratingAverage: 5, ratingCount: 1 }, { status: 201 });
      return Response.json({ ratingAverage: null, ratingCount: 0, comments: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    window.localStorage.clear();
    render(<RouteCommunity routeId="route-1" />);
    expect(await screen.findByText((_, element) => element?.textContent === "No ratings yet · 0 ratings")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save rating" }));
    await screen.findByRole("status");
    fireEvent.change(screen.getByRole("textbox", { name: "Leave a comment" }), { target: { value: "Fresh gravel at the bridge." } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await screen.findByText("Comment sent for review. It will appear after approval. Posted from this device.");
    fireEvent.change(screen.getByRole("combobox", { name: "Road condition" }), { target: { value: "closed" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Optional note" }), { target: { value: "Gate at the north entrance." } });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText(/Road condition report sent for review/);

    const posts = fetcher.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts.map((call) => String(call[0]))).toEqual([
      "/api/catalog/route-1/community",
      "/api/contributions",
      "/api/contributions",
    ]);
    expect(JSON.parse(String(posts[1]?.[1]?.body))).toMatchObject({ kind: "condition", value: { tag: "comment", severity: "minor", note: "Fresh gravel at the bridge." } });
    expect(JSON.parse(String(posts[2]?.[1]?.body))).toMatchObject({ kind: "condition", value: { tag: "closed", severity: "severe", note: "Gate at the north entrance." } });
    expect(screen.getByText("Posted from this device. No account is required.")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("renders the roads-on-this-ride list and an honest road detail sheet", async () => {
    const roadEntry = {
      ...entry,
      roadSummary: {
        roads: [{
          entityId: asRoadEntityId("road_main"),
          distanceKm: 12.4,
          percentage: 45,
          confidenceBand: "High",
        }],
        totalKm: 27.5,
        matchedKm: 12.4,
        unmatchedKm: 15.1,
        coveragePercent: 45,
        unverifiedRoadCount: 0,
      },
      roadDetails: [{
        entity: {
          id: asRoadEntityId("road_main"),
          name: "Main Street",
          normalizedName: "main st",
          class: "secondary",
          lineage: [],
          firstSeen: "2026-09-17T12:00:00.000Z",
          lastSeen: "2026-09-17T12:00:00.000Z",
          spans: ["span-main"],
          evidenceRefs: ["evidence-main"],
        },
        aliases: ["Main St"],
        summary: {
          entityId: asRoadEntityId("road_main"),
          distanceKm: 12.4,
          percentage: 45,
          confidenceBand: "High",
        },
        evidence: [{
          id: "evidence-main",
          entityId: asRoadEntityId("road_main"),
          source: "recorded-ride",
          observedAt: "2026-09-17T12:00:00.000Z",
          value: "paved-smooth",
          confidence: 0.9,
        }],
        evidenceSummary: {
          entityId: asRoadEntityId("road_main"),
          surfaceValue: "paved-smooth",
          confidence: 0.9,
          confidenceBand: "High",
          conflict: false,
          evidenceCount: 1,
          sourceDiversity: 1,
          latestObservedAt: "2026-09-17T12:00:00.000Z",
          records: [],
        },
        ridesThroughCount: 2,
      }],
    } as CatalogEntry;

    render(<RouteDetail entry={roadEntry} onUse={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Roads on this ride" })).toBeInTheDocument();
    expect(screen.getByText(/7\.7 mi matched · 1 road · 0 surface unknown/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Roads on this ride" })).toBeInTheDocument();
    expect(screen.getByLabelText("Surface likely: paved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Main Street road details" }));
    expect(screen.getByRole("dialog", { name: "Main Street" })).toBeInTheDocument();
    expect(screen.getByText(/Also known as: Main St/)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "paved" })).toBeInTheDocument();
    expect(screen.getByText("2 rides through here")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /avoid this road/i })).not.toBeInTheDocument();
  });

  it("renders unknown as unknown on a road strip and in the road detail", () => {
    const unknownEntry = {
      ...entry,
      roadSummary: {
        roads: [{
          entityId: asRoadEntityId("road_unknown"),
          distanceKm: 2,
          percentage: 100,
          confidenceBand: "Unverified",
          surfaceValue: "unknown",
          surfaceBand: "unknown",
          surfaceAssessment: aggregateSurface([]),
        }],
        totalKm: 2,
        matchedKm: 2,
        unmatchedKm: 0,
        coveragePercent: 100,
        unverifiedRoadCount: 1,
        surfaceAssessment: aggregateSurface([]),
        surfaceBand: "unknown",
      },
      roadDetails: [{
        entity: {
          id: asRoadEntityId("road_unknown"),
          name: "Unknown Road",
          normalizedName: "unknown rd",
          class: "track",
          lineage: [],
          firstSeen: "2026-09-17T12:00:00.000Z",
          lastSeen: "2026-09-17T12:00:00.000Z",
          spans: ["span-unknown"],
          evidenceRefs: [],
        },
        aliases: [],
        summary: {
          entityId: asRoadEntityId("road_unknown"),
          distanceKm: 2,
          percentage: 100,
          confidenceBand: "Unverified",
          surfaceValue: "unknown",
          surfaceBand: "unknown",
          surfaceAssessment: aggregateSurface([]),
        },
        evidence: [],
        evidenceSummary: {
          entityId: asRoadEntityId("road_unknown"),
          surfaceValue: null,
          confidence: null,
          confidenceBand: "Unverified",
          conflict: false,
          evidenceCount: 0,
          sourceDiversity: 0,
          latestObservedAt: null,
          records: [],
          surfaceAssessment: aggregateSurface([]),
          surfaceBand: "unknown",
        },
        ridesThroughCount: 0,
      }],
    } as CatalogEntry;

    render(<RouteDetail entry={unknownEntry} onUse={vi.fn()} />);
    expect(screen.getAllByText("Surface unknown").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Open Unknown Road road details" }));
    expect(screen.getByRole("dialog", { name: "Unknown Road" })).toHaveTextContent("Surface unknown");
  });

  it("renders conflicts and provenance rows in the road detail", () => {
    const conflictAssessment = aggregateSurface([
      {
        id: "evidence-paved",
        value: "paved",
        source: "osm",
        sourceLabel: "OpenStreetMap",
        observedAt: "2026-09-17T12:00:00.000Z",
        weight: 0.9,
        confidence: 0.9,
      },
      {
        id: "evidence-dirt",
        value: "dirt",
        source: "rider",
        sourceLabel: "Rider report",
        observedAt: "2026-09-16T12:00:00.000Z",
        weight: 0.8,
        confidence: 0.9,
      },
    ]);
    const conflictEntry = {
      ...entry,
      roadSummary: {
        roads: [{
          entityId: asRoadEntityId("road_conflict"),
          distanceKm: 2,
          percentage: 100,
          confidenceBand: "Low",
          surfaceValue: "unknown",
          surfaceBand: "possible",
          surfaceAssessment: conflictAssessment,
        }],
        totalKm: 2,
        matchedKm: 2,
        unmatchedKm: 0,
        coveragePercent: 100,
        unverifiedRoadCount: 0,
        surfaceAssessment: conflictAssessment,
        surfaceBand: "possible",
      },
      roadDetails: [{
        entity: {
          id: asRoadEntityId("road_conflict"),
          name: "Conflict Road",
          normalizedName: "conflict rd",
          class: "track",
          lineage: [],
          firstSeen: "2026-09-01T12:00:00.000Z",
          lastSeen: "2026-09-17T12:00:00.000Z",
          spans: ["span-conflict"],
          evidenceRefs: ["evidence-paved", "evidence-dirt"],
        },
        aliases: [],
        summary: {
          entityId: asRoadEntityId("road_conflict"),
          distanceKm: 2,
          percentage: 100,
          confidenceBand: "Low",
          surfaceValue: "unknown",
          surfaceBand: "possible",
          surfaceAssessment: conflictAssessment,
        },
        evidence: [],
        evidenceSummary: {
          entityId: asRoadEntityId("road_conflict"),
          surfaceValue: null,
          confidence: 0.2,
          confidenceBand: "Low",
          conflict: true,
          evidenceCount: 2,
          sourceDiversity: 2,
          latestObservedAt: "2026-09-17T12:00:00.000Z",
          records: [],
          surfaceAssessment: conflictAssessment,
          surfaceBand: "possible",
        },
        ridesThroughCount: 1,
      }],
    } as CatalogEntry;

    render(<RouteDetail entry={conflictEntry} onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Conflict Road road details" }));
    const detail = screen.getByRole("dialog", { name: "Conflict Road" });
    expect(detail).toHaveTextContent("Surface possible");
    expect(detail).toHaveTextContent("Surface reports conflict");
    expect(detail).toHaveTextContent("OpenStreetMap");
    expect(detail).toHaveTextContent("Rider report");
    expect(detail).toHaveTextContent("paved");
    expect(detail).toHaveTextContent("dirt");
  });

  it("switches to Roads, renders an honest why-line, and opens the road detail sheet", () => {
    const entity = createRoadEntity({
      name: "Ridge Road",
      class: "tertiary",
      endpoints: [{ lon: -75.5, lat: 40.5 }, { lon: -75.4, lat: 40.6 }],
      firstSeen: "2026-09-01T00:00:00.000Z",
      lastSeen: "2026-09-17T00:00:00.000Z",
    });
    const roads = discoverRoads({
      roads: [{
        entity,
        geometry: [
          { lon: -75.5, lat: 40.5 },
          { lon: -75.46, lat: 40.56 },
          { lon: -75.4, lat: 40.6 },
        ],
        matchedDistanceKm: 8.5,
        matchedRideCount: 2,
        region: "Lehigh Valley",
        evidence: [],
      }],
    });

    render(<ExplorePanel entries={[]} roadCandidates={roads} />);
    fireEvent.click(screen.getByRole("tab", { name: "Ride" }));

    expect(screen.getByRole("heading", { name: "Worth riding" })).toBeInTheDocument();
    expect(screen.getAllByText("Ridge Road").length).toBeGreaterThan(0);
    expect(screen.getAllByText("tertiary · 5.3 mi").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/matched on 2 rides/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Surface unknown").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Ridge Road road details" })[0]!);
    expect(screen.getByRole("dialog", { name: "Ridge Road" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use in planner/i })).not.toBeInTheDocument();
  });

  it("omits the empty road section while keeping ready-made rides available", () => {
    render(<ExplorePanel entries={[]} roadCandidates={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Ride" }));

    expect(screen.queryByRole("heading", { name: "Worth riding" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready-made rides" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /road details/i })).not.toBeInTheDocument();
  });
});
