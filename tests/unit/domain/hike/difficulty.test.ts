import { describe, expect, it } from "vitest";

import {
  buildSacMix,
  buildSurfaceMix,
  DIFFICULTY_LIMITS,
  difficultyFromNumbers,
  normalizeSacScale,
  sacGrade,
} from "@/domain/hike";
import type { HikeSacBand, HikeSacMix, HikeStats, HikeSurfaceMix } from "@/domain/hike";
import type { SurfaceClass } from "@/domain/roads/surface";

interface StatsOptions {
  readonly lengthMeters?: number;
  readonly gainMeters?: number | null;
  readonly lossMeters?: number | null;
  /** Percent; null means no segment was steep enough to measure. */
  readonly maxGradePercent?: number | null;
  readonly measuredLengthShare?: number;
}

function makeStats(options: StatsOptions = {}): HikeStats {
  const lengthMeters = options.lengthMeters ?? 3000;
  const gainMeters = options.gainMeters === undefined ? 100 : options.gainMeters;
  const lossMeters = options.lossMeters === undefined ? gainMeters : options.lossMeters;
  const maxGradePercent = options.maxGradePercent === undefined ? 8 : options.maxGradePercent;
  const measuredLengthShare = options.measuredLengthShare ?? 1;
  return {
    lengthMeters,
    gainMeters,
    lossMeters,
    maxGrade:
      maxGradePercent === null
        ? null
        : {
            percent: maxGradePercent,
            direction: maxGradePercent >= 0 ? "up" : "down",
            runMeters: 200,
            atMeters: 100,
          },
    highestPoint: null,
    lowestPoint: null,
    elevation: {
      knownSamples: measuredLengthShare > 0 ? 10 : 0,
      totalSamples: 10,
      measuredSegments: measuredLengthShare > 0 ? 9 : 0,
      unmeasuredSegments: measuredLengthShare > 0 ? 0 : 9,
      measuredLengthMeters: lengthMeters * measuredLengthShare,
      measuredLengthShare,
    },
  };
}

function surface(...entries: readonly (readonly [SurfaceClass, number])[]): HikeSurfaceMix {
  return buildSurfaceMix(entries.map(([band, meters]) => ({ band, meters })));
}

function sac(...entries: readonly (readonly [HikeSacBand, number])[]): HikeSacMix {
  return buildSacMix(entries.map(([band, meters]) => ({ band, meters })));
}

const HIKING = sac(["hiking", 3000]);
const GRAVEL = surface(["gravel", 3000]);

