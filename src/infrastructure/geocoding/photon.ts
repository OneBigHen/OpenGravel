/**
 * Photon geocoder adapter (MVP parity M1; behavior ported from SwitchBack
 * `src/lib/geocoding/photon.ts`).
 *
 * Photon answers both questions the planner asks: forward search on `/api` and
 * reverse lookup on its sibling `/reverse`. This module turns its GeoJSON into
 * `PlaceMatch` values with rider-readable US labels ("Jim Thorpe, PA") and ranks
 * US places first, because OpenGravel is a US product and a query like "Lebanon"
 * should not open on the Middle East. Everything upstream-specific stays here;
 * the HTTP route and the UI only ever see `PlaceMatch`.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { PlaceMatch } from "@/application/geocoding/place-search";

export const PHOTON_DEFAULT_URL = "https://photon.komoot.io/api/";
export const PHOTON_TIMEOUT_MS = 6_000;

export class GeocoderUnavailableError extends Error {
  constructor(readonly status: number) {
    super("Place search is temporarily unavailable.");
    this.name = "GeocoderUnavailableError";
  }
}

export interface PhotonOptions {
  readonly baseUrl?: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface PhotonGeocoder {
  search(
    query: string,
    options?: { readonly bias?: Coordinate; readonly limit?: number; readonly signal?: AbortSignal },
  ): Promise<PlaceMatch[]>;
  reverse(coordinate: Coordinate, options?: { readonly signal?: AbortSignal }): Promise<PlaceMatch | null>;
}

interface PhotonProperties {
  readonly osm_id?: string | number;
  readonly osm_type?: string;
  readonly osm_key?: string;
  readonly osm_value?: string;
  readonly type?: string;
  readonly name?: string;
  readonly housenumber?: string;
  readonly street?: string;
  readonly district?: string;
  readonly city?: string;
  readonly county?: string;
  readonly state?: string;
  readonly country?: string;
  readonly countrycode?: string;
  readonly postcode?: string;
}

interface PhotonFeature {
  readonly geometry?: { readonly type?: string; readonly coordinates?: readonly number[] } | null;
  readonly properties?: PhotonProperties;
}

const US_STATES: Readonly<Record<string, string>> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
  Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
  Wyoming: "WY", "Puerto Rico": "PR",
};

/** Feature classes whose `name` is a road, a building or an area, not a destination. */
const UNNAMEABLE_KEYS = new Set(["highway", "building", "landuse", "boundary", "place", "railway"]);

/** Beyond this, a reverse name is a neighbour, and the label says "Near". */
const NEAR_THRESHOLD_METERS = 1_500;
/** A named POI only names the pin when the pin is actually at it. */
const POI_NAME_RADIUS_METERS = 150;

function isUs(properties: PhotonProperties): boolean {
  return properties.countrycode?.toUpperCase() === "US" || properties.country === "United States";
}

function regionLabel(properties: PhotonProperties): string {
  const state = properties.state ?? "";
  if (isUs(properties)) return US_STATES[state] ?? state;
  return [state, properties.country].filter(Boolean).join(", ");
}

function unique(parts: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const trimmed = part?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    kept.push(trimmed);
  }
  return kept;
}

function coordinateOf(feature: PhotonFeature): Coordinate | null {
  const coordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type !== "Point" || coordinates === undefined) return null;
  const [lon, lat] = coordinates;
  if (lon === undefined || lat === undefined) return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lon, lat };
}

function featureId(properties: PhotonProperties, fallback: number): string {
  return `photon:${properties.osm_type ?? "F"}${properties.osm_id ?? fallback}`;
}

/** One forward-search result: `Name, Town, ST` with a context line beneath. */
export function placeFromSearchFeature(feature: PhotonFeature, index: number): PlaceMatch | null {
  const coordinate = coordinateOf(feature);
  if (coordinate === null) return null;
  const properties = feature.properties ?? {};
  const street = unique([
    [properties.housenumber, properties.street].filter(Boolean).join(" "),
  ])[0];
  const name = properties.name ?? street ?? properties.city ?? properties.county;
  if (name === undefined || name.trim() === "") return null;
  const locality = properties.city ?? properties.district;
  const region = regionLabel(properties);
  // The label is what the point keeps, so it stays short: `Name, Town, ST`.
  // A named place's street address goes on the context line instead.
  const label = unique([name, locality, region]).join(", ");
  const context = unique([
    properties.name === undefined ? undefined : street,
    locality === name ? undefined : locality,
    properties.county === undefined ? undefined : `${properties.county} County`,
    region,
  ])
    .filter((part) => part.toLowerCase() !== name.toLowerCase())
    .join(", ");
  return {
    id: featureId(properties, index),
    label,
    name,
    context,
    coordinate,
    provider: "photon",
  };
}

