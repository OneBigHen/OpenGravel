import type { Coordinate } from "@/domain/ride/types";

export interface CurrentLocationSource {
  read(): Promise<Coordinate>;
}

export interface BrowserCurrentLocationOptions {
  readonly geolocation?: Pick<Geolocation, "getCurrentPosition">;
}

/** One-shot GPS access for saving Home; position APIs stay inside infrastructure. */
export function createBrowserCurrentLocationSource(
  options: BrowserCurrentLocationOptions = {},
): CurrentLocationSource {
  const geolocation = options.geolocation ??
    (typeof navigator === "undefined" ? undefined : navigator.geolocation);
  return {
    read(): Promise<Coordinate> {
      if (geolocation === undefined) {
        return Promise.reject(new Error("location-unavailable"));
      }
      return new Promise((resolve, reject) => {
        geolocation.getCurrentPosition(
          (position) => resolve({
            lon: position.coords.longitude,
            lat: position.coords.latitude,
          }),
          (error) => reject(new Error(
            error.code === error.PERMISSION_DENIED ? "location-denied" : "location-unavailable",
          )),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
        );
      });
    },
  };
}
