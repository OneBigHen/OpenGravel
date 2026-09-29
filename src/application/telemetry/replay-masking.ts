/**
 * Session replay masking policy (Task 11.4;
 * 11-OFFLINE-IDENTITY-SHARING-PRIVACY §15).
 *
 * If session replay is enabled at all, the following must be masked:
 * authentication inputs, free-form sensitive fields, imported filenames and
 * secret/token fields. The map cannot be meaningfully masked without losing
 * map behavior — so instead of pretending otherwise, the product carries an
 * honest disclosure next to the acknowledgement (13-OBSERVABILITY §14):
 * map pixels and the map viewport can reveal geographic context.
 */

import { TELEMETRY_ACKNOWLEDGEMENT } from "@/application/telemetry/consent";

/** The four masking categories required by 11 §15. */
export const REPLAY_MASKING_CATEGORIES = [
  "auth-inputs",
  "free-form-sensitive-fields",
  "imported-filenames",
  "secret-token-fields",
] as const;

export type TelemetryReplayMaskingCategory =
  (typeof REPLAY_MASKING_CATEGORIES)[number];

/** The masking policy the replay adapter must implement. */
export interface TelemetryReplayMaskingPolicy {
  /** Authentication inputs: mask every input value. */
  readonly maskAllInputValues: boolean;
  /** Free-form sensitive fields: mask free-form text. */
  readonly maskAllFreeFormText: boolean;
  /** Imported filenames: mask filename text. */
  readonly maskImportedFilenames: boolean;
  /** Secret/token fields: never capture their values in any form. */
  readonly maskSecretFields: boolean;
  readonly maskedCategories: readonly TelemetryReplayMaskingCategory[];
  /** The honest map-context disclosure shared with the acknowledgement. */
  readonly mapContextDisclosure: string;
}

export const SESSION_REPLAY_MASKING_POLICY: TelemetryReplayMaskingPolicy = {
  maskAllInputValues: true,
  maskAllFreeFormText: true,
  maskImportedFilenames: true,
  maskSecretFields: true,
  maskedCategories: REPLAY_MASKING_CATEGORIES,
  mapContextDisclosure: TELEMETRY_ACKNOWLEDGEMENT.mapContextDisclosure,
};
