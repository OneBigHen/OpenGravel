/** Advisory local key that marks an authored draft awaiting durable storage. */
export const DRAFT_DIRTY_STORAGE_KEY = "opengravel-vnext-draft-dirty";

/*
 * Device-only choices that the app writes to localStorage. They live here, in
 * one registry, so "Delete all data" cannot forget a key a screen started
 * writing later (see `LOCAL_DATA_STORAGE_KEYS`).
 */

/** Day / Night / Auto display choice (`appearance.ts`). */
export const APPEARANCE_STORAGE_KEY = "og-appearance";

/** Ride-screen choice in the iPhone app (`nav-screen.ts`). */
export const NAV_SCREEN_STORAGE_KEY = "og-nav-screen";

/** The rider's mute-the-voice choice (`voice-mute.ts`). */
export const VOICE_MUTED_STORAGE_KEY = "ogv.ride.voiceMuted";

/** The rider's own Spotify app client id (`client-id.ts`). */
export const SPOTIFY_CLIENT_ID_STORAGE_KEY = "OGV_SPOTIFY_CLIENT_ID";
