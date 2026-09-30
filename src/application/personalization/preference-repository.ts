import type { RiderPreferenceModel } from "@/domain/personalization/rider-preference";

export interface RiderPreferenceRepositoryPort {
  load(): Promise<RiderPreferenceModel | null>;
  save(model: RiderPreferenceModel): Promise<void>;
  clear(): Promise<void>;
}
