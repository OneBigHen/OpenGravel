/**
 * Small-screen v2 §3: the phone Plan sheet. Three detents the handle steps
 * through, and a ride summary that is one headline, one meta line, a full-width
 * Start ride and a quiet Compare rides switch.
 */
import { cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { asRouteCandidateId } from "@/domain/route/ids";
import { PhoneRideSummary } from "@/ui/planner/PhoneRideSummary";
import type { RideStyleControlsModel } from "@/ui/planner/RideStyleControls";
import { usePlannerSheetActions } from "@/ui/planner/hooks/usePlannerSheetActions";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import { createPlanningSessionStore } from "@/ui/stores/planning-session-store";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubPhone(matches: boolean): void {
  vi.stubGlobal("matchMedia", () => ({ matches, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

function card(id: string, selected: boolean, overrides: Partial<RouteCardVm> = {}): RouteCardVm {
  return {
    routeId: asRouteCandidateId(id),
    roleKey: "best-ride",
    roleLabel: id,
    durationLabel: "53 min",
    distanceLabel: "33 mi",
    addedTimeLabel: null,
    badges: [],
    unknownSurfaceMi: null,
    whyKey: id,
    isSelected: selected,
    ...overrides,
  };
}

describe("phone sheet detents", () => {
  it("steps peek -> half -> full on a swipe up and back down", () => {
    stubPhone(true);
    const ui = createPlannerUiStore();
    ui.getState().setSheetDetent("peek");
    const { result } = renderHook(() => usePlannerSheetActions(ui, createPlanningSessionStore()));
    act(() => result.current.onStepSheet("up"));
    expect(ui.getState().sheetDetent).toBe("half");
    act(() => result.current.onStepSheet("up"));
    expect(ui.getState().sheetDetent).toBe("expanded");
    act(() => result.current.onStepSheet("down"));
    expect(ui.getState().sheetDetent).toBe("half");
    act(() => result.current.onStepSheet("down"));
    expect(ui.getState().sheetDetent).toBe("peek");
  });

  it("cycles on a handle tap", () => {
    stubPhone(true);
    const ui = createPlannerUiStore();
    ui.getState().setSheetDetent("peek");
    const { result } = renderHook(() => usePlannerSheetActions(ui, createPlanningSessionStore()));
    act(() => result.current.onToggleSheet());
    expect(ui.getState().sheetDetent).toBe("half");
    act(() => result.current.onToggleSheet());
    expect(ui.getState().sheetDetent).toBe("expanded");
    act(() => result.current.onToggleSheet());
    expect(ui.getState().sheetDetent).toBe("peek");
  });
});

describe("PhoneRideSummary", () => {
  const start = { refusal: null, starting: false, error: null, onStart: vi.fn() };
  const cards = [card("a", true), card("b", false), card("c", false)];
  const base = { card: cards[0]!, cards, start, route: null, elevationSource: undefined, onSelect: vi.fn(), weatherLine: null };

  it("shows the headline, Start ride and a Compare rides count", () => {
    const onCompare = vi.fn();
    render(<PhoneRideSummary {...base} comparing={false} onCompare={onCompare} />);
    expect(screen.getByRole("heading", { name: "53 min · 33 mi" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("start-ride"));
    expect(start.onStart).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Compare rides (3)" }));
    expect(onCompare).toHaveBeenCalled();
    expect(screen.queryByTestId("phone-weather")).toBeNull();
  });

  it("says where the ride goes above the headline", () => {
    render(<PhoneRideSummary {...base} comparing={false} onCompare={vi.fn()} destinationLine="To Hawk Mountain Sanctuary" />);
    expect(screen.getByTestId("phone-destination").textContent).toBe("To Hawk Mountain Sanctuary");
  });

  it("lists the alternatives while comparing and selects one", () => {
    const onSelect = vi.fn();
    render(<PhoneRideSummary {...base} comparing onCompare={vi.fn()} onSelect={onSelect} weatherLine="Rain after 3 pm" />);
    const list = screen.getByTestId("phone-alternatives");
    expect(list.querySelectorAll("button")).toHaveLength(3);
    fireEvent.click(list.querySelectorAll("button")[1]!);
    expect(onSelect).toHaveBeenCalledWith(cards[1]!.routeId);
    expect(screen.getByTestId("phone-weather").textContent).toBe("Rain after 3 pm");
  });
});

/** Ride style as the composer projects it; the row only reads and dispatches. */
function rideStyle(overrides: Partial<RideStyleControlsModel["view"]> = {}): {
  model: RideStyleControlsModel;
  actions: { setRoadCharacter: ReturnType<typeof vi.fn>; setSurface: ReturnType<typeof vi.fn> };
} {
  const actions = {
    setBike: vi.fn(),
    setShape: vi.fn(),
    setLoopMinutes: vi.fn(),
    setRoadCharacter: vi.fn(),
    setNoveltyPreference: vi.fn(),
    setTraffic: vi.fn(),
    setSurface: vi.fn(),
    setAvoidHighways: vi.fn(),
    setAvoidTolls: vi.fn(),
    setDeparture: vi.fn(),
  };
  const view = {
    shape: "destination" as const,
    loopMinutes: 120,
    roadCharacter: "balanced" as const,
    noveltyPreference: "balanced" as const,
    surface: "mixed" as const,
    traffic: "protect-ride" as const,
    avoidHighways: false,
    avoidTolls: true,
    ...overrides,
  };
  return { model: { view, actions }, actions };
}

describe("phone ride options", () => {
  const start = { refusal: null, starting: false, error: null, onStart: vi.fn() };
  // The data a card already carries: its colour slot, its curviness, its dirt
  // share and the minutes it adds over the quickest option.
  const options = [
    card("a", true, {
      roleKey: "best-ride",
      roleLabel: "Best Ride",
      tint: 0,
      curviness: { level: 5, label: "Twisty" },
      surfaceStrip: { paved: 0.8, gravel: 0, dirt: 0.2, unknown: 0 },
      addedTimeLabel: "+3 min vs Fastest",
      addedMinutes: 3,
    }),
    card("b", false, {
      roleKey: "fastest",
      roleLabel: "Fastest",
      tint: 1,
      curviness: { level: 2, label: "Mostly straight" },
      surfaceStrip: { paved: 0.9, gravel: 0, dirt: 0.1, unknown: 0 },
      addedMinutes: 0,
    }),
    card("c", false, {
      roleKey: "alternative",
      roleLabel: "Alternative",
      tint: 2,
      curviness: { level: 3, label: "Curvy" },
      surfaceStrip: { paved: 0.1, gravel: 0, dirt: 0.9, unknown: 0 },
      addedTimeLabel: "+9 min vs Fastest",
      addedMinutes: 9,
    }),
  ];
  const base = {
    card: options[0]!,
    cards: options,
    start,
    route: null,
    elevationSource: undefined,
    onSelect: vi.fn(),
    weatherLine: null,
  };

  it("draws one row per option with its colour, numbers, character word and cost", () => {
    render(<PhoneRideSummary {...base} comparing onCompare={vi.fn()} />);
    const rows = Array.from(screen.getByTestId("phone-alternatives").querySelectorAll("button"));
    expect(rows).toHaveLength(3);
    // The row's colour is the colour of its own line on the map.
    expect(rows.map((row) => row.getAttribute("data-tint"))).toEqual(["0", "1", "2"]);
    expect(rows[0]!.textContent).toContain("Best Ride");
    expect(rows[0]!.textContent).toContain("53 min · 33 mi");
    expect(rows[0]!.textContent).toContain("Twistiest");
    expect(rows[0]!.textContent).toContain("+3 min");
    // "Fastest" already says the quickest, so the word would only repeat it.
    expect(rows[1]!.textContent).toContain("Fastest");
    expect(rows[1]!.textContent).not.toContain("Quickest");
    expect(rows[1]!.textContent).not.toContain("+0 min");
    expect(rows[2]!.textContent).toContain("Alternative");
    expect(rows[2]!.textContent).toContain("Most dirt");
    expect(rows[2]!.textContent).toContain("+9 min");
  });

  it("gives an unroled option its own word", () => {
    const loose = [
      card("x", true, { addedMinutes: 0, curviness: { level: 2, label: "Mostly straight" } }),
      card("y", false, { addedMinutes: 6, curviness: { level: 4, label: "Curvy" } }),
    ];
    render(<PhoneRideSummary {...base} cards={loose} card={loose[0]!} comparing onCompare={vi.fn()} />);
    const rows = screen.getByTestId("phone-alternatives").querySelectorAll("button");
    expect(rows[0]!.textContent).toContain("Quickest");
    expect(rows[1]!.textContent).toContain("Twistiest");
    expect(rows[1]!.textContent).toContain("+6 min");
  });

  it("marks the selected row and keeps the colour cue off the words alone", () => {
    const onSelect = vi.fn();
    render(<PhoneRideSummary {...base} comparing onCompare={vi.fn()} onSelect={onSelect} />);
    const rows = Array.from(screen.getByTestId("phone-alternatives").querySelectorAll("button"));
    expect(rows[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(rows[0]!.getAttribute("data-selected")).toBe("true");
    expect(rows[1]!.getAttribute("aria-pressed")).toBe("false");
    // One tick, in the selected row only.
    expect(rows[0]!.querySelectorAll("svg")).toHaveLength(1);
    expect(rows[1]!.querySelectorAll("svg")).toHaveLength(0);
    fireEvent.click(rows[2]!);
    expect(onSelect).toHaveBeenCalledWith(options[2]!.routeId);
  });

  it("reshapes the ride from under the options with the composer's own ride style", () => {
    const { model, actions } = rideStyle();
    render(<PhoneRideSummary {...base} comparing onCompare={vi.fn()} rideStyle={model} />);
    const roads = screen.getByTestId("phone-roads");
    expect(Array.from(roads.querySelectorAll("label")).map((label) => label.textContent)).toEqual([
      "Fast",
      "Balanced",
      "Curvy",
      "Backroads",
    ]);
    // The current preference is the checked one; a tap hands that choice back.
    expect((within(roads).getByLabelText("Balanced") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(roads).getByLabelText("Backroads"));
    expect(actions.setRoadCharacter).toHaveBeenCalledWith("backroads");

    const surface = screen.getByTestId("phone-surface");
    fireEvent.click(within(surface).getByLabelText("Dirt OK"));
    expect(actions.setSurface).toHaveBeenCalledWith("dirt-preferred");
  });

  it("shows a surface preference the short row does not lead with", () => {
    const { model } = rideStyle({ surface: "mostly-pavement" });
    render(<PhoneRideSummary {...base} comparing={false} onCompare={vi.fn()} rideStyle={model} />);
    const surface = screen.getByTestId("phone-surface");
    expect((within(surface).getByLabelText("Mostly paved") as HTMLInputElement).checked).toBe(true);
  });
});
