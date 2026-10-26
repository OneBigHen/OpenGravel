import { describe, expect, it } from "vitest";

import { destinationLineFor } from "@/ui/planner/destination-line";

describe("destinationLineFor", () => {
  it("names a titled ride whose endpoint is a pin the rider did not drop", () => {
    expect(destinationLineFor({ placeLabel: "Dropped pin", loopRide: false, rideTitle: "Sample Ridge Loop" }))
      .toBe("Sample Ridge Loop");
  });

  it("does not invent a name for the rider's own dropped pin", () => {
    expect(destinationLineFor({ placeLabel: "Dropped pin", loopRide: false, rideTitle: null })).toBeNull();
    expect(destinationLineFor({ placeLabel: "Dropped pin", loopRide: false, rideTitle: "  " })).toBeNull();
  });

  it("keeps a real place name and shortens its address", () => {
    expect(destinationLineFor({ placeLabel: "Hawk Mountain Sanctuary, Kempton, PA", loopRide: false, rideTitle: "Sunday ride" }))
      .toBe("To Hawk Mountain Sanctuary");
  });

  it("names a loop by its start", () => {
    expect(destinationLineFor({ placeLabel: "Jim Thorpe, PA", loopRide: true, rideTitle: null }))
      .toBe("Loop from Jim Thorpe");
  });
});
