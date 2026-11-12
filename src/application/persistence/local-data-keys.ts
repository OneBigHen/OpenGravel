/** Advisory local key that marks an authored draft awaiting durable storage. */
export const DRAFT_DIRTY_STORAGE_KEY = "opengravel-vnext-draft-dirty";

/*
 * Device-only choices that the app writes to localStorage. They live here, in
 * one registry, so "Delete all data" cannot forget a key a screen started
 * writing later (see `LOCAL_DATA_STORAGE_KEYS`).
 */

/** Day / Night / Auto display choice (`appearance.ts`). */
export const APPEARANCE_STORAGE_KEY = "og-appearance";

/**
 * Where Auto last saw the rider, rounded to about 10 km, with the theme the sun
 * gave there and when that changes (`appearance.ts`). Lets the pre-paint script
 * open in the sun's theme without a position.
 */
export const APPEARANCE_SUN_STORAGE_KEY = "og-appearance-sun";

/** Ride-screen choice in the iPhone app (`nav-screen.ts`). */
export const NAV_SCREEN_STORAGE_KEY = "og-nav-screen";

/** "off" when the rider turned the Lock Screen Live Activity off (`live-activity-setting.ts`). */
export const LIVE_ACTIVITY_STORAGE_KEY = "og-live-activity";

/** The rider's mute-the-voice choice (`voice-mute.ts`). */
export const VOICE_MUTED_STORAGE_KEY = "ogv.ride.voiceMuted";

/** The rider's own Spotify app client id (`client-id.ts`). */
export const SPOTIFY_CLIENT_ID_STORAGE_KEY = "OGV_SPOTIFY_CLIENT_ID";

/** Catalog routes this device has hidden from its own Explore list (a local preference). */
export const HIDDEN_ROUTES_STORAGE_KEY = "opengravel.explore.hidden-routes";

/**
 * The two side features that stay off the first screen until the rider turns
 * them on in Settings: the AI "Ask" button and the traffic-camera layer
 * (`front-door-options.ts`). Only the "on" choice is stored.
 */
export const FRONT_DOOR_ASK_STORAGE_KEY = "og-front-door-ask";
export const FRONT_DOOR_CAMERAS_STORAGE_KEY = "og-front-door-cameras";

/** Spots the rider reported while riding: private to this device (`rider-reports.ts`). */
export const RIDER_REPORTS_STORAGE_KEY = "og-rider-reports";
