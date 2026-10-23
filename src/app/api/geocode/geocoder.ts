import type { GeocodeDependencies } from "@/server/geocoding/handler";
import { createPlaceSearchEngine } from "@/server/geocoding/place-search";
import {
  createPhotonGeocoder,
  createTomTomPlaceSearch,
  PHOTON_DEFAULT_URL,
} from "@/infrastructure/geocoding";

/**
 * The deployment's geocoder, composed once per server process. `PHOTON_URL`
 * points at a self-hosted Photon when there is one; the public komoot instance
 * otherwise. `OGV_GEOCODER_BIAS` (`lat,lon`) is an optional regional hint set
 * by the operator. With no configured hint, Photon ranks without a location.
 *
 * `TOMTOM_API_KEY` (or the traffic-only `TOMTOM_TRAFFIC_API_KEY`) adds nearby
 * businesses — brands, categories, POI names — around the town the rider named
 * or their own ride. Without a key the search is address/place search exactly as
 * before; the key stays on the server and never reaches the browser.
 */
const photon = createPhotonGeocoder({ baseUrl: process.env.PHOTON_URL ?? PHOTON_DEFAULT_URL });

function configuredBias(): { lat: number; lon: number } | undefined {
  const configured = process.env.OGV_GEOCODER_BIAS?.trim();
  if (configured === undefined || configured === "") return undefined;
  const [lat, lon] = configured.split(",", 2).map(Number);
  return lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon }
    : undefined;
}

function tomtomPlaceSearch(env: Readonly<Record<string, string | undefined>>) {
  const key = (env["TOMTOM_API_KEY"] ?? env["TOMTOM_TRAFFIC_API_KEY"] ?? "").trim();
  return key === "" ? undefined : createTomTomPlaceSearch({ apiKey: key });
}

const bias = configuredBias();
const tomtom = tomtomPlaceSearch(process.env);

export const geocodeDependencies: GeocodeDependencies = {
  search: createPlaceSearchEngine({
    photon,
    ...(tomtom === undefined ? {} : { tomtom }),
  }),
  reverse: (coordinate, signal) => photon.reverse(coordinate, { signal }),
  ...(bias === undefined ? {} : { defaultBias: bias }),
};
