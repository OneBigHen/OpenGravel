import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  asPlaceId,
  type NearbyPlace,
  type PlaceQuery,
  type PlacesResult,
  type PlacesSource,
} from "@/application/places";
import type { MapIntent } from "@/application/map/types";
import type { MapExtent } from "@/application/map/build-map-scene";
import { buildPlaceCard } from "@/application/places/place-scene";
import { PlaceCard } from "@/ui/places/PlaceCard";
import { PlacesControl } from "@/ui/places/PlacesControl";
import { usePlacesOverlay } from "@/ui/places/usePlacesOverlay";

const STORAGE_KEY = "test-places-enabled";
const EXTENT: MapExtent = { minLon: -75.5, minLat: 40, maxLon: -75.3, maxLat: 40.2 };
const QUERY: PlaceQuery = { kinds: ["happy_hour"], window: "now" };

const PLACE: NearbyPlace = {
  id: asPlaceId("hh:bridge-tap"),
  kind: "happy_hour",
  name: "Bridge Tap",
  coordinate: { lon: -75.4, lat: 40.1 },
  category: "Sports Bar",
  label: "Til 10 PM",
  status: "now",
  city: "Bridgeport",
  address: "12 Main Street",
  specials: ["$3 drafts", "$5 fries", "$6 wings", "$4 soda"],
  schedule: "Mon–Fri 4–7 PM",
  timeZone: "America/New_York",
  rating: 4.4,
  popular: true,
  dogFriendly: true,
  patio: true,
  url: "https://places.example/bridge-tap",
  mapsUrl: "https://maps.example/?q=bridge-tap",
  offRouteMiles: 0.4,
  routeMile: 42,
};

const AVAILABLE: PlacesResult = {
  availability: "available",
  places: [PLACE],
  fetchedAt: "2026-09-24T20:00:00.000Z",
  attribution: "Sample venue details",
};

function source(answer: PlacesResult = AVAILABLE): PlacesSource & { inExtent: ReturnType<typeof vi.fn> } {
  return {
    id: "stub",
    inExtent: vi.fn(async () => answer),
    alongRoute: async () => AVAILABLE,
  };
}

async function flushViewport(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePlacesOverlay", () => {
  it("loads visible places and projects selected scene and card data", async () => {
    vi.useFakeTimers();
    const placesSource = source();
    const { result } = renderHook(() => usePlacesOverlay({
      source: placesSource,
      initialQuery: QUERY,
      storageKey: STORAGE_KEY,
      enabledByDefault: true,
    }));

    act(() => result.current.onViewport(EXTENT));
    await flushViewport();

    expect(placesSource.inExtent).toHaveBeenCalledWith(expect.any(Object), QUERY, expect.any(AbortSignal));
    expect(result.current).toMatchObject({ enabled: true, status: "ready", count: 1 });
    expect(result.current.scenePlaces?.[0]?.id).toBe(PLACE.id);

    act(() => result.current.select(PLACE.id));
    expect(result.current.scenePlaces?.[0]?.selected).toBe(true);
    expect(result.current.selectedPlace).toBe(PLACE);
    expect(result.current.selectedCard?.title).toBe("Bridge Tap");
    expect(result.current.selectedCard?.updated).toBe("Updated Thu, Sep 24, 4:00 PM EDT");
  });

  it("with a chosen ride, shows and counts only the places near it", async () => {
    vi.useFakeTimers();
    const far: NearbyPlace = { ...PLACE, id: asPlaceId("hh:far-away"), name: "Far Away", coordinate: { lon: -75.32, lat: 40.18 } };
    const placesSource = source({ ...AVAILABLE, places: [PLACE, far] });
    // A ride straight through Bridge Tap; Far Away is about 9 km off it.
    const nearLine = [{ lon: -75.45, lat: 40.1 }, { lon: -75.35, lat: 40.1 }];
    const { result, rerender } = renderHook(
      ({ line }: { line?: typeof nearLine }) => usePlacesOverlay({
        source: placesSource,
        initialQuery: QUERY,
        storageKey: STORAGE_KEY,
        enabledByDefault: true,
        nearLine: line,
      }),
      { initialProps: {} },
    );
    act(() => result.current.onViewport(EXTENT));
    await flushViewport();
    expect(result.current).toMatchObject({ count: 2, scope: "view" });

    rerender({ line: nearLine });
    expect(result.current).toMatchObject({ count: 1, scope: "route" });
    expect(result.current.scenePlaces?.map((place) => place.id)).toEqual([PLACE.id]);
  });

  it("persists the toggle per device and reloads the last viewport when enabled", async () => {
    vi.useFakeTimers();
    const placesSource = source();
    const { result, unmount } = renderHook(() => usePlacesOverlay({
      source: placesSource,
      initialQuery: QUERY,
      storageKey: STORAGE_KEY,
      enabledByDefault: false,
    }));

    act(() => result.current.onViewport(EXTENT));
    expect(placesSource.inExtent).not.toHaveBeenCalled();

    act(() => result.current.toggle());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
    await flushViewport();
    expect(placesSource.inExtent).toHaveBeenCalledTimes(1);
    expect(result.current.scenePlaces).toBeDefined();

    act(() => result.current.toggle());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("0");
    expect(result.current.scenePlaces).toBeUndefined();
    unmount();

    const restored = renderHook(() => usePlacesOverlay({
      source: placesSource,
      initialQuery: QUERY,
      storageKey: STORAGE_KEY,
      enabledByDefault: true,
    }));
    expect(restored.result.current.enabled).toBe(false);
  });

  it("consumes place clicks, clears selection on map clicks, and passes other intents", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePlacesOverlay({
      source: source(),
      initialQuery: QUERY,
      storageKey: STORAGE_KEY,
      enabledByDefault: true,
    }));
    act(() => result.current.onViewport(EXTENT));
    await flushViewport();

    const placeClick: MapIntent = {
      type: "place-click",
      placeId: PLACE.id,
      coordinate: PLACE.coordinate,
    };
    let consumed: MapIntent | null = placeClick;
    act(() => { consumed = result.current.interceptIntent(placeClick); });
    expect(consumed).toBeNull();
    expect(result.current.selectedPlace).toBe(PLACE);

    const mapClick: MapIntent = { type: "map-click", coordinate: PLACE.coordinate };
    let forwarded: MapIntent | null = null;
    act(() => { forwarded = result.current.interceptIntent(mapClick); });
    expect(forwarded).toBe(mapClick);
    expect(result.current.selectedId).toBeNull();
    const cameraChanged: MapIntent = { type: "camera-changed" };
    act(() => { forwarded = result.current.interceptIntent(cameraChanged); });
    expect(forwarded).toBe(cameraChanged);
  });
});

