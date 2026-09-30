export const SPOTIFY_CLIENT_ID_STORAGE_KEY = "OGV_SPOTIFY_CLIENT_ID";
const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

export function validSpotifyClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value.trim());
}
