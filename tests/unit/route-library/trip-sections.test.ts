import { describe, expect, it } from "vitest";

import {
  sectionsMiles,
  statedDays,
  tripLead,
  tripSections,
} from "@/application/route-library/trip-sections";

/** The six section names the real Arizona BDR record carries. */
const AZBDR = [
  "Section 1: Mexico border to Benson (128 mi)",
  "Section 2: Benson to Globe (127 mi)",
  "Section 3: Globe to Young (86 mi)",
  "Section 4: Young to Winona (135 mi)",
  "Section 5: Winona to Cameron (123 mi)",
  "Section 6: Cameron to Utah border (151 mi)",
];

describe("a trip's sections come from the source's own names", () => {
  it("reads every BDR section, its day and its stated miles", () => {
    const sections = tripSections(AZBDR);
    expect(sections).toHaveLength(6);
    expect(sections[0]).toEqual({ day: 1, label: "Mexico border to Benson", miles: 128 });
    expect(sections[5]).toEqual({ day: 6, label: "Cameron to Utah border", miles: 151 });
    expect(sectionsMiles(sections)).toBe(750);
  });

  it("keeps one named section but drops a single file name", () => {
    expect(tripSections(["Section 1: Mexico border to Benson (128 mi)"])).toHaveLength(1);
    // The California trip's only track name is the file's name, not a stage.
    expect(tripSections(["FortBraggt"])).toEqual([]);
    expect(tripSections(["ORVSLCRoute", "ORVSLCRoute"])).toEqual([]);
  });

  it("gives a section with no number the order the source stored it in", () => {
    const sections = tripSections(["Cameron to Utah border", "Utah border to Page"]);
    expect(sections.map((section) => section.day)).toEqual([1, 2]);
    expect(sections[0]?.label).toBe("Cameron to Utah border");
    expect(sections[0]?.miles).toBeNull();
  });

  it("converts a section stated in kilometres and leaves other brackets alone", () => {
    expect(tripSections(["Stage 1: Globe to Young (128 km)", "Stage 2: Young to Winona (strict)"])).toEqual([
      { day: 1, label: "Globe to Young", miles: 80 },
      { day: 2, label: "Young to Winona (strict)", miles: null },
    ]);
  });

  it("adds up only the distances the source stated", () => {
    const sections = tripSections(["Day 1: Start to Benson (120 mi)", "Day 2: Benson to Globe"]);
    expect(sectionsMiles(sections)).toBe(120);
    expect(sectionsMiles(tripSections(["no", "numbers"]))).toBeNull();
    expect(tripSections(null)).toEqual([]);
    expect(tripSections([])).toEqual([]);
  });
});

describe("a trip's day count", () => {
  it("repeats only the day count the source wrote", () => {
    expect(statedDays("The Arizona BDR runs 750 miles from the border in 4-6 days.")).toBe("4 to 6 days");
    expect(statedDays("Allow 5 days for this one.")).toBe("5 days");
    expect(statedDays("A 750-mile route.")).toBeNull();
    expect(statedDays(undefined)).toBeNull();
    // A season, a speed and a rating are not a day count.
    expect(statedDays("Best time: May, June. About 30 mph. Rider rating 4/5.")).toBeNull();
  });

  it("says the source's days first, then the sections as days", () => {
    const sections = tripSections(AZBDR);
    expect(tripLead(sections, statedDays("runs it in 4-6 days"))).toBe(
      "The source says 4 to 6 days. 6 sections, one a day.",
    );
    expect(tripLead(sections, null)).toBe("6 sections, one a day.");
    expect(tripLead([], statedDays("5 days"))).toBe("The source says 5 days.");
    expect(tripLead([], null)).toBeNull();
  });
});