/**
 * The name for a dropped pin: the town it is in (`Jim Thorpe, PA`), the named
 * place it sits on when it sits on one (`Hawk Mountain Sanctuary, Kempton, PA`),
 * and `Near …` when the nearest named thing is far away. A street name alone is
 * not a place a rider recognizes, so roads and houses only contribute their town.
 */
export function placeFromReverseFeature(
  feature: PhotonFeature,
  query: Coordinate,
): PlaceMatch | null {
  const coordinate = coordinateOf(feature);
  if (coordinate === null) return null;
  const properties = feature.properties ?? {};
  const distance = haversine(query, coordinate);
  // A town feature is its own locality; everything else is *in* one.
  const locality =
    (properties.osm_key === "place" ? properties.name : undefined) ??
    properties.city ??
    properties.district ??
    (properties.county === undefined ? undefined : `${properties.county} County`);
  const region = regionLabel(properties);
  const poi =
    properties.name !== undefined &&
    !UNNAMEABLE_KEYS.has(properties.osm_key ?? "") &&
    distance <= POI_NAME_RADIUS_METERS
      ? properties.name
      : undefined;
  const parts = unique([poi, locality, region]);
  if (parts.length === 0 || (poi === undefined && locality === undefined)) return null;
  const base = parts.join(", ");
  const label = distance > NEAR_THRESHOLD_METERS ? `Near ${base}` : base;
  return {
    id: featureId(properties, 0),
    label,
    name: poi ?? locality ?? base,
    context: unique([poi === undefined ? undefined : locality, region]).join(", "),
    // The name describes the rider's coordinate; the feature's own position
    // is not a place the rider chose.
    coordinate: query,
    provider: "photon",
  };
}

const US_STATE_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries(US_STATES)
    // Longest first, so "West Virginia" is not read as "Virginia".
    .sort(([left], [right]) => right.length - left.length)
    .map(([name, code]) => [name.toLowerCase(), code]),
);
const US_STATE_CODES: ReadonlySet<string> = new Set(Object.values(US_STATES));

/**
 * The US state a query names at its end ("Denver, CO", "Moab Utah"), as its
 * two-letter code, or `null`. An abbreviation counts after a comma, or in
 * capitals, so "coffee in" is not Indiana.
 */
export function namedUsState(query: string): string | null {
  const trimmed = query.trim().replace(/[.\s]+$/, "");
  for (const [name, code] of US_STATE_NAMES) {
    if (trimmed.toLowerCase().endsWith(name)) {
      const before = trimmed.slice(0, trimmed.length - name.length);
      if (before === "" || /[\s,]$/.test(before)) return before.trim() === "" ? null : code;
    }
  }
  const match = /(,\s*|\s)([A-Za-z]{2})$/.exec(trimmed);
  if (match === null || trimmed.length <= 3) return null;
  const code = match[2]!.toUpperCase();
  if (!US_STATE_CODES.has(code)) return null;
  return match[1]!.includes(",") || match[2] === code ? code : null;
}

/**
 * US places first, then provider order — except that nearby namesakes lead when
 * the rider's ride is already somewhere (the bias), so "Newville" near Carlisle
 * finds the Pennsylvania one.
 */
export function rankPlaces(
  places: readonly PlaceMatch[],
  usFlags: readonly boolean[],
  bias?: Coordinate,
  states?: readonly (string | null)[],
  namedState?: string | null,
  /** Per place: a town or city whose name is exactly what the rider typed. */
  exactTowns?: readonly boolean[],
): PlaceMatch[] {
  return places
    .map((place, index) => ({
      place,
      index,
      us: usFlags[index] ?? false,
      state: states?.[index] ?? null,
      exact: exactTowns?.[index] ?? false,
    }))
    .sort((left, right) => {
      // PT-02: "Lyon, France" is the city of Lyon, even for a ride that starts
      // in Paris, where "Gare de Lyon" is near. A town named exactly what was
      // typed outranks things merely named after it; the bias then only
      // chooses among same-named towns.
      if (left.exact !== right.exact) return left.exact ? -1 : 1;
      // The state the rider typed outranks everything, the bias included:
      // "Denver, CO" is Colorado even for a rider whose ride is in Lancaster.
      if (namedState !== undefined && namedState !== null) {
        const inLeft = left.state === namedState;
        const inRight = right.state === namedState;
        if (inLeft !== inRight) return inLeft ? -1 : 1;
      }
      if (left.us !== right.us) return left.us ? -1 : 1;
      if (bias !== undefined) {
        const nearLeft = haversine(bias, left.place.coordinate) < 150_000;
        const nearRight = haversine(bias, right.place.coordinate) < 150_000;
        if (nearLeft !== nearRight) return nearLeft ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ place }) => place);
}

