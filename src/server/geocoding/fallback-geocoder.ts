import { createPhotonGeocoder, PHOTON_DEFAULT_URL, type PhotonGeocoder } from "@/infrastructure/geocoding/photon";
import { createTomTomGeocoder, withFallback } from "@/infrastructure/geocoding/tomtom";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The deployment's place search: Photon (`PHOTON_URL`, else the public komoot
 * instance), with TomTom answering whenever Photon cannot. The public Photon
 * refused every connection for a while on 2026-10-23 and search went dark.
 */
export function createDeploymentGeocoder(env: Env = process.env): PhotonGeocoder {
  const tomtomKey = (env["TOMTOM_API_KEY"] ?? env["TOMTOM_TRAFFIC_API_KEY"] ?? "").trim();
  return withFallback(
    createPhotonGeocoder({ baseUrl: env["PHOTON_URL"] ?? PHOTON_DEFAULT_URL }),
    tomtomKey === "" ? null : createTomTomGeocoder({ apiKey: tomtomKey }),
  );
}
