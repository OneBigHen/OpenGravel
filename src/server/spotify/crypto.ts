import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function decodeKey(value: string): Buffer | null {
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

export function keyFromConfig(value: string | null): Buffer | null {
  return value === null ? null : decodeKey(value);
}

export function sealJson(value: unknown, keyText: string | null): string | null {
  const key = keyFromConfig(keyText);
  if (key === null) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const sealed = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
  return sealed.length > 3800 ? null : sealed;
}

export function openJson<T>(value: string | null | undefined, keyText: string | null): T | null {
  if (value === undefined || value === null) return null;
  const key = keyFromConfig(keyText);
  if (key === null) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0]!, "base64url");
    const tag = Buffer.from(parts[1]!, "base64url");
    const ciphertext = Buffer.from(parts[2]!, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function opaqueHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
