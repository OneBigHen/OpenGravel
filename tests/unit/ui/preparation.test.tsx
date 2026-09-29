import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RoutePreparationSection } from "@/ui/preparation/RoutePreparationSection";
import type { RoutePreparation } from "@/application/preparation/prepare-route";
import type { Consideration } from "@/application/long-trip";

const preparation: RoutePreparation = {
  registeredProviderCount: 2,
  capabilities: [],
  items: [
    { kind: "weather", state: "ready", relevance: "conditional", reason: "Forecast received.", provenance: "Source: weather service · updated 14:32", data: { display: "Dry · 18°C" } },
    { kind: "traffic", state: "stale", relevance: "conditional", reason: "Traffic is older than its freshness window.", provenance: "Traffic cache", data: { display: "Slowdown reported" } },
    { kind: "daylight", state: "ready", relevance: "conditional", reason: "Ride fits within remaining daylight.", provenance: "Sunset calculation", data: { display: "2h 40m remaining" } },
    { kind: "fuel", state: "ready", relevance: "conditional", reason: "Range covers this route.", provenance: "Bike profile", data: { display: "240 km range" } },
    { kind: "offline-route", state: "unavailable", relevance: "always", reason: "Offline route capability is not available yet.", provenance: "Nothing consulted" },
  ],
};

describe("RoutePreparationSection", () => {
  afterEach(() => cleanup());

  const longTripConsiderations: readonly Consideration[] = [
    {
      kind: "fuel",
      severity: "critical",
      whyLine: "Route is 300 km versus about 160 km usable range. Plan a fuel stop before the range gap.",
      sourceRefs: ["ride:distance", "assumption:conservative-fuel-range"],
    },
    {
      kind: "weather",
      severity: "watch",
      whyLine: "70% precipitation chance crosses the trip-weather threshold; check conditions before riding.",
      sourceRefs: ["weather:nws:fixture"],
    },
  ];

  it("shows at most three useful checks by default and expands the rest", () => {
    render(<RoutePreparationSection preparation={preparation} />);

    expect(screen.getByRole("heading", { name: "Before you ride" })).toBeInTheDocument();
    expect(screen.getByTestId("preparation-section").querySelectorAll('dl[aria-label="Route preparation checks"] dt')).toHaveLength(3);
    expect(screen.getByText("Weather", { selector: "dt" })).toBeInTheDocument();
    expect(screen.queryByText("Fuel", { selector: "dt" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all checks" }));
    expect(screen.getByTestId("preparation-section").querySelectorAll('dl[aria-label="Route preparation checks"] dt')).toHaveLength(4);
    expect(screen.getByText("Fuel", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer checks" })).toBeInTheDocument();
  });

  it("keeps unavailable reasons collapsed and never labels them ready", () => {
    render(<RoutePreparationSection preparation={preparation} />);

    const unavailable = screen.getByText("Not available yet").closest("details");
    expect(unavailable).not.toHaveAttribute("open");
    expect(screen.getByText("Offline route capability is not available yet.")).toBeInTheDocument();
    expect(screen.getByTestId("preparation-state-offline-route")).toHaveTextContent("Unknown");
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
    expect(screen.queryByText("Offline ready")).not.toBeInTheDocument();
  });

  it("uses definition-list semantics and explains a zero-provider state without fake rows", () => {
    const zeroProviders: RoutePreparation = { registeredProviderCount: 0, capabilities: [], items: [] };
    render(<RoutePreparationSection preparation={zeroProviders} />);

    expect(screen.getByRole("region", { name: "Before you ride" })).toBeInTheDocument();
    expect(screen.getByText(/checks will appear here when optional capabilities are available/i)).toBeInTheDocument();
    expect(screen.queryByRole("term")).not.toBeInTheDocument();
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
    expect(screen.queryByText("Offline ready")).not.toBeInTheDocument();
  });

  it("renders an alert-primary weather row with freshness and source details", () => {
    render(<RoutePreparationSection preparation={{
      registeredProviderCount: 1,
      capabilities: [],
      items: [{
        kind: "weather",
        state: "stale",
        relevance: "conditional",
        reason: "A weather alert covers your trip window; check before you ride.",
        provenance: "Source: weather service · updated 14:32",
        data: {
          display: "Severe Thunderstorm Watch — through 8:00 PM (updated 12 min ago)",
          freshnessLabel: "Stale",
          primaryAlert: { severity: "Severe" },
        },
      }],
    }} />);

    expect(screen.getByText("Severe Thunderstorm Watch — through 8:00 PM (updated 12 min ago)")).toBeInTheDocument();
    expect(screen.getByTestId("weather-severity")).toHaveTextContent("Severe");
    expect(screen.getByTestId("weather-freshness")).toHaveTextContent("Stale");
    expect(screen.getByText("Source: weather service · updated 14:32")).toBeInTheDocument();
  });

  it("renders absent traffic as visible unknown rather than clear", () => {
    render(<RoutePreparationSection preparation={{
      registeredProviderCount: 1,
      capabilities: [],
      items: [{
        kind: "traffic",
        state: "unavailable",
        relevance: "conditional",
        reason: "Traffic data is not available yet.",
        provenance: "Nothing consulted",
      }],
    }} />);

    expect(screen.getByText("Traffic unknown")).toBeVisible();
    expect(screen.getByTestId("preparation-state-traffic")).toHaveTextContent("Unknown");
    expect(screen.queryByText("Clear", { exact: true })).not.toBeInTheDocument();
  });

  it("renders evidence-linked long-trip considerations when the ride is relevant", () => {
    render(<RoutePreparationSection preparation={{ ...preparation, considerations: longTripConsiderations }} />);

    expect(screen.getByRole("group", { name: "Long-trip considerations" })).toBeInTheDocument();
    expect(screen.getByTestId("long-trip-consideration-fuel")).toHaveAttribute("data-severity", "critical");
    expect(screen.getByTestId("long-trip-consideration-fuel")).toHaveTextContent("Plan a fuel stop before the range gap.");
    expect(screen.getByTestId("long-trip-consideration-weather")).toHaveTextContent("70% precipitation chance");
    expect(screen.getByText("Sources: ride:distance, assumption:conservative-fuel-range")).toBeInTheDocument();
  });

  it("renders no long-trip disclosure for a short ride", () => {
    render(<RoutePreparationSection preparation={{ ...preparation, considerations: [] }} />);

    expect(screen.queryByRole("group", { name: "Long-trip considerations" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("long-trip-consideration-fuel")).not.toBeInTheDocument();
  });
});
