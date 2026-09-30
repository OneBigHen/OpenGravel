import type { RiderPreferenceRepositoryPort } from "@/application/personalization/preference-repository";
import {
  isRiderPreferenceModel,
  type RiderPreferenceModel,
} from "@/domain/personalization/rider-preference";
import { VNextDatabase, vnextDatabase } from "./db";

/**
 * Preference state is a tiny local profile, not raw ride history. Keep it in
 * the existing settings table so this feature needs no database migration and
 * can later be synced as one versioned blob by the device-sync layer.
 */
export const RIDER_PREFERENCE_SETTING_KEY = "rider-preference-model:v1";

export function createRiderPreferenceRepository(
  database: VNextDatabase = vnextDatabase(),
): RiderPreferenceRepositoryPort {
  return {
    async load(): Promise<RiderPreferenceModel | null> {
      try {
        const row = await database.settings.get(RIDER_PREFERENCE_SETTING_KEY);
        return isRiderPreferenceModel(row?.value) ? row.value : null;
      } catch {
        return null;
      }
    },

    async save(model) {
      if (!isRiderPreferenceModel(model)) {
        throw new TypeError("Invalid rider preference model");
      }
      await database.settings.put({
        key: RIDER_PREFERENCE_SETTING_KEY,
        value: model,
      });
    },

    async clear() {
      await database.settings.delete(RIDER_PREFERENCE_SETTING_KEY);
    },
  };
}
