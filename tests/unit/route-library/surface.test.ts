import { describe, expect, it } from "vitest";

import { hasSurfaceRow, quotedFact, surfaceClaim, surfaceCode, surfaceFact } from "@/application/route-library/surface-claim";
import { SURFACE_PHRASES } from "@/application/route-library/surface-phrases";

import phrases from "./surface-phrases.snapshot.json";

describe("surface phrases", () => {
  it("has a table row for every distinct phrase in the real library (snapshot of 2026-11-13)", () => {
    expect(phrases.length).toBe(278);
    const missing = phrases.filter((phrase) => !hasSurfaceRow(phrase));
    expect(missing).toEqual([]);
  });

  it("holds only paved, unpaved, mixed or null, and no row without a phrase behind it", () => {
    for (const claim of Object.values(SURFACE_PHRASES)) expect([null, "paved", "unpaved", "mixed"]).toContain(claim);
    const known = new Set(phrases.map((phrase) => phrase.trim().replace(/\s+/g, " ").toLowerCase()));
    expect(Object.keys(SURFACE_PHRASES).filter((key) => !known.has(key))).toEqual([]);
  });

  it("maps clear wording and leaves everything else unknown", () => {
    expect(surfaceClaim("paved")).toBe("paved");
    expect(surfaceClaim("Paved state highway")).toBe("paved");
    expect(surfaceClaim("dirt/gravel")).toBe("unpaved");
    expect(surfaceClaim("mixed paved and dirt")).toBe("mixed");
    expect(surfaceClaim("unknown")).toBeNull();
    expect(surfaceClaim("single-track: Many")).toBeNull();
    expect(surfaceClaim("smooth as butter")).toBeNull();
    expect(surfaceClaim("")).toBeNull();
    expect(surfaceClaim(undefined)).toBeNull();
    expect(surfaceClaim("constructor")).toBeNull();
  });

  it("never turns a mostly-paved claim into plain paved", () => {
    expect(surfaceClaim("mostly pavement (SCAR User Guide)")).toBe("mixed");
    expect(surfaceClaim("mostly paved, some gravel/dirt")).toBe("mixed");
  });

  it("keeps null as null in the index code", () => {
    expect(surfaceCode(null)).toBeNull();
    expect(surfaceCode("paved")).toBe("p");
    expect(surfaceCode("unpaved")).toBe("u");
    expect(surfaceCode("mixed")).toBe("m");
  });
});

describe("quoted facts", () => {
  it("never makes a value out of unknown, none stated or empty", () => {
    for (const text of ["unknown", "Unknown", "none stated", "", "  ", undefined]) {
      expect(quotedFact(text, "Some site")).toEqual({ value: null, quote: null, source: null });
    }
    expect(surfaceFact("unknown", "Some site")).toEqual({ value: null, quote: null, source: null });
  });

  it("keeps a real claim with its words and its source", () => {
    expect(quotedFact("late May through early October", "Route page")).toEqual({
      value: "late May through early October",
      quote: "late May through early October",
      source: "Route page",
    });
    expect(surfaceFact("backroads per the thread", "Thread")).toEqual({ value: null, quote: "backroads per the thread", source: "Thread" });
  });
});
