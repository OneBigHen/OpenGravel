/**
 * "Where to ride this weekend" (R3-8): up to three rides a rider can reach from
 * where they are standing, chosen from the catalog and ready to open.
 *
 * The rules, all decided here rather than in the strip:
 *
 * - **No position, no picks.** Without a fix the module answers `null`, and the
 *   surface shows nothing at all. A made-up "near you" is worse than silence.
 * - **A ride has to be a ride.** The start is within 60 mi, the ride lasts 1.5 to
 *   6 hours, and the rider has not hidden it. A candidate whose length or time
 *   nobody measured is left out rather than guessed into the list.
 * - **The three cards tell a rider something.** When the catalog has them, the
 *   strip holds at least one mostly unpaved ride and one twisty ride: three
 *   versions of the same afternoon are not a choice.
 * - **Dry is a forecast, never a mood.** A day reads "dry" only when a forecast
 *   for that day answered. A missing answer reads "Forecast not available".
 *
 * Pure: no clock, no network, no DOM. The caller supplies the catalog slice, the
 * rider's position, the bike and the forecasts it already fetched.
 */

import type { WeatherForecastPeriod } from "@/application/preparation/providers";
import type { CatalogEntry } from "./catalog";
import { distanceToStartKm } from "./query";

/** The same pace the Explore cards estimate an unstated ride time at. */
const RIDE_TIME_PACE_MPH = 28;
const RIDE_TIME_STEP_MINUTES = 15;

const KM_PER_MILE = 1.609344;

/** A start farther than this is not a weekend pick. */
export const WEEKEND_START_MILES = 60;
const WEEKEND_START_KM = WEEKEND_START_MILES * KM_PER_MILE;

/** A pick is an afternoon out, not a coffee run and not a tour. */
export const WEEKEND_MIN_RIDE_MINUTES = 90;
export const WEEKEND_MAX_RIDE_MINUTES = 360;

/** Most picks the strip holds. */
export const WEEKEND_PICK_COUNT = 3;

/** Rain this likely is worth naming on the card. */
const WET_PRECIP_CHANCE = 50;

/** The part of a garage bike the picks read. */
export interface WeekendPickBike {
  readonly name: string;
  readonly maintainedGravel: "allow" | "avoid";
  readonly roughTracks: "allow" | "avoid";
}

/** One day of a candidate's forecast, in the order the strip shows it. */
export interface WeekendPickForecastDay {
  readonly label: string;
  readonly periods: readonly WeatherForecastPeriod[];
}

export interface WeekendPicksInput {
  readonly entries: readonly CatalogEntry[];
  /** The rider's position as `[lon, lat]`; absent means no strip. */
  readonly position?: readonly [number, number] | undefined;
  /** Day labels in strip order, e.g. `["Sat", "Sun"]`. */
  readonly dayLabels: readonly string[];
  /**
   * Forecast periods per entry id, one list per supplied day label. An absent
   * entry, or a day with no periods, reads "Forecast not available".
   */
  readonly forecasts?: ReadonlyMap<string, readonly WeekendPickForecastDay[]> | undefined;
  readonly bike?: WeekendPickBike | null;
  /** Routes the rider asked Explore not to show. */
  readonly hiddenIds?: ReadonlySet<string>;
}

/** One card in the weekend strip. */
export interface WeekendPick {
  readonly entry: CatalogEntry;
  /** Kilometres from the rider to where the ride starts. */
  readonly distanceKm: number;
  /** The ride's own time, stored or estimated at the card's pace. */
  readonly timeMinutes: number;
  /** How unpaved the ride is, in miles; `0` for a paved ride. */
  readonly unpavedMiles: number;
  /** "42 mi gravel", "24 mi unpaved" or "17 mi of curves"; `null` when neither is known. */
  readonly character: string | null;
  /** One phrase per supplied day, e.g. "Sat: dry, 54°". */
  readonly weather: readonly string[];
}

