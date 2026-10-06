import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SavedRideGroupShare } from "@/ui/rides/SavedRideGroupShare";
import type { RideExportSource, RideSummary } from "@/application/library/library-service";

const ride = { rideId: "ride_test", title: "My GPX" } as RideSummary;
const source: RideExportSource = { title: "My GPX", plannedRoute: null, tracks: [{ name: "Track", segments: [{ geometryRef: "geo_a" as never, timestamps: [], elevation: [] }, { geometryRef: "geo_b" as never, timestamps: [], elevation: [] }] }], trackGeometry: { geo_a: [{ lon: 0, lat: 0 }, { lon: 0.01, lat: 0.01 }], geo_b: [{ lon: 1, lat: 1 }, { lon: 1.01, lat: 1.01 }] }, waypoints: [], originalBytes: null, originalFilename: null, originalMime: null, recordedTrack: null };
afterEach(() => cleanup());
it("requires an explicit continuous-segment choice rather than bridging gaps", async () => {
  const load = vi.fn().mockResolvedValue(source);
  render(<SavedRideGroupShare ride={ride} loadSource={load} />);
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Share with everyone" }));
  expect(await screen.findByRole("combobox", { name: "Continuous segment to share" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Share it" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Continuous segment to share" }), { target: { value: "geo_a" } });
  expect(screen.getByRole("button", { name: "Share it" })).toBeEnabled();
});
it("offers privacy preview for a saved continuous track", async () => {
  const load = vi.fn().mockResolvedValue({ ...source, tracks: [{ ...source.tracks[0], segments: [source.tracks[0]!.segments[0]] }] });
  render(<SavedRideGroupShare ride={ride} loadSource={load} />);
  fireEvent.click(screen.getByRole("button", { name: "Share with everyone" }));
  expect(await screen.findByRole("checkbox", { name: "Hide the start (500 m)" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Share it" })).toBeEnabled();
});
