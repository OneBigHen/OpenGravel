/**
 * Small-screen v2 §3: the phone Plan sheet. Three detents the handle steps
 * through, and a ride summary that is one headline, one meta line, a full-width
 * Start ride and a quiet Compare rides switch.
 */
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { asRouteCandidateId } from "@/domain/route/ids";
import { PhoneRideSummary } from "@/ui/planner/PhoneRideSummary";
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

function card(id: string, selected: boolean): RouteCardVm {
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
