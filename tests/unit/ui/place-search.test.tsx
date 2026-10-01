/**
 * Place search and place names on the planner (MVP parity M1).
 *
 * Pins the rider-visible contract: typing searches, Enter picks the first
 * result (even one still on its way), a pick is one typed command carrying the
 * label and `search` provenance, a dropped pin reads as the place the geocoder
 * found without a new document revision, and a failed search is one quiet line.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlaceMatch, PlaceSearchPort } from "@/application/geocoding/place-search";
import {
  EMPTY_PLACE_MEMORY,
  recordRecent,
  rememberedPlaces,
  toggleSaved,
  type PlaceMemory,
} from "@/application/geocoding/place-memory";
import { buildPlannerViewModel, DROPPED_PIN_LABEL, YOUR_LOCATION_LABEL } from "@/application/planner/planner-view-model";
import { emptyPlanningSession } from "@/application/planner/planning-session";
import { applyRideCommand } from "@/domain/ride/reducer";
import { createRideDocument } from "@/domain/ride/create";
import type { RideDocument } from "@/domain/ride/types";
import { PlaceSearchField, PLACE_SEARCH_DEBOUNCE_MS } from "@/ui/planner/PlaceSearchField";
import {
  currentLocationStartCommand,
  moveStartCommand,
  placeStartCommand,
  searchedEndpointCommand,
} from "@/ui/stores/ride-document-store";

const JIM_THORPE: PlaceMatch = {
  id: "fixture:jim-thorpe",
  label: "Jim Thorpe, PA",
  name: "Jim Thorpe",
  context: "Carbon County, PA",
  coordinate: { lat: 40.8757, lon: -75.7324 },
  provider: "fixture",
};
const HAWK: PlaceMatch = {
  ...JIM_THORPE,
  id: "fixture:hawk",
  label: "Hawk Mountain Sanctuary, PA",
  name: "Hawk Mountain Sanctuary",
  context: "Kempton, Berks County, PA",
  coordinate: { lat: 40.6348, lon: -75.9913 },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function applied(document: RideDocument, command: Parameters<typeof applyRideCommand>[1]): RideDocument {
  const result = applyRideCommand(document, command);
  if (result.outcome !== "applied") throw new Error(`expected applied, got ${result.outcome}`);
  return result.document;
}

describe("search commands", () => {
  it("a picked place is one start.set with its label and search provenance", () => {
    const document = createRideDocument();
    const command = searchedEndpointCommand(
      document,
      "start",
      { label: JIM_THORPE.label, coordinate: JIM_THORPE.coordinate, provider: "photon", placeId: "photon:R1" },
      "jim thorpe",
    );
    expect(command.type).toBe("start.set");
    expect(command.source).toBe("rider");
    const next = applied(document, command);
    expect(next.intent.start).toMatchObject({
      label: "Jim Thorpe, PA",
      coordinate: JIM_THORPE.coordinate,
      provenance: { type: "search", provider: "photon", placeId: "photon:R1", query: "jim thorpe" },
    });
    expect(next.history.entries).toHaveLength(1);
  });

  it("replacing a destination by search keeps its identity", () => {
    const origin = createRideDocument();
    const first = applied(
      origin,
      searchedEndpointCommand(origin, "finish", { label: "A", coordinate: { lat: 40, lon: -75 }, provider: "fixture" }, "a"),
    );
    const id = first.intent.finish?.id;
    const second = applied(
      first,
      searchedEndpointCommand(first, "finish", { label: "B", coordinate: { lat: 41, lon: -75 }, provider: "fixture" }, "b"),
    );
    expect(second.intent.finish?.id).toBe(id);
    expect(second.intent.finish?.label).toBe("B");
  });

  it("dragging a searched start drops the name that described its old position", () => {
    const origin = createRideDocument();
    const searched = applied(
      origin,
      searchedEndpointCommand(origin, "start", { label: "Jim Thorpe, PA", coordinate: JIM_THORPE.coordinate, provider: "fixture" }, "jim"),
    );
    const move = moveStartCommand(searched, { lat: 40.7, lon: -75.3 });
    if (move === null) throw new Error("expected a move");
    const moved = applied(searched, move);
    expect(moved.intent.start?.label).toBeUndefined();
    expect(moved.intent.start?.provenance.type).toBe("map");
  });

  it("current location is an undoable rider start with gps provenance", () => {
    const document = createRideDocument();
    const next = applied(
      document,
      currentLocationStartCommand(document, { coordinate: { lat: 40.6, lon: -75.4 }, accuracyMeters: 8, observedAt: "2026-09-23T00:00:00Z" }),
    );
    expect(next.intent.start?.provenance).toEqual({ type: "gps", accuracyMeters: 8, observedAt: "2026-09-23T00:00:00Z" });
    expect(next.history.entries).toHaveLength(1);
  });
});

describe("view-model names", () => {
  function startLabel(document: RideDocument, names?: (c: { lat: number; lon: number }) => string | undefined): string {
    return buildPlannerViewModel({
      document,
      session: emptyPlanningSession(document.rideId),
      ...(names === undefined ? {} : { placeNameFor: names }),
    }).startLabel;
  }

  it("a dropped pin reads as the resolved place, without a new revision", () => {
    const document = createRideDocument();
    const placed = applied(document, placeStartCommand(document, { lat: 40.8757, lon: -75.7324 }));
    expect(startLabel(placed)).toBe(DROPPED_PIN_LABEL);
    expect(startLabel(placed, () => "Jim Thorpe, PA")).toBe("Jim Thorpe, PA");
    expect(placed.revision).toBe(1);
  });

  it("an authored label wins over a resolved name", () => {
    const document = createRideDocument();
    const searched = applied(
      document,
      searchedEndpointCommand(document, "start", { label: "Hawk Mountain Sanctuary, PA", coordinate: HAWK.coordinate, provider: "fixture" }, "hawk"),
    );
    expect(startLabel(searched, () => "Kempton, PA")).toBe("Hawk Mountain Sanctuary, PA");
  });

  it("an unnamed GPS start reads as Your location", () => {
    const document = createRideDocument();
    const located = applied(
      document,
      currentLocationStartCommand(document, { coordinate: { lat: 40.6, lon: -75.4 }, accuracyMeters: 8, observedAt: "2026-09-23T00:00:00Z" }),
    );
    expect(startLabel(located)).toBe(YOUR_LOCATION_LABEL);
    expect(startLabel(located, () => "Easton, PA")).toBe("Easton, PA");
  });
});

describe("PlaceSearchField", () => {
  function fakePort(places: readonly PlaceMatch[] | "down"): PlaceSearchPort & { search: ReturnType<typeof vi.fn> } {
    return {
      search: vi.fn(async () =>
        places === "down"
          ? { status: "unavailable" as const, reason: "Place search is unavailable right now." }
          : { status: "ok" as const, places },
      ),
      reverse: async () => null,
    };
  }

  async function typeAndSettle(input: HTMLElement, text: string): Promise<void> {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    await act(async () => {
      vi.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS);
    });
    await act(async () => undefined);
  }

  it("lists results and picks one with the keyboard", async () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    const port = fakePort([JIM_THORPE, HAWK]);
    render(<PlaceSearchField slot="finish" search={port} onPick={onPick} bias={{ lat: 40.6, lon: -75.5 }} />);
    const input = screen.getByRole("combobox", { name: "Search for a destination" });
    await typeAndSettle(input, "hawk");
    expect(port.search).toHaveBeenCalledWith("hawk", expect.objectContaining({ bias: { lat: 40.6, lon: -75.5 } }));
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Jim ThorpeCarbon County, PA",
      "Hawk Mountain SanctuaryKempton, Berks County, PA",
    ]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(HAWK, "hawk");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("Enter before the answer arrives picks the first result when it does", async () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    render(<PlaceSearchField slot="start" search={fakePort([JIM_THORPE])} onPick={onPick} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "jim" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS);
    });
    await act(async () => undefined);
    expect(onPick).toHaveBeenCalledWith(JIM_THORPE, "jim");
  });

  it("Enter as an answer arrives still picks once before React commits the result list", async () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    let resolveSearch!: (answer: Awaited<ReturnType<PlaceSearchPort["search"]>>) => void;
    const response = new Promise<Awaited<ReturnType<PlaceSearchPort["search"]>>>((resolve) => { resolveSearch = resolve; });
    const port: PlaceSearchPort = { search: () => response, reverse: async () => null };
    render(<PlaceSearchField slot="finish" search={port} onPick={onPick} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "hawk" } });
    await act(async () => { vi.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS); });

    await act(async () => {
      resolveSearch({ status: "ok", places: [HAWK] });
      await response;
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(onPick).toHaveBeenCalledExactlyOnceWith(HAWK, "hawk");
    expect(input).toHaveValue("");
  });

  it("says so when nothing matches, and when search is down", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<PlaceSearchField slot="start" search={fakePort([])} onPick={vi.fn()} />);
    await typeAndSettle(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByTestId("start-search-status").textContent).toBe("No places match “zzzz”.");
    unmount();
    render(<PlaceSearchField slot="start" search={fakePort("down")} onPick={vi.fn()} />);
    await typeAndSettle(screen.getByRole("combobox"), "easton");
    expect(screen.getByTestId("start-search-status").textContent).toBe("Place search is unavailable right now.");
  });

  describe("saved places and recents (NV-02)", () => {
    const HOME: PlaceMatch = { ...JIM_THORPE, id: "home", name: "Home", label: "12 Pine St, Emmaus, PA", context: "12 Pine St, Emmaus, PA", provider: "home", coordinate: { lat: 40.54, lon: -75.5 } };
    const memory = (): PlaceMemory => toggleSaved(recordRecent(recordRecent(EMPTY_PLACE_MEMORY, JIM_THORPE), HAWK), HAWK);
    const remembered = (query: string, limit: number) => rememberedPlaces(memory(), HOME, query, limit);

    it("an empty box offers Home, then saved, then recents", () => {
      render(<PlaceSearchField slot="finish" search={fakePort([])} onPick={vi.fn()} remembered={remembered} />);
      fireEvent.focus(screen.getByRole("combobox"));
      const options = screen.getAllByRole("option");
      expect(options.map((option) => option.getAttribute("data-testid"))).toEqual([
        "place-option-home",
        "place-option-saved",
        "place-option-recent",
      ]);
      expect(options[0]?.textContent).toContain("12 Pine St, Emmaus, PA");
      expect(options[1]?.textContent).toContain("Hawk Mountain Sanctuary");
    });

    it("a typed query puts a remembered match first, once, and Enter picks it", async () => {
      vi.useFakeTimers();
      const onPick = vi.fn();
      render(<PlaceSearchField slot="finish" search={fakePort([HAWK, JIM_THORPE])} onPick={onPick} remembered={remembered} />);
      const input = screen.getByRole("combobox");
      await typeAndSettle(input, "jim");
      const ids = screen.getAllByRole("option").map((option) => option.getAttribute("data-testid"));
      // Jim Thorpe from memory, then the geocoder's Hawk; its Jim Thorpe is not repeated.
      expect(ids).toEqual(["place-option-recent", "place-option"]);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onPick).toHaveBeenCalledWith(JIM_THORPE, "jim");
    });
  });

  it("offers Current location first on the start field", () => {
    const onUse = vi.fn();
    render(
      <PlaceSearchField
        slot="start"
        search={fakePort([])}
        onPick={vi.fn()}
        currentLocation={{ onUse, locating: false, failure: null }}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.click(screen.getByTestId("place-option-location"));
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it("shows a location failure in the rider's words", () => {
    render(
      <PlaceSearchField
        slot="start"
        search={fakePort([])}
        onPick={vi.fn()}
        currentLocation={{ onUse: vi.fn(), locating: false, failure: "Location permission is off." }}
      />,
    );
    expect(screen.getByTestId("start-search-status").textContent).toBe("Location permission is off.");
  });

  it("Escape clears the query and closes the list", async () => {
    vi.useFakeTimers();
    render(<PlaceSearchField slot="start" search={fakePort([JIM_THORPE])} onPick={vi.fn()} />);
    const input = screen.getByRole("combobox");
    await typeAndSettle(input, "jim");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});
