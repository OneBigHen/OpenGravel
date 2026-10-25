import type { GeocodeDependencies } from "@/server/geocoding/handler";
import { createDeploymentGeocoder } from "@/server/geocoding/fallback-geocoder";

/**
 * The deployment's geocoder, composed once per server process. `PHOTON_URL`
 * points at a self-hosted Photon when there is one; the public komoot instance
 * otherwise. `OGV_GEOCODER_BIAS` (`lat,lon`) is an optional regional hint set
 * by the operator. With `TOMTOM_API_KEY` set, TomTom answers whenever Photon
 * cannot. With no configured hint, Photon ranks without a location.
 */
const photon = createDeploymentGeocoder();

function configuredBias(): { lat: number; lon: number } | undefined {
  const configured = process.env.OGV_GEOCODER_BIAS?.trim();
  if (configured === undefined || configured === "") return undefined;
  const [lat, lon] = configured.split(",", 2).map(Number);
  return lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon }
    : undefined;
}

const bias = configuredBias();

export const geocodeDependencies: GeocodeDependencies = {
  search: (query, bias, signal) =>
    photon.search(query, { ...(bias === undefined ? {} : { bias }), signal }),
  reverse: (coordinate, signal) => photon.reverse(coordinate, { signal }),
  ...(bias === undefined ? {} : { defaultBias: bias }),
};
