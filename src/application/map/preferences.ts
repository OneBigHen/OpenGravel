/** Per-device preference for the existing Map / Satellite layer toggle. */
export const SATELLITE_PREFERENCE_KEY = "opengravel-vnext-satellite";

/**
 * Per-device basemap look: `map` (the configured basemap), `night` (Night
 * contrast) or `satellite`. Supersedes the satellite key, which is still read
 * once so a rider who chose satellite keeps it.
 */
export const BASEMAP_LOOK_PREFERENCE_KEY = "opengravel-basemap-look";

/** Which information layers the rider turned on, and the camera-marker choice. */
export const MAP_LAYERS_STORAGE_KEY = "ogv.map-layers.v1";
export const CAMERA_ROUTE_ONLY_STORAGE_KEY = "ogv.camera-route-only.v1";
