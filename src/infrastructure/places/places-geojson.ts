/**
 * Optional places provider `/api/v1` contract 1.0 → `NearbyPlace`.
 *
 * The provider's GeoJSON is validated feature by feature: a malformed feature is
 * dropped, never half-mapped, and a response that is not a FeatureCollection is a
 * parse failure. Unknown properties are ignored, so additive provider changes
 * (which keep `contract: "1.0"`) cannot break us.
 */

import { asPlaceId, type NearbyPlace, type PlaceKind, type PlaceStatus } from "@/application/places";

export const PLACES_CONTRACT = "1.0";

export class PlacesContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlacesContractError";
  }
}

export interface ParsedPlacesCollection {
  readonly places: readonly NearbyPlace[];
  readonly dropped: number;
  readonly fetchedAt: string;
  readonly attribution: string;
}

type Json = Record<string, unknown>;

const KINDS: readonly PlaceKind[] = ["happy_hour", "event"];
const STATUSES: readonly PlaceStatus[] = ["now", "later", "done", "day", "upcoming"];

function record(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(value: unknown): string | null {
  const out = text(value);
  return out === "" ? null : out;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Only https links reach the rider; anything else is dropped. */
function httpsUrl(value: unknown): string | null {
  const raw = text(value);
  if (raw === "") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parsePlaceFeature(feature: unknown): NearbyPlace | null {
  if (!record(feature) || feature["type"] !== "Feature") return null;
  const id = text(feature["id"]);
  const geometry = feature["geometry"];
  const props = feature["properties"];
  if (id === "" || !record(geometry) || !record(props) || geometry["type"] !== "Point") return null;
  const coords = geometry["coordinates"];
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = finite(coords[0]);
  const lat = finite(coords[1]);
  if (lon === null || lat === null || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  const kind = props["kind"];
  const status = props["status"];
  if (!KINDS.includes(kind as PlaceKind) || !STATUSES.includes(status as PlaceStatus)) return null;
  const name = text(props["name"]);
  const url = httpsUrl(props["url"]);
  if (name === "" || url === null) return null;
  const rating = finite(props["rating"]);
  const specials = Array.isArray(props["specials"])
    ? props["specials"].filter((s): s is string => typeof s === "string" && s.trim() !== "").slice(0, 5)
    : [];
  return {
    id: asPlaceId(id),
    kind: kind as PlaceKind,
    name,
    coordinate: { lon, lat },
    category: text(props["category"], kind === "event" ? "Event" : "Bar"),
    label: text(props["label"]),
    status: status as PlaceStatus,
    city: text(props["city"]),
    address: text(props["address"]),
    specials,
    schedule: optionalText(props["schedule"]),
    startUtc: kind === "event" ? optionalText(props["start_utc"]) : null,
    endUtc: kind === "event" ? optionalText(props["end_utc"]) : null,
    timeZone: text(props["timezone"], "UTC"),
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    popular: props["popular"] === true,
    dogFriendly: flag(props["dog"]),
    patio: flag(props["patio"]),
    ...(optionalText(props["source_id"]) === null ? {} : { sourceId: optionalText(props["source_id"]) }),
    ...(httpsUrl(props["image"]) === null ? {} : { imageUrl: httpsUrl(props["image"]) }),
    ...(optionalText(props["venue"]) === null ? {} : { venue: optionalText(props["venue"]) }),
    ...(optionalText(props["source_label"]) === null ? {} : { sourceLabel: optionalText(props["source_label"]) }),
    ...(httpsUrl(props["source_url"]) === null ? {} : { sourceUrl: httpsUrl(props["source_url"]) }),
    ...(flag(props["motorcycle_specific"]) === null ? {} : { motorcycleSpecific: flag(props["motorcycle_specific"]) }),
    ...(Array.isArray(props["tags"])
      ? {
          tags: [...new Set(props["tags"]
            .filter((value): value is string => typeof value === "string" && value.trim() !== "")
            .map((value) => value.trim().toLowerCase()))].slice(0, 12),
        }
      : {}),
    url,
    mapsUrl: httpsUrl(props["maps_url"]),
    offRouteMiles: finite(props["off_route_mi"]),
    routeMile: finite(props["route_mile"]),
  };
}

export function parsePlacesCollection(body: unknown): ParsedPlacesCollection {
  if (!record(body) || body["type"] !== "FeatureCollection" || !Array.isArray(body["features"])) {
    throw new PlacesContractError("not a FeatureCollection");
  }
  const meta = record(body["meta"]) ? body["meta"] : {};
  const contract = text(meta["contract"]);
  if (contract !== "" && contract.split(".")[0] !== PLACES_CONTRACT.split(".")[0]) {
    throw new PlacesContractError(`unsupported contract ${contract}`);
  }
  const places: NearbyPlace[] = [];
  let dropped = 0;
  for (const feature of body["features"]) {
    const place = parsePlaceFeature(feature);
    if (place === null) dropped += 1;
    else places.push(place);
  }
  return {
    places,
    dropped,
    fetchedAt: text(meta["generated_at"]) || new Date(0).toISOString(),
    attribution: text(meta["attribution"], "sample places provider"),
  };
}
