import { describe, expect, it } from "vitest";
import { DEFAULT_BIKE } from "@/domain/ride/create";
import {
  addBike,
  createGarage,
  deleteBike,
  snapshotOf,
  updateBike,
  validateBikeProfile,
  type BikeProfile,
} from "@/application/garage/garage-model";

const bike: BikeProfile = {
  id: "bike_tenere",
  name: "Tenere 700",
  category: "adventure",
  fuelRangeMiles: 230,
  reserveMiles: 30,
  maintainedGravel: "allow",
  roughTracks: "avoid",
  unknownSurface: "allow-with-warning",
};

describe("garage model", () => {
  it("seeds one usable bike from the domain default", () => {
    const garage = createGarage();
    expect(garage.bikes).toHaveLength(1);
    expect(garage.activeBikeId).toBe(garage.bikes[0]?.id);
    expect(snapshotOf(garage.bikes[0]!)).toEqual({ ...DEFAULT_BIKE, bikeId: garage.bikes[0]!.id });
  });

  it("validates names and fuel range against reserve", () => {
    expect(validateBikeProfile({ ...bike, name: "  " })).toContain("Enter a bike name.");
    expect(validateBikeProfile({ ...bike, name: "x".repeat(41) }).some((error) => error.includes("40 characters"))).toBe(true);
    expect(validateBikeProfile({ ...bike, fuelRangeMiles: 19 }).some((error) => error.includes("20 and 600 miles"))).toBe(true);
    expect(validateBikeProfile({ ...bike, reserveMiles: 231 }).some((error) => error.includes("less than the fuel range"))).toBe(true);
  });

  it("adds, updates, and deletes bikes while maintaining an active bike", () => {
    const first = createGarage();
    const added = addBike(first, bike);
    expect(added.activeBikeId).toBe(first.activeBikeId);
    const selected = { ...added, activeBikeId: bike.id };
    const updated = updateBike(selected, { ...bike, name: "Tenere" });
    expect(updated.bikes.find((entry) => entry.id === bike.id)?.name).toBe("Tenere");
    const deleted = deleteBike(updated, bike.id);
    expect(deleted.ok).toBe(true);
    if (deleted.ok) expect(deleted.garage.activeBikeId).toBe(first.activeBikeId);
    expect(deleteBike(first, first.activeBikeId)).toEqual({ ok: false, reason: "last-bike" });
  });
});
