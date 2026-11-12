import { describe, expect, it } from "vitest";

import { automaticRideName, destinationLineFor } from "@/ui/planner/destination-line";

describe("destinationLineFor", () => {
  it("names a titled ride whose endpoint is a pin the rider did not drop", () => {
    expect(destinationLineFor({ placeLabel: "Dropped pin", loopRide: false, rideTitle: "Sample Ridge Loop" }))
      .toBe("Sample Ridge Loop");
  });

  it("does not invent a name for the rider's own dropped pin", () => {
    expect(destinationLineFor({ placeLabel: "Dropped pin", loopRide: false, rideTitle: null })).toBeNull();
    expect(destinationLineFor({ placeLabel: "Dropped pin", loopRide: false, rideTitle: "  " })).toBeNull();
  });

  it("keeps a curated or imported ride's own name, never 'To <place>'", () => {
    expect(destinationLineFor({ placeLabel: "Hawk Mountain Sanctuary, Kempton, PA", loopRide: false, rideTitle: "Sunday ride" }))
      .toBe("Sunday ride");
    expect(destinationLineFor({ placeLabel: "Sand Mountain Trailhead", loopRide: true, rideTitle: "Sand Mountain Loop" }))
      .toBe("Sand Mountain Loop");
  });

  it("names an unnamed ride by where it goes", () => {
    expect(destinationLineFor({ placeLabel: "Hawk Mountain Sanctuary, Kempton, PA", loopRide: false, rideTitle: null }))
      .toBe("To Hawk Mountain Sanctuary");
    expect(destinationLineFor({ placeLabel: "Jim Thorpe, PA", loopRide: true, rideTitle: null }))
      .toBe("Loop from Jim Thorpe");
  });
});

describe("automaticRideName", () => {
  it("names a loop by its place, shape and miles", () => {
    expect(automaticRideName({ rideTitle: null, placeLabel: "Rothrock, PA", loopRide: true, distanceMeters: 85_000 }))
      .toBe("Rothrock loop, 53 mi");
  });

  it("keeps a ride's own name and adds its length", () => {
    expect(automaticRideName({ rideTitle: "Sand Mountain Loop", placeLabel: "Sand Mountain Trailhead", loopRide: true, distanceMeters: 8_000 }))
      .toBe("Sand Mountain Loop, 5 mi");
  });

  it("does not add a second 'loop' or an invented distance", () => {
    expect(automaticRideName({ rideTitle: null, placeLabel: "Rothrock Loop", loopRide: true, distanceMeters: null }))
      .toBe("Rothrock Loop");
  });

  it("never names a save after a pin the rider did not drop", () => {
    expect(automaticRideName({ rideTitle: null, placeLabel: "Dropped pin", loopRide: false, distanceMeters: 1_600 }))
      .toBe("My ride, 1 mi");
    expect(automaticRideName({ rideTitle: null, placeLabel: "Your location", loopRide: true, distanceMeters: 30_000 }))
      .toBe("My loop, 19 mi");
  });

  it("names a destination ride by where it goes", () => {
    expect(automaticRideName({ rideTitle: null, placeLabel: "Hawk Mountain Sanctuary, Kempton, PA", loopRide: false, distanceMeters: 64_000 }))
      .toBe("To Hawk Mountain Sanctuary, 40 mi");
  });

  it("does not add the length twice to a ride saved before", () => {
    expect(automaticRideName({ rideTitle: "Rothrock loop, 53 mi", placeLabel: "Rothrock", loopRide: true, distanceMeters: 85_000 }))
      .toBe("Rothrock loop, 53 mi");
  });
});
