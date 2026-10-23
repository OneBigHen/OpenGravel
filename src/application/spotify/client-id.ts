import { SPOTIFY_CLIENT_ID_STORAGE_KEY } from "@/application/persistence/local-data-keys";

/** Registry-owned so a device wipe removes the rider's app id too. */
export { SPOTIFY_CLIENT_ID_STORAGE_KEY };

const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

export function validSpotifyClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value.trim());
}
