import type { LibraryRecord } from "./types";

const LANES: ReadonlySet<string> = new Set(["dual-sport", "single-track", "adv", "bdr", "bdr-x", "scenic", "gravel", "paved-twisty", "mixed"]);
const ID_PATTERN = /^[a-z]{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
const STATE_PATTERN = /^([A-Z]{2}|NATIONAL)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export type RecordCheck =
  | { readonly ok: true; readonly record: LibraryRecord }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * Gate for stage 1: a record must carry every field the pack uses, with the
 * shapes `route-record.schema.json` demands of them. A failing record is
 * skipped and listed in the report, never repaired.
 */
export function checkLibraryRecord(raw: unknown): RecordCheck {
  const reasons: string[] = [];
  if (!isRecord(raw)) return { ok: false, reasons: ["not a JSON object"] };
  if (typeof raw["id"] !== "string" || !ID_PATTERN.test(raw["id"])) reasons.push("id is missing or malformed");
  if (typeof raw["name"] !== "string" || raw["name"].length < 3 || raw["name"].length > 80) reasons.push("name must be 3 to 80 characters");
  const states = raw["states"];
  if (!Array.isArray(states) || states.length === 0 || !states.every((state) => typeof state === "string" && STATE_PATTERN.test(state))) reasons.push("states are missing or malformed");
  if (typeof raw["lane"] !== "string" || !LANES.has(raw["lane"])) reasons.push("lane is not one of the known lanes");
  const source = raw["source"];
  if (!isRecord(source) || typeof source["name"] !== "string" || source["name"].trim() === "" || !httpUrl(source["url"])) reasons.push("source needs a name and a web address");
  const credit = raw["author_credit"];
  if (!isRecord(credit) || typeof credit["author"] !== "string") reasons.push("author_credit.author is missing");
  const score = raw["value_score"];
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) reasons.push("value_score must be a whole number from 1 to 5");
  if (typeof raw["scraped_at"] !== "string" || typeof raw["last_verified"] !== "string") reasons.push("scraped_at and last_verified are required");
  const gpx = raw["gpx"];
  if (!isRecord(gpx) || (gpx["availability"] !== "hosted" && gpx["availability"] !== "link-only" && gpx["availability"] !== "none")) reasons.push("gpx.availability is missing or unknown");
  else if (gpx["availability"] === "hosted" && typeof gpx["local_file"] !== "string") reasons.push("hosted record has no local_file");
  if (!isRecord(raw["terms"]) || !isRecord(raw["publishability"])) reasons.push("terms and publishability are required");
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, record: raw as unknown as LibraryRecord };
}