const TOWN_VALUES: ReadonlySet<string> = new Set(["city", "town", "village", "hamlet", "municipality"]);

/** A settlement (not a station or a road) whose name is exactly the typed name. */
function isExactTown(properties: PhotonProperties, typedName: string): boolean {
  if (typedName.length === 0 || properties.name === undefined) return false;
  const town = (properties.osm_key === "place" && TOWN_VALUES.has(properties.osm_value ?? ""))
    || properties.type === "city";
  return town && properties.name.trim().toLowerCase() === typedName;
}

function reverseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.search = "";
  url.pathname = /\/api\/?$/.test(url.pathname)
    ? url.pathname.replace(/\/api\/?$/, "/reverse")
    : `${url.pathname.replace(/\/+$/, "")}/reverse`;
  return url;
}

export function createPhotonGeocoder(options: PhotonOptions = {}): PhotonGeocoder {
  const baseUrl = options.baseUrl ?? PHOTON_DEFAULT_URL;
  const timeoutMs = options.timeoutMs ?? PHOTON_TIMEOUT_MS;

  async function features(url: URL, signal: AbortSignal | undefined): Promise<PhotonFeature[]> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(url, {
        headers: { accept: "application/geo+json, application/json" },
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
    } catch {
      throw new GeocoderUnavailableError(503);
    }
    if (!response.ok) throw new GeocoderUnavailableError(response.status >= 500 ? 502 : 503);
    try {
      const body = (await response.json()) as { features?: unknown };
      return Array.isArray(body.features) ? (body.features as PhotonFeature[]) : [];
    } catch {
      throw new GeocoderUnavailableError(502);
    }
  }

  return {
    async search(query, searchOptions = {}) {
      const url = new URL(baseUrl);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(Math.max(1, Math.min(searchOptions.limit ?? 8, 12))));
      url.searchParams.set("lang", "en");
      const namedState = namedUsState(query);
      // A named state is the rider's own answer to "where": the location bias
      // (their ride, or OpenGravel's home region) would only pull namesakes in.
      const bias = namedState === null ? searchOptions.bias : undefined;
      if (bias !== undefined) {
        url.searchParams.set("lat", bias.lat.toFixed(4));
        url.searchParams.set("lon", bias.lon.toFixed(4));
      }
      // PT-02: a place the rider qualified ("Lyon, France") may be far from
      // the bias, which then filters it out entirely. Ask once without the
      // bias too, and let the ranking below choose.
      const qualified = bias !== undefined && query.includes(",");
      const unbiasedUrl = new URL(url);
      unbiasedUrl.searchParams.delete("lat");
      unbiasedUrl.searchParams.delete("lon");
      const [biasedRaw, unbiasedRaw] = await Promise.all([
        features(url, searchOptions.signal),
        qualified ? features(unbiasedUrl, searchOptions.signal).catch(() => [] as PhotonFeature[]) : Promise.resolve([] as PhotonFeature[]),
      ]);
      const raw = [...biasedRaw, ...unbiasedRaw];
      const places: PlaceMatch[] = [];
      const usFlags: boolean[] = [];
      const states: (string | null)[] = [];
      const exactTowns: boolean[] = [];
      const typedName = query.split(",")[0]?.trim().toLowerCase() ?? "";
      const labels = new Set<string>();
      raw.forEach((feature, index) => {
        const place = placeFromSearchFeature(feature, index);
        if (place === null || labels.has(place.label)) return;
        labels.add(place.label);
        places.push(place);
        usFlags.push(isUs(feature.properties ?? {}));
        states.push(US_STATES[feature.properties?.state ?? ""] ?? null);
        exactTowns.push(isExactTown(feature.properties ?? {}, typedName));
      });
      return rankPlaces(places, usFlags, bias, states, namedState, exactTowns).slice(0, 6);
    },

    async reverse(coordinate, reverseOptions = {}) {
      const url = reverseUrl(baseUrl);
      url.searchParams.set("lat", coordinate.lat.toFixed(5));
      url.searchParams.set("lon", coordinate.lon.toFixed(5));
      url.searchParams.set("limit", "1");
      url.searchParams.set("lang", "en");
      const [first] = await features(url, reverseOptions.signal);
      return first === undefined ? null : placeFromReverseFeature(first, coordinate);
    },
  };
}