interface Candidate {
  readonly entry: CatalogEntry;
  readonly distanceKm: number;
  readonly timeMinutes: number;
  readonly unpavedMiles: number;
  readonly unpavedWord: string | null;
  /** A day's dampest hour across the supplied forecasts; missing is `Infinity`. */
  readonly wetness: number;
}

/** `2026-11-14` in the rider's own civil day, never a UTC slice. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * The weekend's days as the strip names them. Monday to Saturday look forward
 * to Saturday and Sunday; Sunday has only itself left.
 */
export function weekendDayPlan(now: Date): readonly { readonly label: string; readonly dayKey: string }[] {
  const day = now.getDay();
  const saturday = new Date(now);
  saturday.setDate(saturday.getDate() + (day === 0 ? -1 : (6 - day + 7) % 7));
  const sunday = new Date(saturday);
  sunday.setDate(sunday.getDate() + 1);
  if (day === 0) return [{ label: "Sun", dayKey: localDayKey(now) }];
  return [
    { label: "Sat", dayKey: localDayKey(saturday) },
    { label: "Sun", dayKey: localDayKey(sunday) },
  ];
}

/**
 * The strip's title. Early in the week it promises the weekend; from Friday the
 * rider is in it, so the title names the days that are actually left.
 */
export function weekendStripTitle(now: Date): string {
  switch (now.getDay()) {
    case 5: return "Near you Saturday and Sunday";
    case 6: return "Near you today and tomorrow";
    case 0: return "Near you today";
    default: return "Near you this weekend";
  }
}

/** Miles rounded the way a rider says them: whole above ten, one decimal below. */
function milesNumber(miles: number): string {
  if (!(miles > 0)) return "0";
  return miles >= 10 ? String(Math.round(miles)) : String(Number(miles.toFixed(1)));
}

/**
 * The unpaved mileage a catalog surface summary states, or `null` when the
 * summary is missing or in words this module cannot trust.
 *
 * The catalog writes "Mostly paved · 2.1 mi gravel", "Mixed · 24 mi unpaved"
 * and "Paved". Only the measured mileage is read; the "Mostly" prefix is the
 * catalog's own prose, not a number to add up.
 */
function readSurfaceSummary(summary: string | undefined): {
  readonly unpavedMiles: number;
  readonly unpavedWord: string | null;
} | null {
  if (summary === undefined || summary.trim() === "") return null;
  if (/^paved$/i.test(summary.trim())) return { unpavedMiles: 0, unpavedWord: null };
  const detailed = /·\s*([\d.]+)\s*mi\s+(gravel|dirt|unpaved)/i.exec(summary);
  if (detailed !== null) {
    const miles = Number(detailed[1]);
    if (Number.isFinite(miles) && miles >= 0) {
      return {
        unpavedMiles: miles,
        unpavedWord: (detailed[2] ?? "unpaved").toLowerCase(),
      };
    }
  }
  return null;
}

/** Whether the ride is mostly unpaved, from the measured mileage when it exists. */
function isMostlyUnpaved(entry: CatalogEntry): boolean {
  const surface = readSurfaceSummary(entry.surfaceSummary);
  if (surface === null) return false;
  const distanceMiles = entry.distanceKm === null ? null : entry.distanceKm / KM_PER_MILE;
  if (distanceMiles !== null && distanceMiles > 0) {
    return surface.unpavedMiles / distanceMiles >= 0.5;
  }
  return /^mostly unpaved/i.test(entry.surfaceSummary ?? "");
}

/** The catalog's own curve evidence, the same reading the Twisty chip uses. */
function isTwisty(entry: CatalogEntry): boolean {
  return entry.curvatureSummary !== undefined
    && !/few curves|unknown|not measured/i.test(entry.curvatureSummary);
}

