/**
 * Geocoding adapters as one seam. The composition root imports this barrel, so
 * a provider's name stays inside the adapter layer, next to the code that knows
 * the provider's protocol.
 */
export {
  createPhotonGeocoder,
  PHOTON_DEFAULT_URL,
  PHOTON_TIMEOUT_MS,
  GeocoderUnavailableError,
  type PhotonGeocoder,
  type PhotonOptions,
} from "./photon";
export {
  createTomTomPlaceSearch,
  TOMTOM_PLACE_LIMIT,
  TOMTOM_PLACE_RADIUS_METERS,
  TOMTOM_PLACE_TIMEOUT_MS,
  TOMTOM_SEARCH_BASE_URL,
  type TomTomPlaceOptions,
  type TomTomPlaceRequest,
  type TomTomPlaceSearch,
} from "./tomtom";
