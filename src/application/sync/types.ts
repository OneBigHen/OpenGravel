/**
 * Device-sync wire contracts.
 *
 * The server is deliberately blind to the plaintext snapshot. It stores only an
 * opaque authenticated-encryption envelope plus an optimistic revision number.
 */

export const SYNC_PROTOCOL_VERSION = 1 as const;
export const SYNC_ENVELOPE_ALGORITHM = "AES-GCM-256" as const;

export interface SyncIdentity {
  readonly version: 1;
  readonly vaultId: string;
  /** Anonymous bearer capability. The server persists only SHA-256(token). */
  readonly accessToken: string;
  /** Raw 256-bit AES key, base64url encoded. Never sent to the server. */
  readonly vaultKey: string;
  /** Highest server revision this device has accepted. */
  readonly lastSeenRevision: number;
}

export interface EncryptedSyncEnvelope {
  readonly version: 1;
  readonly algorithm: typeof SYNC_ENVELOPE_ALGORITHM;
  readonly iv: string;
  readonly ciphertext: string;
  readonly capturedAt: string;
}

export interface RemoteSyncVault {
  readonly vaultId: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly envelope: EncryptedSyncEnvelope;
}

export interface SyncSnapshotV1 {
  readonly version: 1;
  readonly capturedAt: string;
  readonly localSchemaVersion: number;
  readonly data: {
    readonly rides: readonly unknown[];
    readonly geometry: readonly unknown[];
    readonly importBlobs: readonly unknown[];
    readonly recordings: readonly unknown[];
    readonly recordingBatches: readonly unknown[];
  };
  readonly preferences: {
    readonly garage: unknown;
    readonly home: unknown | null;
    readonly riderSettings: unknown;
    readonly defaultMapStyle: "map" | "satellite";
  };
}