/** The ride time a distance implies at the card's pace, to the quarter hour. */
function estimatedMinutes(distanceKm: number | null): number | null {
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const miles = distanceKm / KM_PER_MILE;
  const minutes = (miles / RIDE_TIME_PACE_MPH) * 60;
  return Math.max(RIDE_TIME_STEP_MINUTES, Math.round(minutes / RIDE_TIME_STEP_MINUTES) * RIDE_TIME_STEP_MINUTES);
}

function rideMinutes(entry: CatalogEntry): number | null {
  const stated = entry.estimatedTimeMinutes;
  if (typeof stated === "number" && Number.isFinite(stated) && stated > 0) return stated;
  return estimatedMinutes(entry.distanceKm);
}

/** The word the sky uses, in the NWS text's own terms. */
function skyWord(shortForecast: string): "snow" | "storms" | "rain" {
  const text = shortForecast.toLowerCase();
  if (/snow|sleet|flurr|ice/.test(text)) return "snow";
  if (/thunder|t-storm/.test(text)) return "storms";
  return "rain";
}

/** `2 PM`, from the phone's own clock. */
function hourText(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric" });
}

function isWet(period: WeatherForecastPeriod): boolean {
  if (period.precipChance !== undefined && period.precipChance >= WET_PRECIP_CHANCE) return true;
  return /rain|shower|drizzle|thunder|t-storm|snow|sleet|flurr/i.test(period.shortForecast);
}

/**
 * One day of a pick's weather, built only from the forecast that answered.
 *
 * A dry day names its high: "Sat: dry, 54°". A wet day names the first hour
 * worth changing plans for: "Sun: rain after 2 PM". No answer is said plainly
 * rather than filled in with a pleasant guess.
 */
export function weekendWeatherPhrase(label: string, periods: readonly WeatherForecastPeriod[]): string {
  if (periods.length === 0) return "Forecast not available";
  const ordered = [...periods].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const wet = ordered.find(isWet);
  if (wet !== undefined) {
    const time = hourText(wet.startTime);
    if (time === "") return `${label}: ${skyWord(wet.shortForecast)}`;
    const hour = new Date(Date.parse(wet.startTime)).getHours();
    return hour < 12
      ? `${label}: ${skyWord(wet.shortForecast)} from ${time}`
      : `${label}: ${skyWord(wet.shortForecast)} after ${time}`;
  }
  const temperatures = ordered.flatMap((period) =>
    period.temperatureF === undefined || !Number.isFinite(period.temperatureF) ? [] : [period.temperatureF]);
  if (temperatures.length === 0) return `${label}: dry`;
  return `${label}: dry, ${Math.round(Math.max(...temperatures))}°`;
}

/** The dampest hour named in a candidate's forecast, or `Infinity` without one. */
function wetness(forecasts: WeekendPicksInput["forecasts"], entryId: string): number {
  const days = forecasts?.get(entryId);
  if (days === undefined) return Number.POSITIVE_INFINITY;
  const chances = days.flatMap((day) => day.periods.flatMap((period) =>
    period.precipChance === undefined || !Number.isFinite(period.precipChance) ? [] : [period.precipChance]));
  return chances.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...chances);
}

/** The card's one characterising fact: gravel first, then curves. */
function characterOf(candidate: Candidate): string | null {
  if (candidate.unpavedMiles > 0) {
    const word = candidate.unpavedWord ?? "unpaved";
    return `${milesNumber(candidate.unpavedMiles)} mi ${word}`;
  }
  return candidate.entry.curvatureSummary === undefined || candidate.entry.curvatureSummary === ""
    ? null
    : candidate.entry.curvatureSummary;
}

function candidateOf(entry: CatalogEntry, position: readonly [number, number], forecasts: WeekendPicksInput["forecasts"]): Candidate | null {
  const distanceKm = distanceToStartKm(position, entry);
  if (!Number.isFinite(distanceKm) || distanceKm > WEEKEND_START_KM) return null;
  const timeMinutes = rideMinutes(entry);
  if (timeMinutes === null || timeMinutes < WEEKEND_MIN_RIDE_MINUTES || timeMinutes > WEEKEND_MAX_RIDE_MINUTES) return null;
  const surface = readSurfaceSummary(entry.surfaceSummary);
  return {
    entry,
    distanceKm,
    timeMinutes,
    unpavedMiles: surface?.unpavedMiles ?? 0,
    unpavedWord: surface?.unpavedWord ?? null,
    wetness: wetness(forecasts, entry.id),
  };
}

