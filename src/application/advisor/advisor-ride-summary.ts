/** Small projection of an existing route. No coordinates, authored labels, IDs or new provider calls. */
import { CURVINESS_LABELS, curvinessLevel } from "@/application/roads/engine-road-evidence";
import { buildRouteExplanation } from "@/application/planner/route-explanation";
import { isUsableEvidence } from "@/domain/evidence/types";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import type { RideDocument } from "@/domain/ride/types";
import type { RouteBundle } from "@/domain/route/types";
import { utf8Size } from "./advisor-conversation";

export const MAX_ADVISOR_SUMMARY_BYTES = 1500;
export interface AdvisorRideSummary {
  readonly distanceKm: number;
  readonly durationMinutes: number;
  readonly climbMeters: number | null;
  readonly surface: string;
  readonly curviness: string;
  readonly roads: readonly string[];
  readonly stops: readonly string[];
  readonly stopCount: number;
  readonly why: string;
  readonly alternatives: readonly { readonly distanceKmDelta: number; readonly minutesDelta: number }[];
}

const rounded = (value: number): number => Math.round(value * 10) / 10;
type RouteEvidenceEntry = RouteBundle["candidates"][number]["evidence"][string] | undefined;
const usable = (entry: RouteEvidenceEntry): boolean => entry !== undefined && isUsableEvidence(entry);

/** Only public road names: omit address-like strings and personal endpoint labels. */
function roadName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 60
    && /^[\p{L}][\p{L}\p{N} .,'’()/-]*$/u.test(value)
    && !/\b(home|work|private|password|secret|token)\b/i.test(value)
    && (!/\d/.test(value) || /^(?:(?:US|PA|NJ|NY|DE|MD|VA|WV|OH|I)[ -]?|(?:State |County )?(?:Route|Road|Highway) )\d+[A-Za-z]?$/i.test(value));
}

function namedRoads(entry: RouteEvidenceEntry): readonly unknown[] {
  if (!usable(entry) || typeof entry?.value !== "object" || entry.value === null) return [];
  const roads = (entry.value as Record<string, unknown>)["roads"];
  return Array.isArray(roads) ? roads.map((road: unknown) => typeof road === "object" && road !== null ? (road as Record<string, unknown>)["name"] : null) : [];
}

function surfaceSummary(entry: RouteEvidenceEntry, routeMeters: number): string {
  if (!usable(entry) || typeof entry?.value !== "object" || entry.value === null) return "Surface unknown";
  const mix = entry.value as Record<string, unknown>;
  const keys = ["pavedMeters", "gravelMeters", "dirtMeters", "unknownMeters"];
  if (!keys.every((key) => typeof mix[key] === "number" && Number.isFinite(mix[key]) && mix[key] >= 0)) return "Surface unknown";
  const [paved, gravel, dirt, missing] = keys.map((key) => Number(mix[key])) as [number, number, number, number];
  const total = Math.max(routeMeters, paved + gravel + dirt + missing);
  if (!(total > 0)) return "Surface unknown";
  const unknown = Math.max(missing, total - paved - gravel - dirt);
  const percent = (meters: number): string => meters > 0 && meters / total < 0.005 ? "<1" : String(Math.round(meters / total * 100));
  return `${entry!.status === "estimated" ? "Estimated: " : ""}${percent(paved)}% paved, ${percent(gravel)}% gravel, ${percent(dirt)}% dirt, ${percent(unknown)}% unknown`;
}

export function summarizeAdvisorRide(
  document: RideDocument,
  bundle: RouteBundle | null,
  climbMeters: number | null = null,
): AdvisorRideSummary | null {
  // Last-good routes for an older revision must not describe the current ride.
  if (bundle === null || bundle.rideId !== document.rideId || bundle.rideRevision !== document.revision) return null;
  const chosen = bundle.candidates.find((candidate) => candidate.id === bundle.selectedRouteId);
  if (chosen === undefined || !chosen.eligibility.eligible
    || !Number.isFinite(chosen.distanceMeters) || chosen.distanceMeters < 0
    || !Number.isFinite(chosen.durationSeconds) || chosen.durationSeconds < 0) return null;
  const evidence = chosen.evidence;
  const surface = surfaceSummary(evidence["surfaceMix"], chosen.distanceMeters);
  const level = usable(evidence["curvature"]) ? curvinessLevel(evidence["curvature"]) : null;
  const fastest = bundle.candidates.filter((candidate) => candidate.eligibility.eligible).reduce((a, b) => a.durationSeconds < b.durationSeconds ? a : b, chosen);
  const explanation = buildRouteExplanation({ candidate: chosen, intent: document.intent, policy: PA_NJ_ROUTE_POLICY_VNEXT_1,
    fastest: { candidate: fastest, addedMinutes: (chosen.durationSeconds - fastest.durationSeconds) / 60 } });
  let summary: AdvisorRideSummary = {
    distanceKm: rounded(chosen.distanceMeters / 1000),
    durationMinutes: rounded(chosen.durationSeconds / 60),
    climbMeters: climbMeters !== null && Number.isFinite(climbMeters) && climbMeters >= 0 ? Math.round(climbMeters) : null,
    surface,
    curviness: level === null ? "Curviness unknown" : `${evidence["curvature"]!.status === "estimated" ? "Estimated: " : ""}${CURVINESS_LABELS[level - 1]}`,
    // Road names only, not free-form turn text (which may include an address).
    roads: [...new Set([
      ...(chosen.instructions ?? []).map((instruction) => instruction.roadName),
      ...namedRoads(evidence["namedRoads"]),
    ].filter(roadName))].slice(0, 5),
    stops: document.intent.stops.slice(0, 5).map((stop) => stop.arrivalIntent ?? "unspecified"),
    stopCount: document.intent.stops.length,
    why: explanation.headline.slice(0, 220),
    alternatives: bundle.candidates.filter((candidate) => candidate.id !== chosen.id && candidate.eligibility.eligible)
      .slice(0, 3).map((candidate) => ({ distanceKmDelta: rounded((candidate.distanceMeters - chosen.distanceMeters) / 1000), minutesDelta: rounded((candidate.durationSeconds - chosen.durationSeconds) / 60) })),
  };
  // Even multibyte public names cannot overflow the wire budget.
  while (utf8Size(summary) > MAX_ADVISOR_SUMMARY_BYTES && summary.roads.length > 0) summary = { ...summary, roads: summary.roads.slice(0, -1) };
  return isAdvisorRideSummary(summary) ? summary : null;
}