describe("difficultyFromNumbers", () => {
  it("explains an easy hike with the numbers behind it", () => {
    const difficulty = difficultyFromNumbers(makeStats(), HIKING, GRAVEL);

    expect(difficulty.rating).toBe("easy");
    expect(difficulty.unknownParts).toEqual([]);
    expect(difficulty.parts).toHaveLength(5);
    expect(difficulty.explanation).toBe(
      "Easy: 3.0 km, 100 m gain, worst grade 8% up, surface mapped for 100% of the line (mostly gravel), SAC T1 hiking on 100% of the line.",
    );
  });

  it("never says easy when the surface was never mapped", () => {
    const difficulty = difficultyFromNumbers(makeStats(), HIKING, null);

    expect(difficulty.rating).toBe("unknown");
    expect(difficulty.unknownParts).toEqual(["surface"]);
    expect(difficulty.explanation).toBe("Difficulty unknown: the surface was not mapped.");
  });

  it("treats an omitted surface argument as unknown, not as easy", () => {
    const difficulty = difficultyFromNumbers(makeStats(), HIKING);

    expect(difficulty.rating).toBe("unknown");
    expect(difficulty.unknownParts).toEqual(["surface"]);
  });

  it("never says easy when the SAC scale is mostly unknown", () => {
    const difficulty = difficultyFromNumbers(
      makeStats(),
      sac(["hiking", 1000], ["unknown", 2000]),
      GRAVEL,
    );

    expect(difficulty.rating).toBe("unknown");
    expect(difficulty.unknownParts).toEqual(["sac-scale"]);
    expect(difficulty.explanation).toContain("the SAC scale is unknown for 67% of the line");
  });

  it("accepts a surface that is mostly, but not fully, mapped", () => {
    const atThreshold = difficultyFromNumbers(
      makeStats(),
      HIKING,
      surface(["gravel", 1800], ["unknown", 1200]),
    );
    expect(atThreshold.rating).toBe("easy");
    expect(atThreshold.unknownParts).toEqual([]);

    const belowThreshold = difficultyFromNumbers(
      makeStats(),
      HIKING,
      surface(["gravel", 1200], ["unknown", 1800]),
    );
    expect(belowThreshold.rating).toBe("unknown");
    expect(belowThreshold.unknownParts).toEqual(["surface"]);
    expect(belowThreshold.explanation).toContain("the surface is unknown for 60% of the line");
  });

  it("keeps a moderate rating while disclosing an unknown part", () => {
    const difficulty = difficultyFromNumbers(
      makeStats({
        lengthMeters: 10_000,
        gainMeters: 400,
        maxGradePercent: 18,
      }),
      sac(["mountain-hiking", 3000]),
      null,
    );

    expect(difficulty.rating).toBe("moderate");
    expect(difficulty.unknownParts).toEqual(["surface"]);
    expect(difficulty.explanation).toContain("Moderate:");
    expect(difficulty.explanation).toContain("Still unknown: the surface was not mapped.");
  });

  it("rates a long, steep, high-climb trail hard", () => {
    const difficulty = difficultyFromNumbers(
      makeStats({
        lengthMeters: 18_000,
        gainMeters: 1000,
        maxGradePercent: 35,
      }),
      sac(["demanding-mountain-hiking", 3000]),
      surface(["dirt", 3000]),
    );

    expect(difficulty.rating).toBe("hard");
    expect(difficulty.unknownParts).toEqual([]);
    // Dirt is the normal surface of a trail; difficulty comes from the numbers.
    expect(difficulty.explanation).toContain("mostly dirt");
    expect(difficulty.explanation).toContain("SAC T3 demanding mountain hiking");
  });

  it("does not let an unknown elevation lower a hard rating", () => {
    const difficulty = difficultyFromNumbers(
      makeStats({
        lengthMeters: 18_000,
        gainMeters: null,
        maxGradePercent: null,
        measuredLengthShare: 0.4,
      }),
      sac(),
      null,
    );

    expect(difficulty.rating).toBe("hard");
    expect(difficulty.unknownParts).toEqual(["gain", "max-grade", "surface", "sac-scale"]);
    expect(difficulty.explanation).toContain("Hard:");
    expect(difficulty.explanation).toContain("Still unknown:");
  });

  it("is unknown when the elevation profile is missing and nothing else is hard", () => {
    const difficulty = difficultyFromNumbers(
      makeStats({ gainMeters: null, maxGradePercent: null, measuredLengthShare: 0 }),
      HIKING,
      GRAVEL,
    );

    expect(difficulty.rating).toBe("unknown");
    expect(difficulty.unknownParts).toEqual(["gain", "max-grade"]);
    expect(difficulty.explanation).toContain(
      "elevation gain is unknown (a DEM profile covers 0% of the line)",
    );
  });

  it("uses the gain and grade thresholds at their boundaries", () => {
    const options = { lengthMeters: 3000, maxGradePercent: 8 };

    expect(
      difficultyFromNumbers(makeStats({ ...options, gainMeters: 299 }), HIKING, GRAVEL).rating,
    ).toBe("easy");
    expect(
      difficultyFromNumbers(makeStats({ ...options, gainMeters: 300 }), HIKING, GRAVEL).rating,
    ).toBe("moderate");
    expect(
      difficultyFromNumbers(
        makeStats({ lengthMeters: 3000, gainMeters: 100, maxGradePercent: 14.9 }),
        HIKING,
        GRAVEL,
      ).rating,
    ).toBe("easy");
    expect(
      difficultyFromNumbers(
        makeStats({ lengthMeters: 3000, gainMeters: 100, maxGradePercent: 15 }),
        HIKING,
        GRAVEL,
      ).rating,
    ).toBe("moderate");
  });

  it("lets the hardest mapped SAC step decide, not the average", () => {
    const difficulty = difficultyFromNumbers(
      makeStats(),
      sac(["hiking", 3600], ["demanding-mountain-hiking", 400]),
      GRAVEL,
    );

    expect(difficulty.rating).toBe("hard");
    expect(difficulty.explanation).toContain(
      "SAC T3 demanding mountain hiking on 10% of the line",
    );
  });

  it("is unknown when no SAC or surface data exists at all", () => {
    const difficulty = difficultyFromNumbers(makeStats(), sac(), surface());

    expect(difficulty.rating).toBe("unknown");
    expect(difficulty.unknownParts).toEqual(["surface", "sac-scale"]);
  });

  it("reports a zero-length line as unknown", () => {
    const difficulty = difficultyFromNumbers(
      makeStats({ lengthMeters: 0, gainMeters: null, maxGradePercent: null, measuredLengthShare: 0 }),
      sac(),
      surface(),
    );

    expect(difficulty.rating).toBe("unknown");
    expect(difficulty.unknownParts).toContain("length");
    expect(difficulty.explanation).toContain("the line has no measurable distance");
  });

  it("quotes the same known-share threshold the module exports", () => {
    expect(DIFFICULTY_LIMITS.knownShare).toBe(0.6);
  });
});

