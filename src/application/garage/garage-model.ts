import { DEFAULT_BIKE } from "@/domain/ride/create";
import type { BikeConstraintSnapshot } from "@/domain/ride/types";

export interface BikeProfile extends Omit<BikeConstraintSnapshot, "bikeId"> {
  readonly id: string;
  readonly name: string;
}

export interface Garage {
  readonly bikes: readonly BikeProfile[];
  readonly activeBikeId: string;
}

export type BikeDraft = Omit<BikeProfile, "id"> & { readonly id?: string };

export function createGarage(): Garage {
  const bike: BikeProfile = { ...DEFAULT_BIKE, id: "bike_default", name: "My bike" };
  return { bikes: [bike], activeBikeId: bike.id };
}

export function validateBikeProfile(bike: BikeDraft): readonly string[] {
  const errors: string[] = [];
  const name = bike.name.trim();
  if (name.length === 0) errors.push("Enter a bike name.");
  if (name.length > 40) errors.push("Bike names must be 40 characters or fewer.");
  if (!Number.isFinite(bike.fuelRangeMiles) || bike.fuelRangeMiles < 20 || bike.fuelRangeMiles > 600) {
    errors.push("Fuel range must be between 20 and 600 miles.");
  }
  if (!Number.isFinite(bike.reserveMiles) || bike.reserveMiles < 0 || bike.reserveMiles > 100) {
    errors.push("Reserve must be between 0 and 100 miles.");
  }
  if (bike.reserveMiles >= bike.fuelRangeMiles) errors.push("Reserve must be less than the fuel range.");
  return errors;
}

export function snapshotOf(profile: BikeProfile): BikeConstraintSnapshot {
  return {
    bikeId: profile.id,
    category: profile.category,
    fuelRangeMiles: profile.fuelRangeMiles,
    reserveMiles: profile.reserveMiles,
    maintainedGravel: profile.maintainedGravel,
    roughTracks: profile.roughTracks,
    unknownSurface: profile.unknownSurface,
    ...(profile.custom === undefined ? {} : { custom: profile.custom }),
  };
}

export function addBike(garage: Garage, bike: BikeProfile): Garage {
  if (validateBikeProfile(bike).length > 0 || garage.bikes.some((entry) => entry.id === bike.id)) return garage;
  return { ...garage, bikes: [...garage.bikes, { ...bike, name: bike.name.trim() }] };
}

export function updateBike(garage: Garage, bike: BikeProfile): Garage {
  if (validateBikeProfile(bike).length > 0 || !garage.bikes.some((entry) => entry.id === bike.id)) return garage;
  return {
    ...garage,
    bikes: garage.bikes.map((entry) => entry.id === bike.id ? { ...bike, name: bike.name.trim() } : entry),
  };
}

export function deleteBike(garage: Garage, bikeId: string):
  | { readonly ok: true; readonly garage: Garage }
  | { readonly ok: false; readonly reason: "last-bike" | "missing-bike" } {
  if (!garage.bikes.some((bike) => bike.id === bikeId)) return { ok: false, reason: "missing-bike" };
  if (garage.bikes.length === 1) return { ok: false, reason: "last-bike" };
  const bikes = garage.bikes.filter((bike) => bike.id !== bikeId);
  return {
    ok: true,
    garage: {
      bikes,
      activeBikeId: garage.activeBikeId === bikeId ? bikes[0]!.id : garage.activeBikeId,
    },
  };
}

export function activeBike(garage: Garage): BikeProfile {
  return garage.bikes.find((bike) => bike.id === garage.activeBikeId) ?? garage.bikes[0] ?? createGarage().bikes[0]!;
}

export function garageIsValid(value: unknown): value is Garage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { bikes?: unknown; activeBikeId?: unknown };
  if (!Array.isArray(candidate.bikes) || candidate.bikes.length === 0 || typeof candidate.activeBikeId !== "string") return false;
  const ids = new Set<string>();
  for (const raw of candidate.bikes) {
    if (typeof raw !== "object" || raw === null) return false;
    const bike = raw as BikeProfile;
    if (typeof bike.id !== "string" || bike.id.length === 0 || ids.has(bike.id) || typeof bike.name !== "string") return false;
    if (!["street", "touring", "adventure", "dual-sport"].includes(bike.category)) return false;
    if (!["allow", "avoid"].includes(bike.maintainedGravel) || !["allow", "avoid"].includes(bike.roughTracks)) return false;
    if (!["allow-with-warning", "avoid-when-possible"].includes(bike.unknownSurface)) return false;
    if (validateBikeProfile(bike).length > 0) return false;
    ids.add(bike.id);
  }
  return ids.has(candidate.activeBikeId);
}
