/**
 * What riders said about a catalog route where it was shared: the post, the
 * replies, photos, and the stops the author marked in the GPX. Built offline by
 * scripts/import-community-routes.ts; the catalog only carries and validates it.
 */

export type RideStopKind = "fuel" | "food" | "water" | "hazard" | "sight" | "parking" | "start" | "other";

export interface RideStoryStop {
  readonly name: string;
  readonly kind: RideStopKind;
  /** Miles from the route start to the point nearest the waypoint. */
  readonly mile: number;
  readonly lat: number;
  readonly lon: number;
}

export interface RideStoryComment {
  readonly text: string;
  readonly postedAt?: string;
}

export interface RideStoryPhoto {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

export interface RideStoryLink {
  readonly title: string;
  readonly url: string;
  readonly sharedBy?: string;
  readonly sharedAt?: string;
}

export interface CatalogRideStory {
  readonly source: { readonly name: string; readonly kind: string; readonly url?: string };
  readonly sharedBy?: string;
  readonly sharedAt?: string;
  readonly description?: string;
  readonly comments: readonly RideStoryComment[];
  readonly photos: readonly RideStoryPhoto[];
  readonly stops: readonly RideStoryStop[];
  readonly optionalLegs?: readonly { readonly name: string; readonly miles: number }[];
  /** Earlier or duplicate posts of the same ride, folded into this one. */
  readonly alsoShared?: readonly RideStoryLink[];
}

/** The list view's slice of a story: enough for a byline, none of the weight. */
export interface CatalogStoryTeaser {
  readonly sourceName: string;
  readonly sharedBy?: string;
  readonly commentCount: number;
  readonly photoCount: number;
}

const STOP_KINDS: ReadonlySet<string> = new Set(["fuel", "food", "water", "hazard", "sight", "parking", "start", "other"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Only same-origin media and http(s) links make it to the page. */
function safeMediaPath(value: unknown): value is string {
  return typeof value === "string" && ((/^\/catalog-media\/[A-Za-z0-9._/-]+$/.test(value) && !value.includes(".."))
    || /^\/api\/community\/routes\/community_[A-Za-z0-9_-]{1,40}\/photos\/[0-2]$/.test(value));
}

function safeUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function list<T>(value: unknown, item: (entry: unknown) => entry is T): readonly T[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every(item) ? value : null;
}

const isStop = (value: unknown): value is RideStoryStop => isRecord(value)
  && typeof value.name === "string" && typeof value.kind === "string" && STOP_KINDS.has(value.kind)
  && finite(value.mile) && value.mile >= 0 && finite(value.lat) && finite(value.lon);
const isComment = (value: unknown): value is RideStoryComment => isRecord(value)
  && typeof value.text === "string" && optionalString(value.postedAt);
const isPhoto = (value: unknown): value is RideStoryPhoto => isRecord(value)
  && safeMediaPath(value.src) && finite(value.width) && value.width > 0 && finite(value.height) && value.height > 0;
const isLink = (value: unknown): value is RideStoryLink => isRecord(value)
  && typeof value.title === "string" && safeUrl(value.url) && optionalString(value.sharedBy) && optionalString(value.sharedAt);
const isLeg = (value: unknown): value is { readonly name: string; readonly miles: number } => isRecord(value)
  && typeof value.name === "string" && finite(value.miles) && value.miles >= 0;

/** Undefined when absent, null when present but malformed (the entry is then rejected). */
export function parseRideStory(value: unknown): CatalogRideStory | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isRecord(value.source)) return null;
  const source = value.source;
  if (typeof source.name !== "string" || typeof source.kind !== "string" || (source.url !== undefined && !safeUrl(source.url))) return null;
  if (!optionalString(value.sharedBy) || !optionalString(value.sharedAt) || !optionalString(value.description)) return null;
  const comments = list(value.comments, isComment);
  const photos = list(value.photos, isPhoto);
  const stops = list(value.stops, isStop);
  const optionalLegs = value.optionalLegs === undefined ? undefined : list(value.optionalLegs, isLeg);
  const alsoShared = value.alsoShared === undefined ? undefined : list(value.alsoShared, isLink);
  if (comments === null || photos === null || stops === null || optionalLegs === null || alsoShared === null) return null;
  return {
    source: { name: source.name, kind: source.kind, ...(source.url === undefined ? {} : { url: source.url }) },
    ...(value.sharedBy === undefined ? {} : { sharedBy: value.sharedBy }),
    ...(value.sharedAt === undefined ? {} : { sharedAt: value.sharedAt }),
    ...(value.description === undefined ? {} : { description: value.description }),
    comments,
    photos,
    stops,
    ...(optionalLegs === undefined || optionalLegs.length === 0 ? {} : { optionalLegs }),
    ...(alsoShared === undefined || alsoShared.length === 0 ? {} : { alsoShared }),
  };
}

export function parseStoryTeaser(value: unknown): CatalogStoryTeaser | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.sourceName !== "string" || !optionalString(value.sharedBy)
    || !Number.isSafeInteger(value.commentCount) || (value.commentCount as number) < 0
    || !Number.isSafeInteger(value.photoCount) || (value.photoCount as number) < 0) return null;
  return {
    sourceName: value.sourceName,
    ...(value.sharedBy === undefined ? {} : { sharedBy: value.sharedBy }),
    commentCount: value.commentCount as number,
    photoCount: value.photoCount as number,
  };
}

export function storyTeaser(story: CatalogRideStory): CatalogStoryTeaser {
  return {
    sourceName: story.source.name,
    ...(story.sharedBy === undefined ? {} : { sharedBy: story.sharedBy }),
    commentCount: story.comments.length,
    photoCount: story.photos.length,
  };
}

/** The post's opening, trimmed to a card-sized line (whole sentences where possible). */
export function storySummary(description: string | undefined, maxLength = 150): string | undefined {
  const text = description?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [];
  let summary = "";
  for (const sentence of sentences) {
    if ((summary + sentence).trim().length > maxLength) break;
    summary += sentence;
  }
  if (summary.trim().length >= 40) return summary.trim();
  const cut = text.slice(0, maxLength - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trim()}…`;
}
