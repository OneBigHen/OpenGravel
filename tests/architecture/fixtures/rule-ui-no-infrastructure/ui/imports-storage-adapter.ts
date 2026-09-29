import { createRideRepository } from "@/infrastructure/storage/ride-repository";

// Fixture: UI must not reach storage infrastructure directly either — the same
// boundary, a different adapter.
export const repository = createRideRepository;
