const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

export const SPOTIFY_SESSION_COOKIE = "ogv_spotify_session";
export const SPOTIFY_OAUTH_COOKIE = "ogv_spotify_oauth";
export const SPOTIFY_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-modify-playback-state",
] as const;

export function isSpotifyClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value);
}

export function spotifyClientId(value: string | null | undefined): string | null {
  if (value !== undefined && value !== null) return isSpotifyClientId(value) ? value : null;
  const configured = process.env.SPOTIFY_CLIENT_ID;
  return configured !== undefined && isSpotifyClientId(configured) ? configured : null;
}

export function spotifySessionKey(): string | null {
  const key = process.env.OGV_SPOTIFY_SESSION_KEY?.trim();
  return key === undefined || key.length === 0 ? null : key;
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function allowedSpotifyOrigins(): readonly string[] {
  const configured = process.env.OGV_PUBLIC_ORIGIN === undefined
    ? null
    : normalizeOrigin(process.env.OGV_PUBLIC_ORIGIN);
  const additional = (process.env.OGV_SPOTIFY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => normalizeOrigin(value.trim()))
    .filter((origin): origin is string => origin !== null);
  return [...new Set([configured, ...additional].filter((origin): origin is string => origin !== null))];
}

export function spotifyOriginForRequest(request: Request): string | null {
  let origin: string;
  try {
    origin = new URL(request.url).origin;
  } catch {
    return null;
  }
  return allowedSpotifyOrigins().includes(origin) ? origin : null;
}

export function isSameOriginMutation(request: Request): boolean {
  const origin = spotifyOriginForRequest(request);
  if (origin === null) return false;
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin !== null && suppliedOrigin !== origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin" || fetchSite === "same-site";
}

export function spotifyRedirectUri(origin: string): string {
  return `${origin}/api/spotify/callback`;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (value === undefined || value === null || value.length === 0) return "/ride";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f\s]/.test(value)) return "/ride";
  try {
    const parsed = new URL(value, "https://example.invalid");
    if (parsed.origin !== "https://example.invalid") return "/ride";
    if (parsed.pathname !== "/ride" && parsed.pathname !== "/settings") return "/ride";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/ride";
  }
}

export function spotifyCookieSecure(origin: string): boolean {
  return origin.startsWith("https://");
}

export function spotifySessionCookieName(secure: boolean): string {
  return secure ? "__Host-ogv_spotify_session" : SPOTIFY_SESSION_COOKIE;
}

export function spotifyOAuthCookieName(secure: boolean): string {
  return secure ? "__Host-ogv_spotify_oauth" : SPOTIFY_OAUTH_COOKIE;
}
