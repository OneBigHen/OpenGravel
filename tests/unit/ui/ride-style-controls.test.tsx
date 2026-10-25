/**
 * Ride style controls (MVP parity M2, OGV-D-262).
 *
 * Pins the rider-visible contract: every control is a native radio or switch,
 * each change is one typed command that the reducer applies, and the compact
 * summary names the current choices.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRideDocument } from "@/domain/ride/create";
import { applyRideCommand } from "@/domain/ride/reducer";
import type { RideDocument } from "@/domain/ride/types";
import {
  formatRideTime,
  LOOP_MAX_MINUTES,
  LoopDirectionRow,
  LoopTimeRow,
  RideShapeSwitch,
  RideStylePanel,
  rideStyleSummary,
  type RideStyleActions,
  type RideStyleView,
} from "@/ui/planner/RideStyleControls";
import {
  highwayPolicyCommand,
  loopHeadingCommand,
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
  loopHeading: "any",
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
    setLoopHeading: vi.fn<RideStyleActions["setLoopHeading"]>(),
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

  it("the direction row offers any way and the four compass directions", () => {
    const spy = actions();
    render(<LoopDirectionRow model={{ view: { ...VIEW, shape: "loop" }, actions: spy }} />);

    // Any way is the default the engine starts from; nothing else is chosen.
    expect(screen.getByTestId("loop-heading-any")).toBeChecked();
    expect(screen.getByTestId("loop-heading-north")).not.toBeChecked();
    expect(screen.getByRole("radiogroup", { name: "Which way?" }).querySelectorAll("input")).toHaveLength(5);
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("West")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("loop-heading-north"));
    expect(spy.setLoopHeading).toHaveBeenCalledWith("north");
  });

  it("shows the authored heading as the chosen chip and applies it as one command", () => {
    let document = createRideDocument();
    document = applied(document, loopHeadingCommand(document, "south"));
    expect(document.intent.loopHeading).toBe("south");

    render(
      <LoopDirectionRow
        model={{ view: { ...VIEW, shape: "loop", loopHeading: document.intent.loopHeading ?? "any" }, actions: actions() }}
      />,
    );
    expect(screen.getByTestId("loop-heading-south")).toBeChecked();
    expect(screen.getByTestId("loop-heading-any")).not.toBeChecked();
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
    // The row carries a short value — the road and the surface. The rest of the
    // panel's choices are inside it, where the chips already show their state.
    expect(screen.getByTestId("ride-style-summary")).toHaveTextContent("Curvy · Paved");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")).toHaveAttribute("data-open", "true");
  });

  it("formats ride times and summaries plainly", () => {
    expect(formatRideTime(60)).toBe("1 h");
    expect(formatRideTime(90)).toBe("1 h 30 min");
    expect(formatRideTime(45)).toBe("45 min");
    // Highways and tolls live inside the panel, so they never lengthen the row.
    expect(rideStyleSummary({ ...VIEW, avoidHighways: true })).toBe("Balanced · Mixed");
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

/** Jim Thorpe, PA: sunsets at 22:11Z on 2026-10-23, i.e. 18:11 EDT. */
const JIM_THORPE = { lat: 40.8676, lon: -75.7327 };

function loopRow(overrides: Partial<RideStyleView>, now?: Date): ReturnType<typeof actions> {
  const spy = actions();
  render(
    <LoopTimeRow
      model={{ view: { ...VIEW, shape: "loop", startCoordinate: JIM_THORPE, ...overrides }, actions: spy }}
      {...(now === undefined ? {} : { now })}
    />,
  );
  return spy;
}

/** The row with the authored loop time actually applied, as the store does. */
function AuthoredLoopRow({ initialMinutes, now }: { readonly initialMinutes: number; readonly now: Date }) {
  const [loopMinutes, setLoopMinutes] = useState(initialMinutes);
  return (
    <LoopTimeRow
      model={{
        view: { ...VIEW, shape: "loop", startCoordinate: JIM_THORPE, loopMinutes },
        actions: { ...actions(), setLoopMinutes },
      }}
      now={now}
    />
  );
}

