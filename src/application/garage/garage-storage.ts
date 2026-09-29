import type { Garage } from "./garage-model";

export interface GarageStoragePort {
  read(): Garage;
  write(garage: Garage): void;
  clear(): void;
}