/** Nearest first, then the drier day, then the id: a stable order every visit. */
function byNearnessThenDryness(a: Candidate, b: Candidate): number {
  return a.distanceKm - b.distanceKm
    || (a.wetness === b.wetness ? 0 : a.wetness < b.wetness ? -1 : 1)
    || a.entry.id.localeCompare(b.entry.id);
}

/**
 * The mostly unpaved ride for the mix. A bike set up for gravel takes the
 * nearest one. A bike that avoids gravel still needs the honest unpaved option,
 * so it takes the one asking least of the bike rather than the nearest.
 */
function nearestMostlyUnpaved(pool: readonly Candidate[], bike: WeekendPickBike | null | undefined): Candidate | undefined {
  const unpaved = pool.filter((candidate) => isMostlyUnpaved(candidate.entry));
  if (unpaved.length === 0) return undefined;
  if (bike === null || bike === undefined || bike.maintainedGravel === "allow") return unpaved[0];
  return [...unpaved].sort((a, b) => a.unpavedMiles - b.unpavedMiles || byNearnessThenDryness(a, b))[0];
}

function toPick(candidate: Candidate, dayLabels: readonly string[], forecasts: WeekendPicksInput["forecasts"]): WeekendPick {
  const days = forecasts?.get(candidate.entry.id);
  return {
    entry: candidate.entry,
    distanceKm: candidate.distanceKm,
    timeMinutes: candidate.timeMinutes,
    unpavedMiles: candidate.unpavedMiles,
    character: characterOf(candidate),
    weather: dayLabels.map((label, index) =>
      weekendWeatherPhrase(label, days?.[index]?.periods ?? [])),
  };
}

/**
 * Up to three rides for the weekend, or `null` when the rider has no position.
 *
 * Selection is by nearness first. When the catalog offers them, the nearest
 * mostly unpaved ride the bike can do and the nearest twisty ride join the
 * nearest ride, so the three cards are three different afternoons. Forecasts
 * never remove a ride; they only break a nearness tie and supply the phrase.
 */
export function weekendPicks(input: WeekendPicksInput): readonly WeekendPick[] | null {
  if (input.position === undefined) return null;
  const position = input.position;
  const hidden = input.hiddenIds ?? new Set<string>();
  const pool = input.entries
    .filter((entry) => entry.source === "catalog" && !hidden.has(entry.id))
    .flatMap((entry) => {
      const candidate = candidateOf(entry, position, input.forecasts);
      return candidate === null ? [] : [candidate];
    })
    .sort((a, b) => a.distanceKm - b.distanceKm || a.entry.id.localeCompare(b.entry.id));

  const picks: Candidate[] = [];
  const take = (candidate: Candidate | undefined): void => {
    if (candidate === undefined || picks.length >= WEEKEND_PICK_COUNT) return;
    if (picks.some((pick) => pick.entry.id === candidate.entry.id)) return;
    picks.push(candidate);
  };

  take(pool[0]);
  if (!picks.some((candidate) => isMostlyUnpaved(candidate.entry))) {
    take(nearestMostlyUnpaved(pool, input.bike));
  }
  if (!picks.some((candidate) => isTwisty(candidate.entry))) {
    take(pool.find((candidate) => isTwisty(candidate.entry)));
  }
  for (const candidate of pool) {
    if (picks.length >= WEEKEND_PICK_COUNT) break;
    take(candidate);
  }

  return picks
    .sort(byNearnessThenDryness)
    .map((candidate) => toPick(candidate, input.dayLabels, input.forecasts));
}

