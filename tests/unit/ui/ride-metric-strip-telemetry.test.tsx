/**
 * The shared strip and picker with slice B telemetry (RIDE-INSTRUMENT-STRIP
 * §6, §4.1, §17.8): the new metrics render in the same three slots, the
 * picker offers them only where the ride can back them, and a stale or
 * expired value says so in its state, its freshness and its spoken name.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRiderSettings, withMetricSlots } from "@/application/ride-metrics/rider-settings";
import { buildRideMetricStrip } from "@/application/ride-metrics/strip";
import { EMPTY_RECORDING_TELEMETRY, type RecordingTelemetry } from "@/domain/recording/telemetry";
import { asRecordingId } from "@/domain/recording/ids";
import type { NavigationPosition, SessionNavigationState } from "@/domain/ride-session/navigation";
import { newRideSessionId } from "@/domain/ride-session/ids";
import { newRideId } from "@/domain/ride/ids";
import { RideMetricPicker } from "@/ui/ride/RideMetricPicker";
import { RideMetricStrip } from "@/ui/ride/RideMetricStrip";

const NOW_MS = Date.parse("2026-09-21T14:00:00.000Z");
const MPH = 1609.344 / 3600;

const FRESH: NavigationPosition = {
  coordinate: { lon: -75.4385, lat: 40.1385 },
  observedAt: new Date(NOW_MS - 1_000).toISOString(),
  ageMs: 1_000,
  accuracyMeters: 5,
  headingDegrees: 0,
  speedMps: 0.4,
  quality: "fresh-good",
};

const TELEMETRY: RecordingTelemetry = {
  ...EMPTY_RECORDING_TELEMETRY,
  acceptedDistanceMeters: 16_093.44,
  movingMs: 1_800_000,
  maxSpeedMps: 58 * MPH,
  movement: "moving",
  movingSinceMs: NOW_MS - 600_000,
  lastSampleAtMs: NOW_MS - 1_000,
};

function navigation(overrides: Partial<SessionNavigationState> = {}): SessionNavigationState {
  return {
    sessionId: newRideSessionId(),
    activity: "free",
    resumeActivity: null,
    startedAt: "2026-09-21T13:00:00.000Z",
    endedAt: null,
    endReason: null,
    plan: { rideId: newRideId(), rideRevision: 1, route: null },
    recordingId: asRecordingId("rec_strip"),
    position: FRESH,
    aheadGuidanceSuspended: false,
    instruction: null,
    offRouteState: null,
    nextStopId: null,
    completedStopIds: [],
    remainingStopIds: [],
    ...overrides,
  };
}

function model(nav: SessionNavigationState, slots = createRiderSettings().uiPreferences.recordingMetrics) {
  return buildRideMetricStrip({
    navigation: nav,
    telemetry: null,
    recordingSummary: { distanceMeters: 17_000, elapsedSeconds: 2_400, movingSeconds: 2_300, pointCount: 2_400 },
    recordingTelemetry: TELEMETRY,
    settings: withMetricSlots(createRiderSettings(), "recordingMetrics", slots),
    nowMs: NOW_MS,
  });
}

afterEach(cleanup);

describe("the strip with filtered telemetry", () => {
  it("shows Record's new default, Speed · Distance · Moving time, in the three slots", () => {
    render(<RideMetricStrip model={model(navigation())} onShowControls={vi.fn()} onChooseSlot={vi.fn()} />);
    expect(screen.getByTestId("ride-metric-strip")).toHaveAttribute("data-preset", "record");
    expect(screen.getByTestId("ride-metric-slot-2")).toHaveAttribute("data-metric", "time.moving");
    expect(screen.getByTestId("ride-metric-value-2")).toHaveTextContent("30:00");
    expect(screen.getByTestId("ride-metric-slot-2")).toHaveAccessibleName("Moving time, 30 minutes moving. Change metric.");
  });

  it("renders average, max and since-stop readouts", () => {
    render(
      <RideMetricStrip
        model={model(navigation(), ["speed.average", "speed.max", "time.sinceStop"])}
        onShowControls={vi.fn()}
        onChooseSlot={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ride-metric-value-0")).toHaveTextContent("20");
    expect(screen.getByTestId("ride-metric-value-1")).toHaveTextContent("58");
    expect(screen.getByTestId("ride-metric-value-2")).toHaveTextContent("10:00");
  });

  it("marks held and expired GPS values in state, freshness and the spoken name", () => {
    const aged = (ageMs: number) =>
      navigation({ position: { ...FRESH, ageMs, speedMps: 13 } });
    render(<RideMetricStrip model={model(aged(9_000))} onShowControls={vi.fn()} onChooseSlot={vi.fn()} />);
    const held = screen.getByTestId("ride-metric-slot-0");
    expect(held).toHaveAttribute("data-state", "stale");
    expect(held).toHaveAttribute("data-freshness", "held");
    expect(screen.getByTestId("ride-metric-value-0")).toHaveTextContent("29");
    expect(held.getAttribute("aria-label")).toContain("last reading 9 seconds ago");
    cleanup();

    render(<RideMetricStrip model={model(aged(17_000))} onShowControls={vi.fn()} onChooseSlot={vi.fn()} />);
    const gone = screen.getByTestId("ride-metric-slot-0");
    expect(gone).toHaveAttribute("data-freshness", "expired");
    expect(screen.getByTestId("ride-metric-value-0")).toHaveTextContent("—");
    expect(gone.getAttribute("aria-label")).toContain("no GPS reading for 17 seconds");
    // Recording aggregates stay valid while the session is (§4.1).
    expect(screen.getByTestId("ride-metric-slot-2")).toHaveAttribute("data-state", "ready");
  });
});

describe("the picker with filtered telemetry", () => {
  it("offers the recording metrics on Record", () => {
    render(<RideMetricPicker model={model(navigation())} slotIndex={1} onChoose={vi.fn()} onPreset={vi.fn()} onClose={vi.fn()} />);
    for (const id of ["time.moving", "time.sinceStop", "speed.average", "speed.max", "elevation.gain", "elevation.loss", "elevation.current"]) {
      expect(screen.getByTestId(`ride-metric-option-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("ride-metric-preset-record")).toBeInTheDocument();
  });

  it("offers none of them in Free Ride, which records nothing, but offers elevation", () => {
    render(
      <RideMetricPicker
        model={model(navigation({ recordingId: null }))}
        slotIndex={0}
        onChoose={vi.fn()}
        onPreset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("ride-metric-option-time.moving")).toBeNull();
    expect(screen.queryByTestId("ride-metric-option-speed.max")).toBeNull();
    expect(screen.getByTestId("ride-metric-option-elevation.current")).toBeInTheDocument();
  });
});
