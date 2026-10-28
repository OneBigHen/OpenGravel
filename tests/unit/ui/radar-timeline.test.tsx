import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RadarFrame } from "@/application/map-layers";
import { RadarTimeline } from "@/ui/layers/RadarTimeline";
import type { RadarView } from "@/ui/layers/useMapLayers";

afterEach(cleanup);

const FRAMES: readonly RadarFrame[] = [
  { time: 1_759_516_800, path: "/v2/radar/a", kind: "past" },
  { time: 1_759_517_400, path: "/v2/radar/b", kind: "past" },
  { time: 1_759_518_000, path: "/v2/radar/nowcast_ab12", kind: "nowcast" },
];

function view(overrides: Partial<RadarView> = {}): RadarView {
  return {
    frames: FRAMES,
    index: 1,
    playing: false,
    label: "2:40 PM",
    unavailable: false,
    loading: false,
    scrub: vi.fn(),
    togglePlay: vi.fn(),
    ...overrides,
  };
}

describe("rain radar timeline", () => {
  it("plays, pauses and scrubs the frame list", () => {
    const scrub = vi.fn();
    const togglePlay = vi.fn();
    render(<RadarTimeline radar={view({ scrub, togglePlay })} />);

    const play = screen.getByRole("button", { name: "Play rain radar" });
    fireEvent.click(play);
    expect(togglePlay).toHaveBeenCalledTimes(1);

    const slider = screen.getByRole("slider", { name: "Radar frame" });
    expect(slider).toHaveValue("1");
    expect(slider).toHaveAttribute("aria-valuetext", "2:40 PM");
    fireEvent.change(slider, { target: { value: "2" } });
    expect(scrub).toHaveBeenCalledWith(2);
    expect(screen.getByText("RainViewer")).toBeInTheDocument();
  });

  it("shows the pause control and the nowcast label for a forecast frame", () => {
    render(<RadarTimeline radar={view({ index: 2, playing: true, label: "+20 min" })} />);
    expect(screen.getByRole("button", { name: "Pause rain radar" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("+20 min")).toBeInTheDocument();
    expect(screen.getByText("Forecast · RainViewer")).toBeInTheDocument();
  });

  it("says the radar is unavailable instead of drawing an empty timeline", () => {
    render(<RadarTimeline radar={view({ frames: [], unavailable: true, label: "" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Rain radar is unavailable right now.");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("announces loading while the frame list is on its way", () => {
    render(<RadarTimeline radar={view({ frames: [], loading: true, label: "" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading rain radar…");
  });
});
