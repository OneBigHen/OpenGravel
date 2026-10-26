import "fake-indexeddb/auto";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExploreClient } from "@/app/ExploreClient";
import { createLibraryService } from "@/application/library/library-service";
import { createRideDocument } from "@/domain/ride/create";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const preview = [
  { lon: -75.5, lat: 40.5 },
  { lon: -75.4, lat: 40.6 },
  { lon: -75.2, lat: 40.7 },
];

const ROUTE_ID = "sample-ridge-loop";
const ROUTE_NAME = "Sample Ridge Loop";

const listRoute = {
  id: ROUTE_ID,
  name: ROUTE_NAME,
  region: "Pennsylvania",
  summary: "A synthetic route.",
  distanceKm: 27.5,
  provenance: "synthetic catalog",
  preview,
};

const fullRoute = {
  ...listRoute,
  geometry: [
    { lon: -75.5, lat: 40.5 },
    { lon: -75.45, lat: 40.55 },
    { lon: -75.4, lat: 40.6 },
    { lon: -75.3, lat: 40.65 },
    { lon: -75.2, lat: 40.7 },
  ],
};

function catalogFetch(detail: () => Response): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/catalog") return Response.json({ count: 1, routes: [listRoute] });
    if (url === "/api/catalog/sample-ridge-loop") return detail();
    if (url.startsWith("/api/catalog/")) return Response.json({}, { status: 404 });
    return Response.json({}, { status: 404 });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
  push.mockClear();
});

describe("Explore route page", () => {
  it("holds ride-shaped skeletons while the list loads, not a spinner or a blank page", () => {
    // The catalog request never answers: the page shows the shape of the rides
    // that are coming, so the first paint is not one line of text on white.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<ExploreClient />);

    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll(".og-skeleton-card")).toHaveLength(4);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Explore…");
  });

  it("holds the route page's own frame while its full line is on the way", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/catalog") return Response.json({ count: 1, routes: [listRoute] });
      // The detail request is still in flight.
      return new Promise<Response>(() => undefined);
    }));
    render(<ExploreClient detailId="sample-ridge-loop" />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Loading ride details…"));
    expect(document.querySelector(".og-route-detail--loading")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll(".og-route-detail-skeleton__fact")).toHaveLength(4);
    // The map's box and the way back are already where the loaded page puts them.
    expect(document.querySelector(".og-route-detail-skeleton__map")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Back to Explore" })).toHaveAttribute("href", "/explore");
    expect(screen.queryByRole("heading", { name: "Sample Ridge Loop" })).toBeNull();
  });
  it("never plans, exports or shares from the list's card line when the detail request fails", async () => {
    vi.stubGlobal("fetch", catalogFetch(() => Response.json({ error: "busy" }, { status: 503 })));
    render(<ExploreClient detailId="sample-ridge-loop" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Explore" })).toHaveAttribute("href", "/explore");
    expect(screen.queryByRole("button", { name: "Ride this" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export GPX" })).toBeNull();
  });

  it("retries the detail request and only then offers the full-line actions", async () => {
    let attempts = 0;
    const detail = (): Response => {
      attempts += 1;
      return attempts === 1
        ? Response.json({ error: "busy" }, { status: 503 })
        : Response.json({ route: fullRoute });
    };
    vi.stubGlobal("fetch", catalogFetch(detail));
    render(<ExploreClient detailId="sample-ridge-loop" />);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Sample Ridge Loop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export GPX" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ride this" })).toBeEnabled();
    expect(attempts).toBe(2);
  });

  it("distinguishes a removed route from a connection failure, with no retry for a 404", async () => {
    vi.stubGlobal("fetch", catalogFetch(() => Response.json({ error: "not found" }, { status: 404 })));
    render(<ExploreClient detailId="sample-ridge-loop" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/not on Explore/i);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Explore" })).toBeInTheDocument();
  });

  it("opens the route the rider was reading as the ride, ready to start", async () => {
    // "Ride this" used to make a copy called "<name> copy" whose route had to be
    // planned again before Start ride could appear. The ride now keeps the
    // route's name, and the line the rider was just looking at is handed to the
    // planner as the answer.
    vi.stubGlobal("fetch", catalogFetch(() => Response.json({ route: fullRoute })));
    render(<ExploreClient detailId="sample-ridge-loop" />);

    fireEvent.click(await screen.findByRole("button", { name: "Ride this" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));

    const repository = createRideRepository();
    const pointer = await repository.loadDraftPointer();
    expect(pointer).not.toBeNull();
    const opened = await repository.loadRide(pointer!.rideId);
    expect(opened?.ok).toBe(true);
    expect(opened !== null && opened.ok ? opened.document.title : null).toBe(ROUTE_NAME);
    expect(opened !== null && opened.ok ? opened.document.provenance : null)
      .toEqual({ type: "catalog", sourceId: "sample-ridge-loop" });

    const handoff = JSON.parse(window.sessionStorage.getItem("opengravel.explore.ride-this") ?? "null") as
      | { readonly rideId: string; readonly rideRevision: number; readonly geometryRef: string }
      | null;
    expect(handoff).not.toBeNull();
    expect(handoff!.rideId).toBe(String(pointer!.rideId));
    expect(handoff!.rideRevision).toBe(opened !== null && opened.ok ? opened.document.revision : -1);
    expect(handoff!.geometryRef.length).toBeGreaterThan(0);
  });

  it("offers no duplicate save for a ride that is already in the library", async () => {
    const repository = createRideRepository();
    const library = createLibraryService(repository, { now: () => "2026-10-06T12:00:00.000Z" });
    const saved = await library.saveNamed(createRideDocument({ now: "2026-10-06T12:00:00.000Z" }), { title: "Saved loop" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ count: 0, routes: [] })));

    render(<ExploreClient detailId={String(saved.document.rideId)} />);

    expect(await screen.findByRole("heading", { name: "Saved loop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to library" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export GPX" })).toBeNull();
  });
});
