/**
 * "Near you this weekend" (R3-8).
 *
 * Fixed catalog slice, fixed position, fixed forecasts: the order must be the
 * same every visit, the mix must hold when the catalog can offer it, a start
 * over 60 mi must never appear, and a day nobody forecast must say so.
 */

import { describe, expect, it } from "vitest";

import {
  weekendDayPlan,
  weekendPicks,
  weekendStripTitle,
  weekendWeatherPhrase,
  type WeekendPickForecastDay,
} from "@/application/explore/weekend-picks";
import type { CatalogEntry } from "@/application/explore/catalog";

import type { WeatherForecastPeriod } from "@/application/preparation/providers";

/** Equator, so a degree of latitude is 111.32 km in every direction. */
const AT: readonly [number, number] = [0, 0];

function entry(overrides: Partial<CatalogEntry> & Pick<CatalogEntry, "id" | "name">): CatalogEntry {
  return {
    source: "catalog",
    region: "Test region",
    summary: "A test ride.",
    distanceKm: 120,
    bounds: null,
    geometry: [{ lon: 0, lat: 0.01 }, { lon: 0.05, lat: 0.02 }],
    provenance: "Test catalog",
    estimatedTimeMinutes: 180,
    ...overrides,
  };
}

function at(lat: number): readonly { lon: number; lat: number }[] {
  return [{ lon: 0, lat }, { lon: 0.05, lat: lat + 0.01 }];
}

const NEAR = entry({
  id: "near",
  name: "Near Paved Loop",
  distanceKm: 60,
  geometry: at(0.01),
  surfaceSummary: "Paved",
  curvatureSummary: "Few curves",
});

const UNPAVED = entry({
  id: "unpaved",
  name: "Unpaved Forest Loop",
  distanceKm: 100,
  geometry: at(0.03),
  surfaceSummary: "Mostly unpaved · 42 mi gravel",
  curvatureSummary: "Few curves",
});

const PLAIN_BUT_CLOSER = entry({
  id: "plain-closer",
  name: "Closer Paved Loop",
  distanceKm: 60,
  geometry: at(0.04),
  surfaceSummary: "Paved",
  curvatureSummary: "Few curves",
});

const TWISTY = entry({
  id: "twisty",
  name: "Twisty Ridge Run",
  distanceKm: 90,
  geometry: at(0.05),
  surfaceSummary: "Mostly paved · 3 mi gravel",
  curvatureSummary: "17 mi of curves",
});

/** 1.0° of latitude is about 69 mi: over the 60 mi start limit. */
const TOO_FAR = entry({
  id: "too-far",
  name: "Far Gravel Loop",
  distanceKm: 100,
  geometry: at(1),
  surfaceSummary: "Mostly unpaved · 50 mi gravel",
  curvatureSummary: "12 mi of curves",
});

const TOO_SHORT = entry({
  id: "too-short",
  name: "Coffee Run",
  distanceKm: 20,
  geometry: at(0.005),
  estimatedTimeMinutes: 60,
});

const TOO_LONG = entry({
  id: "too-long",
  name: "All Day Tour",
  distanceKm: 400,
  geometry: at(0.006),
  estimatedTimeMinutes: 420,
});

function periods(overrides: Partial<WeatherForecastPeriod> & Pick<WeatherForecastPeriod, "startTime">): WeatherForecastPeriod {
  return {
    name: "Test period",
    endTime: new Date(Date.parse(overrides.startTime) + 3_600_000).toISOString(),
    shortForecast: "Sunny",
    precipChance: 0,
    ...overrides,
  };
}

/** Local hours, so the phrase reads the same in any machine time zone. */
function localIso(year: number, month: number, day: number, hour: number): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

const SAT_DRY: WeatherForecastPeriod[] = [
  periods({ startTime: localIso(2026, 11, 14, 12), temperatureF: 52, precipChance: 10 }),
  periods({ startTime: localIso(2026, 11, 14, 15), temperatureF: 54, precipChance: 20 }),
];

const SUN_WET: WeatherForecastPeriod[] = [
  periods({ startTime: localIso(2026, 11, 15, 14), temperatureF: 49, precipChance: 70, shortForecast: "Rain" }),
];

const FORECASTS = new Map<string, readonly WeekendPickForecastDay[]>([
  ["near", [{ label: "Sat", periods: SAT_DRY }, { label: "Sun", periods: SUN_WET }]],
  ["plain-closer", [{ label: "Sat", periods: SAT_DRY }, { label: "Sun", periods: SUN_WET }]],
  ["twisty", [{ label: "Sat", periods: SAT_DRY }, { label: "Sun", periods: SUN_WET }]],
]);

const ENTRIES: readonly CatalogEntry[] = [NEAR, UNPAVED, PLAIN_BUT_CLOSER, TWISTY, TOO_FAR, TOO_SHORT, TOO_LONG];

const INPUT = {
  entries: ENTRIES,
  position: AT,
  dayLabels: ["Sat", "Sun"],
  forecasts: FORECASTS,
  hiddenIds: new Set<string>(),
} as const;