describe("SAC helpers", () => {
  it("normalises OSM labels, T-grades and unknown labels", () => {
    expect(normalizeSacScale("hiking")).toBe("hiking");
    expect(normalizeSacScale("mountain_hiking")).toBe("mountain-hiking");
    expect(normalizeSacScale("  ALPINE_HIKING ")).toBe("alpine-hiking");
    expect(normalizeSacScale("T1")).toBe("hiking");
    expect(normalizeSacScale("t3")).toBe("demanding-mountain-hiking");
    expect(normalizeSacScale("T6")).toBe("difficult-alpine-hiking");
    expect(normalizeSacScale("other")).toBe("unknown");
    expect(normalizeSacScale(null)).toBe("unknown");
    expect(normalizeSacScale(undefined)).toBe("unknown");
  });

  it("maps bands to T-grades and leaves unknown ungraded", () => {
    expect(sacGrade("hiking")).toBe(1);
    expect(sacGrade("mountain-hiking")).toBe(2);
    expect(sacGrade("demanding-alpine-hiking")).toBe(5);
    expect(sacGrade("difficult-alpine-hiking")).toBe(6);
    expect(sacGrade("unknown")).toBeNull();
  });

  it("sums duplicate bands", () => {
    const mix = sac(["hiking", 100], ["hiking", 50], ["unknown", 25]);
    expect(mix.hiking).toBe(150);
    expect(mix.unknown).toBe(25);
    expect(mix["alpine-hiking"]).toBe(0);
  });

  it("rejects negative and non-finite metres", () => {
    expect(() => sac(["hiking", -1])).toThrow(TypeError);
    expect(() => sac(["hiking", Number.NaN])).toThrow(TypeError);
    expect(() => surface(["gravel", -1])).toThrow(TypeError);
  });

  it("rejects a band outside the taxonomy", () => {
    expect(() => buildSacMix([{ band: "grade-7" as HikeSacBand, meters: 10 }])).toThrow(TypeError);
    expect(() =>
      buildSurfaceMix([{ band: "boulder" as SurfaceClass, meters: 10 }]),
    ).toThrow(TypeError);
  });
});
