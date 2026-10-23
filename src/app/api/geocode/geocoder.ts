import type { GeocodeDependencies } from "@/server/geocoding/handler";
import { createPhotonGeocoder, PHOTON_DEFAULT_URL } from "@/infrastructure/geocoding/photon";
import { createTomTomGeocoder, withFallback } from "@/infrastructure/geocoding/tomtom";

/**
 * The deployment's geocoder, composed once per server process. `PHOTON_URL`
 * points at a self-hosted Photon when there is one; the public komoot instance
 * otherwise. `OGV_GEOCODER_BIAS` (`lat,lon`) is an optional regional hint set
 * by the operator. With `TOMTOM_API_KEY` set, TomTom answers whenever Photon
 * cannot. With no configured hint, Photon ranks without a location.
 */
const tomtomKey = (process.env.TOMTOM_API_KEY ?? process.env.TOMTOM_TRAFFIC_API_KEY ?? "").trim();
// TomTom answers when Photon is down (the public instance refused every
// connection for a while on 2026-10-23 and search went dark).
const photon = withFallback(
  createPhotonGeocoder({ baseUrl: process.env.PHOTON_URL ?? PHOTON_DEFAULT_URL }),
  tomtomKey === "" ? null : createTomTomGeocoder({ apiKey: tomtomKey }),
);

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