describe("weekend picks", () => {
  it("answers null without a position, so no strip appears", () => {
    expect(weekendPicks({ entries: ENTRIES, dayLabels: ["Sat", "Sun"], forecasts: FORECASTS })).toBeNull();
  });

  it("keeps one stable order on every visit", () => {
    const first = weekendPicks(INPUT);
    const second = weekendPicks(INPUT);
    expect(first).not.toBeNull();
    expect(first?.map((pick) => pick.entry.id)).toEqual(second?.map((pick) => pick.entry.id));
  });

  it("holds at least one mostly unpaved ride and one twisty ride when the catalog has them", () => {
    const picks = weekendPicks(INPUT) ?? [];
    expect(picks.map((pick) => pick.entry.id)).toEqual(["near", "unpaved", "twisty"]);
    // The closer paved ride is left out so the strip is not three versions of
    // the same afternoon.
    expect(picks.some((pick) => pick.entry.id === "plain-closer")).toBe(false);
    expect(picks.some((pick) => pick.unpavedMiles > 0)).toBe(true);
    expect(picks.some((pick) => pick.entry.id === "twisty")).toBe(true);
  });

  it("never picks a start over 60 mi away, or a ride outside 1.5 to 6 hours", () => {
    const picks = weekendPicks(INPUT) ?? [];
    for (const pick of picks) {
      expect(pick.distanceKm).toBeLessThanOrEqual(60 * 1.609344);
      expect(pick.timeMinutes).toBeGreaterThanOrEqual(90);
      expect(pick.timeMinutes).toBeLessThanOrEqual(360);
    }
    expect(picks.some((pick) => pick.entry.id === "too-far")).toBe(false);
    expect(picks.some((pick) => pick.entry.id === "too-short")).toBe(false);
    expect(picks.some((pick) => pick.entry.id === "too-long")).toBe(false);
  });

  it("never picks a ride the rider hid", () => {
    const picks = weekendPicks({ ...INPUT, hiddenIds: new Set(["unpaved"]) }) ?? [];
    expect(picks.some((pick) => pick.entry.id === "unpaved")).toBe(false);
    expect(picks).toHaveLength(3);
  });

  it("says a day was not forecast instead of calling it dry", () => {
    const picks = weekendPicks(INPUT) ?? [];
    const unpaved = picks.find((pick) => pick.entry.id === "unpaved");
    expect(unpaved?.weather).toEqual(["Forecast not available", "Forecast not available"]);
    const near = picks.find((pick) => pick.entry.id === "near");
    expect(near?.weather).toEqual(["Sat: dry, 54°", "Sun: rain after 2 PM"]);
  });

  it("breaks a nearness tie with the drier day", () => {
    const wet = entry({ id: "a-wet", name: "Wet Tie", geometry: at(0.02), estimatedTimeMinutes: 180 });
    const dry = entry({ id: "z-dry", name: "Dry Tie", geometry: at(0.02), estimatedTimeMinutes: 180 });
    const forecasts = new Map<string, readonly WeekendPickForecastDay[]>([
      ["a-wet", [{ label: "Sat", periods: [periods({ startTime: localIso(2026, 11, 14, 12), precipChance: 80, shortForecast: "Rain" })] }]],
      ["z-dry", [{ label: "Sat", periods: SAT_DRY }]],
    ]);
    const picks = weekendPicks({
      entries: [wet, dry],
      position: AT,
      dayLabels: ["Sat"],
      forecasts,
    }) ?? [];
    // The ids sort wet first; the forecast is what puts the dry ride first.
    expect(picks.map((pick) => pick.entry.id)).toEqual(["z-dry", "a-wet"]);
  });

  it("marks a time the catalog never stated as an estimate", () => {
    const noTime = entry({ id: "no-time", name: "No Stated Time", geometry: at(0.01), estimatedTimeMinutes: undefined });
    const picks = weekendPicks({ entries: [noTime], position: AT, dayLabels: ["Sat"] }) ?? [];
    expect(picks[0]).toMatchObject({ timeIsEstimate: true, timeMinutes: 165 });
  });

  it("leaves personal and imported rides out of the catalog strip", () => {
    const personal = { ...NEAR, id: "mine", name: "My saved ride", source: "personal" as const };
    const picks = weekendPicks({
      entries: [personal],
      position: AT,
      dayLabels: ["Sat"],
    }) ?? [];
    expect(picks).toEqual([]);
  });
});

describe("weekend weather phrases", () => {
  it("names the high on a dry day and the first wet hour on a wet one", () => {
    expect(weekendWeatherPhrase("Sat", SAT_DRY)).toBe("Sat: dry, 54°");
    expect(weekendWeatherPhrase("Sun", SUN_WET)).toBe("Sun: rain after 2 PM");
    expect(weekendWeatherPhrase("Sun", [periods({ startTime: localIso(2026, 11, 15, 11), precipChance: 60, shortForecast: "Showers" })])).toBe("Sun: rain from 11 AM");
  });

  it("never says dry without a forecast", () => {
    expect(weekendWeatherPhrase("Sat", [])).toBe("Forecast not available");
  });
});

describe("the strip's own clock", () => {
  it("promises the weekend early in the week and names what is left at the end", () => {
    expect(weekendStripTitle(new Date(2026, 10, 9, 12))).toBe("Near you this weekend"); // Monday
    expect(weekendStripTitle(new Date(2026, 10, 13, 12))).toBe("Near you Saturday and Sunday"); // Friday
    expect(weekendStripTitle(new Date(2026, 10, 14, 12))).toBe("Near you today and tomorrow"); // Saturday
    expect(weekendStripTitle(new Date(2026, 10, 15, 12))).toBe("Near you today"); // Sunday
  });

  it("plans Saturday and Sunday, and only Sunday on Sunday", () => {
    const monday = weekendDayPlan(new Date(2026, 10, 9, 12));
    expect(monday.map((day) => day.label)).toEqual(["Sat", "Sun"]);
    expect(monday[0]?.dayKey).toBe("2026-11-14");
    expect(monday[1]?.dayKey).toBe("2026-11-15");
    const sunday = weekendDayPlan(new Date(2026, 10, 15, 12));
    expect(sunday).toEqual([{ label: "Sun", dayKey: "2026-11-15" }]);
  });
});
