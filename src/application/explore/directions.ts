/**
 * A way to a place in the device's own maps app: the one action a trail system
 * page offers (L8, "a place the rider can ride to"). We hand the destination
 * to the phone's maps rather than drawing a route, because the library's place
 * is a source-supplied point, not a line anyone checked.
 */

export interface DirectionsPoint {
  readonly lat: number;
  readonly lon: number;
}

/** "Ride to the trailhead" only when the source placed a trailhead; a town or an area says what it is. */
export function directionsActionLabel(precision: "start" | "area" | "town"): string {
  switch (precision) {
    case "start":
      return "Ride to the trailhead";
    case "area":
      return "Directions to the area";
    case "town":
      return "Directions to the town";
  }
}

/** Apple Maps on Apple devices; Google Maps everywhere else. `userAgent` is injected so this stays pure. */
export function directionsToPlaceUrl(point: DirectionsPoint, userAgent?: string): string {
  const destination = `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;
  const apple = userAgent !== undefined && /iPhone|iPad|Macintosh/i.test(userAgent);
  return apple
    ? `https://maps.apple.com/?daddr=${destination}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

/** The browser's own user agent, or undefined where there is none (server render, tests). */
export function deviceUserAgent(): string | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.userAgent;
}