/** Only the existing explanation grammar can cross the wire; never arbitrary factual prose. */
function validExplanation(value: string): boolean {
  if (["No faster route to compare this ride against.", "Matches the fastest option in time."].includes(value)) return true;
  const benefit = "(?:a curvier line|more back-road character|a closer surface match|more elevation change|lower traffic|fewer junctions|more new-to-you road|a lower closure risk)";
  return new RegExp(`^Adds \\d+ minutes(?: and \\d+(?:\\.\\d+)? mi more)?(?: over the fastest option| for ${benefit}(?: and ${benefit})?)\\.$`).test(value);
}

function validSurface(value: string): boolean {
  const percent = "(?:<1|100|[1-9]?\\d)";
  return value === "Surface unknown" || new RegExp(`^(?:Estimated: )?${percent}% paved, ${percent}% gravel, ${percent}% dirt, ${percent}% unknown$`).test(value);
}

export function isAdvisorRideSummary(value: unknown): value is AdvisorRideSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value) || utf8Size(value) > MAX_ADVISOR_SUMMARY_BYTES) return false;
  const item = value as Record<string, unknown>;
  const keys = ["distanceKm", "durationMinutes", "climbMeters", "surface", "curviness", "roads", "stops", "stopCount", "why", "alternatives"];
  const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e8;
  const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !v.includes("\u0000");
  return Object.keys(item).length === keys.length && keys.every((key) => Object.hasOwn(item, key))
    && number(item["distanceKm"]) && item["distanceKm"] >= 0 && number(item["durationMinutes"]) && item["durationMinutes"] >= 0
    && (item["climbMeters"] === null || (number(item["climbMeters"]) && item["climbMeters"] >= 0))
    && text(item["surface"], 160) && validSurface(item["surface"])
    && text(item["curviness"], 60) && ["Curviness unknown", ...CURVINESS_LABELS, ...CURVINESS_LABELS.map((label) => `Estimated: ${label}`)].includes(item["curviness"])
    && text(item["why"], 220) && validExplanation(item["why"])
    && Array.isArray(item["roads"]) && item["roads"].length <= 5 && item["roads"].every(roadName)
    && Array.isArray(item["stops"]) && item["stops"].length <= 5 && item["stops"].every((stop) => typeof stop === "string" && ["visit", "fuel", "food", "lodging", "scenic", "other", "unspecified"].includes(stop))
    && Number.isSafeInteger(item["stopCount"]) && Number(item["stopCount"]) >= (item["stops"] as unknown[]).length
    && Array.isArray(item["alternatives"]) && item["alternatives"].length <= 3 && item["alternatives"].every((alt: unknown) => {
      if (typeof alt !== "object" || alt === null) return false;
      const delta = alt as Record<string, unknown>;
      return Object.keys(delta).length === 2 && number(delta["distanceKmDelta"]) && number(delta["minutesDelta"]);
    });
}

/** Model chooses the answer intent; only the app's bounded facts become the answer. */
export function advisorRideAnswer(summary: AdvisorRideSummary | undefined): string {
  if (summary === undefined) return "Plan a ride first, then I can explain the selected route.";
  return `${summary.why} About ${Math.round(summary.distanceKm / 1.609344)} miles and ${Math.round(summary.durationMinutes)} minutes. ${summary.surface}. ${summary.curviness}. ${summary.climbMeters === null ? "Climb unknown." : `About ${Math.round(summary.climbMeters * 3.28084).toLocaleString("en-US")} ft of climbing.`} I can't see closures, gates or access rules, so check those before you go.`;
}
