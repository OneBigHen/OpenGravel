/**
 * Small-screen v2 §3: the phone Plan sheet. Three detents the handle steps
 * through, and a ride summary that is one headline, one meta line, a full-width
 * Start ride and a quiet Compare rides switch.
 */
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { buildCorridorPackManifest } from "@/domain/offline/capabilities";
import { createRideDocument } from "@/domain/ride/create";
import { asRouteCandidateId } from "@/domain/route/ids";
import { RideSummary } from "@/ui/planner/RideSummary";
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

describe("RideSummary", () => {
  const start = { refusal: null, starting: false, error: null, onStart: vi.fn() };
  const cards = [card("a", true), card("b", false), card("c", false)];
  const base = {
    card: cards[0]!,
    cards,
    start,
    title: "To Hawk Mountain",
    automaticName: "Hawk Mountain loop, 33 mi",
    document: createRideDocument({ now: "2026-10-07T12:00:00.000Z" }),
    libraryService: undefined,
    shareService: undefined,
    route: null,
    routeLine: null,
    elevationSource: undefined,
    onSelect: vi.fn(),
    weatherLine: null,
    comparing: false,
    onCompare: vi.fn(),
  };

  it("shows the name, the time and miles, Start, Save and a Compare rides count", () => {
    const onCompare = vi.fn();
    render(<RideSummary {...base} onCompare={onCompare} />);
    expect(screen.getByTestId("phone-destination").textContent).toBe("To Hawk Mountain");
    expect(screen.getByTestId("route-summary")).toHaveTextContent("53 min");
    expect(screen.getByTestId("route-summary")).toHaveTextContent("33 mi");
    fireEvent.click(screen.getByTestId("start-ride"));
    expect(start.onStart).toHaveBeenCalled();
    expect(screen.getByTestId("summary-save").textContent).toContain("Save");
    fireEvent.click(screen.getByRole("button", { name: "Compare rides (3)" }));
    expect(onCompare).toHaveBeenCalled();
    expect(screen.queryByTestId("phone-weather")).toBeNull();
  });

  it("always shows the three honest lines, saying so when the surface was not measured", () => {
    render(<RideSummary {...base} />);
    expect(screen.getByTestId("phone-surface-line")).toHaveTextContent("Surface unknown");
    expect(screen.getByTestId("ride-truth").querySelectorAll(".og-truth__line")).toHaveLength(3);
  });

  it("keeps the arrival time steady when the page is reopened with no new input (QA-25)", () => {
    vi.useFakeTimers();
    try {
      const planned = { ...cards[0]!, durationSeconds: 3_600, plannedAt: "2026-11-14T01:00:00.000Z" };
      vi.setSystemTime(new Date("2026-11-14T01:00:00.000Z"));
      const first = render(<RideSummary {...base} card={planned} />);
      const arrival = screen.getByTestId("route-summary").textContent;
      expect(arrival).toContain("Arrive");
      first.unmount();

      // A refresh 37 minutes later, same plan: the arrival is the plan's own.
      vi.setSystemTime(new Date("2026-11-14T01:37:00.000Z"));
      render(<RideSummary {...base} card={planned} />);
      expect(screen.getByTestId("route-summary").textContent).toBe(arrival);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the rider a basic route is basic, as a sentence above Start and in the meta line", () => {
    const message = "Basic route — OpenGravel's curvy and gravel tuning covers PA, NJ and NY only.";
    render(<RideSummary {...base} showPlanNotices card={{ ...cards[0]!, notices: [message], badges: ["Basic routing"] }} />);
    // The phone directions view is the summary with no choices list under it,
    // so the plan's own sentence has to be in the summary, above the buttons.
    expect(screen.getByTestId("route-plan-notice").textContent).toBe(message);
    expect(screen.getByTestId("route-summary").querySelector(".og-phone-summary__meta")).toHaveTextContent("Basic routing");
  });


  it("hides the compare switch when there is only one ride", () => {
    render(<RideSummary {...base} cards={[cards[0]!]} />);
    expect(screen.queryByTestId("compare-rides")).toBeNull();
  });

  it("says how much is gravel and how much is unknown, with a bar, when the surface was measured", () => {
    const measured = { ...cards[0]!, distanceMeters: 62 * 1609.344, surfaceStrip: { paved: 0.54, gravel: 0.41, dirt: 0, unknown: 0.05 } };
    render(<RideSummary {...base} card={measured} />);
    expect(screen.getByTestId("phone-surface-line")).toHaveTextContent("41% gravel · 3 mi surface unknown");
    expect(screen.getByTestId("phone-surface-strip").getAttribute("aria-label")).toBe("Surface: 54% paved, 41% gravel, 0% dirt, 5% unknown");
  });

  it("marks an unmeasured surface as unknown, not as a gravel-toned warning (QA-10)", () => {
    const measured = { ...cards[0]!, distanceMeters: 62 * 1609.344, surfaceStrip: { paved: 0.54, gravel: 0.41, dirt: 0, unknown: 0.05 } };
    render(<RideSummary {...base} card={measured} />);
    // The amber dot is the gravel swatch's colour. "Some of this was not
    // measured" gets the unknown mark, which is the hatch the bar uses.
    const line = screen.getByTestId("phone-surface-line").closest(".og-truth__line");
    expect(line?.getAttribute("data-tone")).toBe("unknown");
    expect(line?.querySelector(".og-truth__dot")?.getAttribute("data-tone")).toBe("unknown");
    const legend = screen.getByTestId("phone-surface-legend");
    expect(legend.querySelector('[data-surface="paved"]')).not.toBeNull();
    expect(legend.querySelector('[data-surface="unknown"]')).not.toBeNull();
  });

  it("says where the ride goes above the time", () => {    render(<RideSummary {...base} title="To Hawk Mountain Sanctuary" />);
    expect(screen.getByTestId("phone-destination").textContent).toBe("To Hawk Mountain Sanctuary");
  });

  it("lists the alternatives while comparing and selects one", () => {
    const onSelect = vi.fn();
    render(<RideSummary {...base} comparing onCompare={vi.fn()} onSelect={onSelect} weatherLine="Rain after 3 pm" />);
    const list = screen.getByTestId("phone-alternatives");
    expect(list.querySelectorAll("button")).toHaveLength(3);
    fireEvent.click(list.querySelectorAll("button")[1]!);
    expect(onSelect).toHaveBeenCalledWith(cards[1]!.routeId);
    expect(screen.getByTestId("phone-weather").textContent).toBe("Rain after 3 pm");
  });

  it("puts 'Back to ride' above the options, where the ride style can never cover it", () => {
    render(<RideSummary {...base} comparing onCompare={vi.fn()} />);
    const back = screen.getByRole("button", { name: "Back to ride" });
    const list = screen.getByTestId("phone-alternatives");
    expect(back.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("saving a ride in one tap", () => {
  const start = { refusal: null, starting: false, error: null, onStart: vi.fn() };
  const line = [
    { lon: -75, lat: 40 },
    { lon: -75.1, lat: 40.1 },
  ] as const;
  const route = {
    routeKey: "route_1",
    rideId: "ride_save",
    routeRevision: 0,
    geometry: line,
    summary: { distanceMeters: 12_000, durationSeconds: 1_800 },
    pack: buildCorridorPackManifest({
      rideId: "ride_save",
      routeRevision: 0,
      geometry: line,
      createdAt: "2026-10-07T12:00:00.000Z",
    }),
    instructionsAvailable: false,
  };
  const base = {
    card: card("a", true, { distanceMeters: 85_290, durationSeconds: 5_400 }),
    cards: [card("a", true, { distanceMeters: 85_290, durationSeconds: 5_400 })],
    start,
    title: "Rothrock loop",
    automaticName: "Rothrock loop, 53 mi",
    document: createRideDocument({ now: "2026-10-07T12:00:00.000Z" }),
    shareService: undefined,
    route,
    routeLine: null,
    elevationSource: undefined,
    onSelect: vi.fn(),
    weatherLine: null,
    comparing: false,
    onCompare: vi.fn(),
  };

  it("saves under the automatic name and turns the button into Saved", async () => {
    const saveNamed = vi.fn<(document: unknown, options: unknown) => Promise<{ document: ReturnType<typeof createRideDocument>; savedAt: string }>>();
    saveNamed.mockResolvedValue({
      document: createRideDocument({ now: "2026-10-07T12:00:00.000Z" }),
      savedAt: "2026-10-07T12:00:00.000Z",
    });
    render(<RideSummary {...base} libraryService={{ saveNamed } as never} />);
    fireEvent.click(screen.getByTestId("summary-save"));
    await waitFor(() => expect(saveNamed).toHaveBeenCalledOnce());
    expect(saveNamed.mock.calls[0]?.[1]).toMatchObject({
      title: "Rothrock loop, 53 mi",
      plannedRoute: { geometry: line, distanceMeters: 12_000, durationSeconds: 1_800 },
      bundleSummary: { distanceMeters: 12_000, durationSeconds: 1_800 },
    });
    expect(await screen.findByTestId("summary-save")).toHaveTextContent("Saved");
    expect(screen.getByTestId("summary-save")).toBeDisabled();
  });

  it("makes the saved title editable in place", async () => {
    const saveNamed = vi.fn(async () => ({
      document: createRideDocument({ now: "2026-10-07T12:00:00.000Z" }),
      savedAt: "2026-10-07T12:00:00.000Z",
    }));
    const renameRide = vi.fn(async () => undefined);
    render(<RideSummary {...base} libraryService={{ saveNamed, renameRide } as never} />);
    fireEvent.click(screen.getByTestId("summary-save"));
    fireEvent.click(await screen.findByTestId("ride-title-edit"));
    fireEvent.change(screen.getByTestId("ride-title-input"), { target: { value: "Sunday gravel" } });
    fireEvent.submit(screen.getByTestId("ride-title-input").closest("form")!);
    await waitFor(() => expect(renameRide).toHaveBeenCalledOnce());
    expect(screen.getByTestId("phone-destination").textContent).toBe("Sunday gravel");
    expect(screen.queryByTestId("ride-title-input")).toBeNull();
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
    setLoopHeading: vi.fn(),
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
    loopHeading: "any" as const,
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
  // The data a card already carries: its colour slot, its curviness and surface
  // for the strip, the miles and busy share its one word is measured from, and
  // the minutes it adds over the quickest option.
  const options = [
    card("a", true, {
      roleKey: "best-ride",
      roleLabel: "Best Ride",
      tint: 0,
      curviness: { level: 5, label: "Twisty" },
      surfaceStrip: { paved: 0.8, gravel: 0, dirt: 0.2, unknown: 0 },
      measurements: { curvyMi: 18.4, unpavedMi: 6.6, busyShare: 0.31 },
      addedTimeLabel: "+3 min vs Fastest",
      addedMinutes: 3,
    }),
    card("b", false, {
      roleKey: "fastest",
      roleLabel: "Fastest",
      tint: 1,
      curviness: { level: 2, label: "Mostly straight" },
      surfaceStrip: { paved: 0.9, gravel: 0, dirt: 0.1, unknown: 0 },
      measurements: { curvyMi: 4.2, unpavedMi: 3.3, busyShare: 0.55 },
      addedMinutes: 0,
    }),
    card("c", false, {
      roleKey: "alternative",
      roleLabel: "Alternative",
      tint: 2,
      curviness: { level: 3, label: "Curvy" },
      surfaceStrip: { paved: 0.1, gravel: 0, dirt: 0.9, unknown: 0 },
      measurements: { curvyMi: 9.1, unpavedMi: 29.7, busyShare: 0.12 },
      addedTimeLabel: "+9 min vs Fastest",
      addedMinutes: 9,
    }),
  ];
  const base = {
    card: options[0]!,
    cards: options,
    start,
    title: "Loop from Rothrock",
    automaticName: "Rothrock loop, 42 mi",
    document: createRideDocument({ now: "2026-10-07T12:00:00.000Z" }),
    libraryService: undefined,
    shareService: undefined,
    route: null,
    routeLine: null,
    elevationSource: undefined,
    onSelect: vi.fn(),
    weatherLine: null,
    comparing: true,
    onCompare: vi.fn(),
  };

  it("names each option by what it is, never a repeated 'Alternative'", () => {
    render(<RideSummary {...base} />);
    const rows = Array.from(screen.getByTestId("phone-alternatives").querySelectorAll("button"));
    expect(rows).toHaveLength(3);
    // The row's colour is the colour of its own line on the map.
    expect(rows.map((row) => row.getAttribute("data-tint"))).toEqual(["0", "1", "2"]);
    expect(rows[0]!.querySelector(".og-phone-choice__role")?.textContent).toBe("Twistiest");
    expect(rows[1]!.querySelector(".og-phone-choice__role")?.textContent).toBe("Option 2");
    expect(rows[2]!.querySelector(".og-phone-choice__role")?.textContent).toBe("Most dirt");
    // The numbers and the cost over the fastest stay.
    expect(rows[0]!.querySelector(".og-phone-choice__meta")?.textContent).toBe("53 min · 33 mi");
    expect(rows[0]!.textContent).toContain("+3 min");
    expect(rows[1]!.textContent).not.toContain("+0 min");
    expect(rows[2]!.textContent).toContain("+9 min");
  });

  it("names an unroled option by its measured difference", () => {
    const loose = [
      card("x", true, { addedMinutes: 0, measurements: { curvyMi: 2.4, unpavedMi: null, busyShare: null } }),
      card("y", false, { addedMinutes: 6, measurements: { curvyMi: 15.8, unpavedMi: null, busyShare: null } }),
    ];
    render(<RideSummary {...base} cards={loose} card={loose[0]!} />);
    const rows = screen.getByTestId("phone-alternatives").querySelectorAll("button");
    expect(rows[0]!.querySelector(".og-phone-choice__role")?.textContent).toBe("Fastest");
    expect(rows[1]!.querySelector(".og-phone-choice__role")?.textContent).toBe("Twistiest");
    expect(rows[1]!.textContent).toContain("+6 min");
  });

  it("names the quietest option in the same place as the other words", () => {
    const quiet = [
      card("x", true, { addedMinutes: 0, measurements: { curvyMi: 3.2, unpavedMi: null, busyShare: 0.44 } }),
      card("y", false, { addedMinutes: 7, measurements: { curvyMi: 3.2, unpavedMi: null, busyShare: 0.11 } }),
    ];
    render(<RideSummary {...base} cards={quiet} card={quiet[0]!} />);
    const rows = screen.getByTestId("phone-alternatives").querySelectorAll("button");
    expect(rows[0]!.querySelector(".og-phone-choice__role")?.textContent).toBe("Fastest");
    expect(rows[1]!.querySelector(".og-phone-choice__role")?.textContent).toBe("Fewest busy roads");
  });

  it("marks the selected row and keeps the colour cue off the words alone", () => {
    const onSelect = vi.fn();
    render(<RideSummary {...base} onSelect={onSelect} />);
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
    render(<RideSummary {...base} rideStyle={model} />);
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
    render(<RideSummary {...base} comparing={false} rideStyle={model} />);
    const surface = screen.getByTestId("phone-surface");
    expect((within(surface).getByLabelText("Mostly paved") as HTMLInputElement).checked).toBe(true);
  });
});

