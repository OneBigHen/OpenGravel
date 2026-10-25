/**
 * Distance from the rider to where a route starts, in the words a rider says
 * it. The list and the route page round the same way so one ride does not read
 * as "8 mi away" in one place and "10 mi from you" in the other.
 */

/** Miles rounded to what a rider would say: whole below ten, fives above. */
function spokenMiles(km: number): string {
  const miles = km / 1.609344;
  return `${miles < 10 ? miles.toFixed(0) : Math.round(miles / 5) * 5} mi`;
}

/** "12 mi away" on a ride card, or null when the distance is not known. */
export function awayLabel(km: number): string | null {
  if (!Number.isFinite(km)) return null;
  if (km / 1.609344 < 1) return "Starts near you";
  return `${spokenMiles(km)} away`;
}

/** "Starts 12 mi from you" on the route page, or null when it is not known. */
export function startDistanceLabel(km: number): string | null {
  if (!Number.isFinite(km)) return null;
  if (km / 1.609344 < 1) return "Starts near you";
  return `Starts ${spokenMiles(km)} from you`;
}
