import {
  SYNC_ENVELOPE_ALGORITHM,
  type EncryptedSyncEnvelope,
  type SyncIdentity,
} from "@/application/sync/types";

const VAULT_ID_BYTES = 16;
const ACCESS_TOKEN_BYTES = 32;
const VAULT_KEY_BYTES = 32;
const IV_BYTES = 12;
const PAIR_PREFIX = "ogv-sync=v1.";
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function cryptoApi(): Crypto {
  if (globalThis.crypto?.subtle === undefined) throw new Error("Web Crypto is unavailable on this device.");
  return globalThis.crypto;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!BASE64URL.test(value)) throw new Error("The sync secret is malformed.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("The sync secret is malformed.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomSecret(length: number): string {
  const bytes = new Uint8Array(length);
  cryptoApi().getRandomValues(bytes);
  return base64Url(bytes);
}

export function createSyncIdentity(): SyncIdentity {
  return {
    version: 1,
    vaultId: randomSecret(VAULT_ID_BYTES),
    accessToken: randomSecret(ACCESS_TOKEN_BYTES),
    vaultKey: randomSecret(VAULT_KEY_BYTES),
    lastSeenRevision: 0,
  };
}

export function syncIdentityIsValid(value: unknown): value is SyncIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SyncIdentity>;
  if (
    candidate.version !== 1 ||
    typeof candidate.vaultId !== "string" ||
    typeof candidate.accessToken !== "string" ||
    typeof candidate.vaultKey !== "string" ||
    typeof candidate.lastSeenRevision !== "number" ||
    !Number.isSafeInteger(candidate.lastSeenRevision) ||
    candidate.lastSeenRevision < 0
  ) return false;
  try {
    return fromBase64Url(candidate.vaultId).byteLength === VAULT_ID_BYTES &&
      fromBase64Url(candidate.accessToken).byteLength === ACCESS_TOKEN_BYTES &&
      fromBase64Url(candidate.vaultKey).byteLength === VAULT_KEY_BYTES;
  } catch {
    return false;
  }
}

function additionalData(vaultId: string): Uint8Array {
  return new TextEncoder().encode(`OpenGravel device sync v1\n${vaultId}`);
}

async function importVaultKey(identity: Pick<SyncIdentity, "vaultKey">): Promise<CryptoKey> {
  const bytes = fromBase64Url(identity.vaultKey);
  if (bytes.byteLength !== VAULT_KEY_BYTES) throw new Error("The sync key is malformed.");
  return cryptoApi().subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSyncPayload(
  value: unknown,
  identity: Pick<SyncIdentity, "vaultId" | "vaultKey">,
  capturedAt = new Date().toISOString(),
): Promise<EncryptedSyncEnvelope> {
  const key = await importVaultKey(identity);
  const iv = new Uint8Array(IV_BYTES);
  cryptoApi().getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await cryptoApi().subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(identity.vaultId), tagLength: 128 },
    key,
    plaintext,
  );
  return {
    version: 1,
    algorithm: SYNC_ENVELOPE_ALGORITHM,
    iv: base64Url(iv),
    ciphertext: base64Url(new Uint8Array(encrypted)),
    capturedAt,
  };
}

export async function decryptSyncPayload<T = unknown>(
  envelope: EncryptedSyncEnvelope,
  identity: Pick<SyncIdentity, "vaultId" | "vaultKey">,
): Promise<T> {
  if (envelope.version !== 1 || envelope.algorithm !== SYNC_ENVELOPE_ALGORITHM) {
    throw new Error("This synced data uses an unsupported encryption format.");
  }
  const iv = fromBase64Url(envelope.iv);
  if (iv.byteLength !== IV_BYTES) throw new Error("The synced data has an invalid nonce.");
  const ciphertext = fromBase64Url(envelope.ciphertext);
  const key = await importVaultKey(identity);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await cryptoApi().subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(identity.vaultId), tagLength: 128 },
      key,
      ciphertext,
    );
  } catch {
    throw new Error("The synced data could not be authenticated or decrypted.");
  }
  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    throw new Error("The decrypted sync payload is not valid JSON.");
  }
}

/**
 * Pairing material lives after `#`: browsers do not send URL fragments in HTTP
 * requests. The pairing page must clear it from browser history immediately.
 */
export function pairingFragment(identity: SyncIdentity): string {
  return `#${PAIR_PREFIX}${identity.vaultId}.${identity.accessToken}.${identity.vaultKey}`;
}

export function parsePairingFragment(fragment: string): SyncIdentity | null {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!raw.startsWith(PAIR_PREFIX)) return null;
  const parts = raw.slice(PAIR_PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  const [vaultId, accessToken, vaultKey] = parts;
  const candidate: SyncIdentity = {
    version: 1,
    vaultId: vaultId ?? "",
    accessToken: accessToken ?? "",
    vaultKey: vaultKey ?? "",
    lastSeenRevision: 0,
  };
  return syncIdentityIsValid(candidate) ? candidate : null;
}