describe("PlacesControl", () => {
  it("shows the count, selected query controls, and accessible toggle state", () => {
    const onToggle = vi.fn();
    const setWindow = vi.fn();
    const setKinds = vi.fn();
    render(
      <PlacesControl
        enabled
        status="ready"
        reason={null}
        count={3}
        query={QUERY}
        onToggle={onToggle}
        setWindow={setWindow}
        setKinds={setKinds}
      />,
    );

    expect(screen.getByRole("button", { name: /places/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("places-count")).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: "Now" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Happy hours" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /places/i }));
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(setWindow).toHaveBeenCalledWith("week");
    expect(setKinds).toHaveBeenCalledWith(["happy_hour", "event"]);
  });

  it.each([
    ["zoom-in", null, "Zoom in to see places"],
    ["unavailable", "The provider is not configured.", "Places unavailable — The provider is not configured."],
    ["loading", null, "Finding places…"],
  ] as const)("renders the honest %s state", (status, reason, message) => {
    render(
      <PlacesControl
        enabled
        status={status}
        reason={reason}
        count={0}
        query={QUERY}
        onToggle={vi.fn()}
        setWindow={vi.fn()}
        setKinds={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(message);
  });
});

describe("PlaceCard", () => {
  it("shows a live event's hours and the age of its source answer", () => {
    const event: NearbyPlace = {
      ...PLACE,
      id: asPlaceId("ev:karaoke"),
      kind: "event",
      name: "Thursday Karaoke",
      label: "Happening now",
      startUtc: "2026-09-25T01:00:00+00:00",
      endUtc: "2026-09-25T05:00:00+00:00",
    };
    render(<PlaceCard place={event} card={buildPlaceCard(event, AVAILABLE.fetchedAt)} attribution="Events source" onClose={() => {}} />);
    expect(screen.getByText("Thu, Sep 24, 9:00 PM EDT – Fri, Sep 25, 1:00 AM EDT")).toBeInTheDocument();
    expect(screen.getByText("Updated Thu, Sep 24, 4:00 PM EDT")).toBeInTheDocument();
  });

  it("shows listing details, caps specials, uses safe links, and only offers a stop callback when supplied", () => {
    const onClose = vi.fn();
    const onAddStop = vi.fn();
    const { rerender } = render(
      <PlaceCard place={PLACE} card={buildPlaceCard(PLACE)} attribution="Venue details from source" onClose={onClose} onAddStop={onAddStop} />,
    );

    expect(screen.getByRole("heading", { name: "Bridge Tap" })).toBeInTheDocument();
    expect(screen.getByText("On now · until 10 PM")).toBeInTheDocument();
    expect(screen.getByText("Sports Bar · Bridgeport · 0.4 mi off route · mile 42")).toBeInTheDocument();
    expect(screen.getByText("$3 drafts")).toBeInTheDocument();
    expect(screen.queryByText("$4 soda")).not.toBeInTheDocument();
    expect(screen.getByText("Venue details from source")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Details" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "Details" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Directions" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "Directions" })).toHaveAttribute("target", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Add as stop" }));
    expect(onAddStop).toHaveBeenCalledWith(PLACE);

    rerender(<PlaceCard place={PLACE} card={buildPlaceCard(PLACE)} attribution={null} onClose={onClose} />);
    expect(screen.queryByRole("button", { name: "Add as stop" })).not.toBeInTheDocument();
  });

  it("closes from its close button and Escape", () => {
    const onClose = vi.fn();
    render(<PlaceCard place={PLACE} card={buildPlaceCard(PLACE)} attribution={null} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close place details" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