describe("back by sunset", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the daylight left at the start point, first in the row", () => {
    // 13:00 EDT: just over six hours of light, less the 20-minute margin.
    const spy = loopRow({}, new Date("2026-10-23T17:00:00.000Z"));
    const chips = screen.getByTestId("loop-time").querySelectorAll("input");

    expect(screen.getByTestId("loop-time-sunset")).toBeInTheDocument();
    expect(chips[0]).toBe(screen.getByTestId("loop-time-sunset"));
    expect(screen.getByTestId("loop-time-sunset").closest("label")).toHaveTextContent("Until sunset · 4 h 50 min");
    fireEvent.click(screen.getByTestId("loop-time-sunset"));
    expect(spy.setLoopMinutes).toHaveBeenCalledWith(290);
  });

  it("shows the sunset chip as chosen instead of a plain chip with the same minutes", () => {
    // 10:30 EDT: more light than the longest loop, so the value is the 6 h cap.
    render(<AuthoredLoopRow initialMinutes={240} now={new Date("2026-10-23T14:30:00.000Z")} />);
    const sunset = screen.getByTestId("loop-time-sunset");

    expect(screen.getByText(`Until sunset · ${formatRideTime(LOOP_MAX_MINUTES)}`)).toBeInTheDocument();
    fireEvent.click(sunset);
    expect(sunset).toBeChecked();
    expect(screen.getByTestId(`loop-time-${LOOP_MAX_MINUTES}`)).not.toBeChecked();

    // A plain chip takes the highlight back with the same minutes state.
    fireEvent.click(screen.getByTestId("loop-time-240"));
    expect(sunset).not.toBeChecked();
    expect(screen.getByTestId("loop-time-240")).toBeChecked();
  });

  it("hides the chip when there is no start point or no useful daylight", () => {
    loopRow({ startCoordinate: null }, new Date("2026-10-23T17:00:00.000Z"));
    expect(screen.queryByTestId("loop-time-sunset")).not.toBeInTheDocument();
    cleanup();

    // 17:40 EDT: half an hour of light is not a loop.
    loopRow({ loopMinutes: 60 }, new Date("2026-10-23T21:40:00.000Z"));
    expect(screen.queryByTestId("loop-time-sunset")).not.toBeInTheDocument();
    expect(screen.getByTestId("loop-time-60")).toBeChecked();
    cleanup();

    // Nor does the sun set at all on a far-north midsummer day.
    loopRow({ startCoordinate: { lat: 78, lon: 15 } }, new Date("2026-06-21T12:00:00.000Z"));
    expect(screen.queryByTestId("loop-time-sunset")).not.toBeInTheDocument();
  });

  it("recomputes once a minute while the row is shown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T16:00:00.000Z"));
    loopRow({ loopMinutes: 120 });
    expect(screen.getByTestId("loop-time-sunset").closest("label")).toHaveTextContent("Until sunset · 5 h 50 min");

    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(screen.getByTestId("loop-time-sunset").closest("label")).toHaveTextContent("Until sunset · 5 h 45 min");
  });

  it("runs a clock only while the loop row is shown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T16:00:00.000Z"));
    render(<RideShapeSwitch model={{ view: VIEW, actions: actions() }} />);
    expect(vi.getTimerCount()).toBe(0);
    cleanup();

    loopRow({});
    expect(vi.getTimerCount()).toBe(1);
  });
});

it("leaves the traffic and toll choices inside the collapsed row", () => {
  // The row is `Ride style` … `Balanced · Mixed ›`: it names where the ride goes
  // by shape, not by repeating every switch, so it stays one line at 320 px.
  expect(rideStyleSummary({ ...VIEW, traffic: "minimize-delay" })).toBe("Balanced · Mixed");
  expect(rideStyleSummary({ ...VIEW, avoidTolls: true })).toBe("Balanced · Mixed");
});
