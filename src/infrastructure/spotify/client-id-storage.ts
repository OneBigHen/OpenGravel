import { SPOTIFY_CLIENT_ID_STORAGE_KEY, validSpotifyClientId } from "@/application/spotify/client-id";

export function readSpotifyClientId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(SPOTIFY_CLIENT_ID_STORAGE_KEY);
    return value !== null && validSpotifyClientId(value) ? value.trim() : null;
  } catch {
    return null;
  }
}

export function saveSpotifyClientId(value: string): boolean {
  if (!validSpotifyClientId(value)) return false;
  try {
    window.localStorage.setItem(SPOTIFY_CLIENT_ID_STORAGE_KEY, value.trim());
    return true;
  } catch {
    return false;
  }
}

export function clearSpotifyClientId(): void {
  try { window.localStorage.removeItem(SPOTIFY_CLIENT_ID_STORAGE_KEY); } catch { /* private browsing */ }
}

