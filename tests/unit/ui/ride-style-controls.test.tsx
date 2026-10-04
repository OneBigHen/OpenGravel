/**
 * Ride style controls (MVP parity M2, OGV-D-262).
 *
 * Pins the rider-visible contract: every control is a native radio or switch,
 * each change is one typed command that the reducer applies, and the compact
 * summary names the current choices.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRideDocument } from "@/domain/ride/create";
import { applyRideCommand } from "@/domain/ride/reducer";
import type { RideDocument } from "@/domain/ride/types";
import {
  formatRideTime,
  LoopTimeRow,
  RideShapeSwitch,
  RideStylePanel,
  rideStyleSummary,
  type RideStyleActions,
  type RideStyleView,
} from "@/ui/planner/RideStyleControls";
import {
  highwayPolicyCommand,
  loopTimeCommand,
  rideShapeCommand,
  roadCharacterCommand,
  noveltyPreferenceCommand,
  surfacePreferenceCommand,
  tollPolicyCommand,
  trafficPreferenceCommand,
} from "@/ui/stores/ride-document-store";

afterEach(() => cleanup());

const VIEW: RideStyleView = {
  shape: "destination",
  loopMinutes: 120,
  roadCharacter: "balanced",
  noveltyPreference: "balanced",
  surface: "mixed",
  traffic: "protect-ride",
  avoidHighways: false,
  avoidTolls: false,
};

function actions() {
  return {
    setBike: vi.fn(),
    setShape: vi.fn<RideStyleActions["setShape"]>(),
    setLoopMinutes: vi.fn<RideStyleActions["setLoopMinutes"]>(),
    setRoadCharacter: vi.fn<RideStyleActions["setRoadCharacter"]>(),
    setNoveltyPreference: vi.fn<RideStyleActions["setNoveltyPreference"]>(),
    setTraffic: vi.fn<RideStyleActions["setTraffic"]>(),
    setSurface: vi.fn<RideStyleActions["setSurface"]>(),
    setAvoidHighways: vi.fn<RideStyleActions["setAvoidHighways"]>(),
    setAvoidTolls: vi.fn<RideStyleActions["setAvoidTolls"]>(),
    setDeparture: vi.fn<RideStyleActions["setDeparture"]>(),
  };
}

function applied(document: RideDocument, command: Parameters<typeof applyRideCommand>[1]): RideDocument {
  const result = applyRideCommand(document, command);
  if (result.outcome !== "applied") throw new Error(`expected applied, got ${result.outcome}`);
  return result.document;
}

describe("ride style commands", () => {
  it("each choice is one applied command that changes the intent", () => {
    let document = createRideDocument();
    document = applied(document, rideShapeCommand(document, "loop"));
    expect(document.intent.shape).toBe("loop");
    document = applied(document, loopTimeCommand(document, 180, 27));
    expect(document.intent.time).toEqual({ kind: "budget", targetMinutes: 180, toleranceMinutes: 27 });
    document = applied(document, roadCharacterCommand(document, "curvy"));
    expect(document.intent.roadCharacter).toBe("curvy");
    document = applied(document, noveltyPreferenceCommand(document, "prefer-new-to-me"));
    expect(document.intent.noveltyPreference).toBe("prefer-new-to-me");
    document = applied(document, surfacePreferenceCommand(document, "pavement"));
    expect(document.intent.surface.preference).toBe("pavement");
    document = applied(document, highwayPolicyCommand(document, true));
    expect(document.intent.avoidHighways).toBe(true);
    // Tolls are avoided by default; the switch lets them back in.
    document = applied(document, tollPolicyCommand(document, false));
    expect(document.intent.tollPolicy).toBe("allow-with-warning");
  });
});

describe("ride style controls", () => {
  it("the shape switch offers a destination or a loop", () => {
    const spy = actions();
    render(<RideShapeSwitch model={{ view: VIEW, actions: spy }} />);
    expect(screen.getByTestId("ride-shape-destination")).toBeChecked();
    fireEvent.click(screen.getByTestId("ride-shape-loop"));
    expect(spy.setShape).toHaveBeenCalledWith("loop");
  });

  it("the loop row picks a ride time", () => {
    const spy = actions();
    render(<LoopTimeRow model={{ view: { ...VIEW, shape: "loop" }, actions: spy }} />);
    expect(screen.getByTestId("loop-time-120")).toBeChecked();
    expect(screen.getByText("45 min")).toBeInTheDocument();
    expect(screen.getByText("1 h 30 min")).toBeInTheDocument();
    expect(screen.getByText("3 h")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("loop-time-240"));
    expect(spy.setLoopMinutes).toHaveBeenCalledWith(240);
  });

  it("the panel sets road character, surface, highways and tolls", () => {
    const spy = actions();
    render(<RideStylePanel model={{ view: VIEW, actions: spy }} />);
    fireEvent.click(screen.getByTestId("road-character-curvy"));
    expect(spy.setRoadCharacter).toHaveBeenCalledWith("curvy");
    fireEvent.click(screen.getByTestId("novelty-preference-prefer-new-to-me"));
    expect(spy.setNoveltyPreference).toHaveBeenCalledWith("prefer-new-to-me");
    fireEvent.click(screen.getByTestId("surface-preference-pavement"));
    expect(spy.setSurface).toHaveBeenCalledWith("pavement");
    fireEvent.click(screen.getByTestId("avoid-highways"));
    expect(spy.setAvoidHighways).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("avoid-tolls"));
    expect(spy.setAvoidTolls).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("avoid-tolls")).toHaveAttribute("role", "switch");
  });

  it("the compact toggle discloses the panel and summarizes the choices", () => {
    render(
      <RideStylePanel
        model={{ view: { ...VIEW, roadCharacter: "curvy", noveltyPreference: "prefer-new-to-me", surface: "pavement", avoidTolls: true }, actions: actions() }}
      />,
    );
    const toggle = screen.getByTestId("ride-style-toggle");
    expect(screen.getByTestId("ride-style-summary")).toHaveTextContent("Curvy · New to me · Paved · Avoid busy roads · No tolls");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")).toHaveAttribute("data-open", "true");
  });

  it("formats ride times and summaries plainly", () => {
    expect(formatRideTime(60)).toBe("1 h");
    expect(formatRideTime(90)).toBe("1 h 30 min");
    expect(formatRideTime(45)).toBe("45 min");
    expect(rideStyleSummary({ ...VIEW, avoidHighways: true })).toBe("Balanced · Mixed · Avoid busy roads · No highways");
  });
});

describe("traffic chips", () => {
  it("dispatches the traffic preference and applies the existing reducer command", () => {
    const callbacks = actions();
    render(<RideStylePanel model={{ view: VIEW, actions: callbacks }} />);
    fireEvent.click(screen.getByTestId("traffic-preference-minimize-delay"));
    expect(callbacks.setTraffic).toHaveBeenCalledWith("minimize-delay");
    const document = createRideDocument();
    expect(applied(document, trafficPreferenceCommand(document, "minimize-delay")).intent.traffic).toBe("minimize-delay");
  });
});

it("shows the active traffic choice in the collapsed style summary", () => {
  expect(rideStyleSummary({ ...VIEW, traffic: "minimize-delay" })).toContain("Fastest");
});
