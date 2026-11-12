/**
 * The three honest lines under a route (N3, taste call 5).
 *
 * The load-bearing test is the matrix at the bottom: every combination of a
 * missing, unknown, stale or partial input must never read as `good`. The named
 * routes pin the wording the rider sees, and six routes × three bikes prove the
 * shape — always surface, bike, checked.
 */

import { describe, expect, it } from "vitest";

import { rideTruth, type RideTruthBike, type RideTruthLine } from "@/application/planner/ride-truth";
import type { EngineSurfaceMix } from "@/application/roads/engine-road-evidence";
import { unavailableEvidence, type EvidenceSource, type EvidenceStatus, type EvidenceValue } from "@/domain/evidence/types";
import type { RouteEvidence } from "@/domain/route/types";

const MI = 1609.344;
const TWENTY_MI = 20 * MI;
/** 9:14 AM in the machine's own zone, so the expected clock text is fixed. */
const CHECKED_AT = new Date(2026, 10, 11, 9, 14).toISOString();

const TOURING: RideTruthBike = {
  name: "My bike",
  maintainedGravel: "allow",
  roughTracks: "avoid",
};
const STREET: RideTruthBike = {
  name: "Street",
  maintainedGravel: "avoid",
  roughTracks: "avoid",
};
const DUAL_SPORT: RideTruthBike = {
  name: "Dual-sport",
  maintainedGravel: "allow",
  roughTracks: "allow",
};

const BIKES: readonly { readonly bike: RideTruthBike; readonly name: string }[] = [
  { bike: TOURING, name: "touring" },
  { bike: STREET, name: "street" },
  { bike: DUAL_SPORT, name: "dual-sport" },
];

function source(id: string, observedAt?: string): EvidenceSource {
  return {
    id,
    label: id,
    category: "other",
    ...(observedAt === undefined ? {} : { observedAt }),
  };
}

function evidence<T>(
  value: T,
  status: EvidenceStatus = "estimated",
  provenance: readonly EvidenceSource[] = [],
): EvidenceValue<T> {
  return { value, status, confidence: null, provenance };
}

/** The engine's own mix, from miles of each surface. */
function surfaceMix(miles: {
  readonly paved?: number;
  readonly gravel?: number;
  readonly dirt?: number;
  readonly unknown?: number;
}): EngineSurfaceMix {
  const pavedMeters = (miles.paved ?? 0) * MI;
  const gravelMeters = (miles.gravel ?? 0) * MI;
  const dirtMeters = (miles.dirt ?? 0) * MI;
  const unknownMeters = (miles.unknown ?? 0) * MI;
  const total = pavedMeters + gravelMeters + dirtMeters + unknownMeters;
  return {
    surface: "paved",
    pavedMeters,
    inferredPavedMeters: 0,
    gravelMeters,
    dirtMeters,
    unknownMeters,
    unit: 1,
    unpavedShare: total > 0 ? (gravelMeters + dirtMeters) / total : 0,
  };
}

function bikeFit(overrides: {
  readonly roughTrackMeters?: number;
  readonly unmeasuredMeters?: number;
  readonly worst?: { readonly fromMeters: number; readonly toMeters: number };
} = {}): EvidenceValue<unknown> {
  return evidence({
    roughTrackMeters: 0,
    unmeasuredMeters: 0,
    ...overrides,
  });
}

function clearClosures(count = 3, at = CHECKED_AT): EvidenceValue<number> {
  return {
    value: 0,
    status: "known",
    confidence: null,
    provenance: Array.from({ length: count }, (_, index) => source(`source-${index}`, at)),
  };
}

const UNCONFIRMED_ACCESS: EvidenceValue<number> = {
  value: null,
  status: "unknown",
  confidence: null,
  reason: "A motor-vehicle designation on this route does not establish motorcycle access for this date.",
  provenance: [],
};

interface RouteFixture {
  readonly name: string;
  readonly distanceMeters: number;
  readonly evidence: RouteEvidence;
  readonly warnings?: readonly { readonly code: string }[];
}

/** Six routes a plan can really answer, one for each shape the lines must read. */
const ROUTES: readonly RouteFixture[] = [
  {
    name: "all paved, closures checked",
    distanceMeters: TWENTY_MI,
    evidence: {
      surfaceMix: evidence(surfaceMix({ paved: 20 })),
      bikeFit: bikeFit(),
      closures: clearClosures(3),
    },
  },
  {
    name: "a gravel run with a clean closure check",
    distanceMeters: TWENTY_MI,
    evidence: {
      surfaceMix: evidence(surfaceMix({ paved: 8, gravel: 12 })),
      bikeFit: bikeFit(),
      closures: clearClosures(1),
    },
  },
  {
    name: "rough forest road with one unconfirmed seasonal road",
    distanceMeters: TWENTY_MI,
    evidence: {
      surfaceMix: evidence(surfaceMix({ paved: 10, gravel: 9, dirt: 1 })),
      bikeFit: bikeFit({
        roughTrackMeters: 1287,
        worst: { fromMeters: 8000, toMeters: 9287 },
      }),
      closures: clearClosures(2),
      access: UNCONFIRMED_ACCESS,
    },
    warnings: [{ code: "seasonal-access-unverified" }, { code: "destination-final-approach" }],
  },
  {
    name: "two miles nobody tagged, and the road runs were dropped",
    distanceMeters: TWENTY_MI,
    evidence: {
      surfaceMix: evidence(surfaceMix({ paved: 17, gravel: 1, unknown: 2 })),
      closures: clearClosures(2),
    },
  },
  {
    name: "the closure check did not answer",
    distanceMeters: TWENTY_MI,
    evidence: {
      surfaceMix: evidence(surfaceMix({ paved: 20 })),
      bikeFit: bikeFit(),
      closures: evidence<number | null>(null, "unknown"),
    },
  },
  {
    name: "a closed road was reported",
    distanceMeters: TWENTY_MI,
    evidence: {
      surfaceMix: evidence(surfaceMix({ paved: 20 })),
      bikeFit: bikeFit(),
      closures: evidence(1, "known", [source("pa-511", CHECKED_AT)]),
    },
    warnings: [{ code: "road-closure-reported" }],
  },
];

function lineAt(lines: ReturnType<typeof rideTruth>, index: 0 | 1 | 2): RideTruthLine {
  return lines[index];
}

describe("three lines for six routes on three bikes", () => {
  for (const route of ROUTES) {
    for (const { bike, name } of BIKES) {
      it(`${route.name} · ${name}: reads surface, then bike, then checked`, () => {
        const lines = rideTruth({
          evidence: route.evidence,
          distanceMeters: route.distanceMeters,
          bike,
          ...(route.warnings === undefined ? {} : { warnings: route.warnings }),
        });
        expect(lines).toHaveLength(3);
        for (const line of lines) {
          expect(["good", "warn", "bad", "unknown"]).toContain(line.tone);
          expect(line.text.length).toBeGreaterThan(0);
        }
        // The surface line never names a bike or a check; the bike line never
        // claims a closure; the checked line never claims a surface.
        expect(lineAt(lines, 0).text).not.toContain("bike");
        expect(lineAt(lines, 1).text).not.toContain("closure");
        expect(lineAt(lines, 2).text).not.toMatch(/gravel|paved/i);
      });
    }
  }

  it("writes the rider's words for a known-good ride", () => {
    const [surface, bike, checked] = rideTruth({
      evidence: ROUTES[0]!.evidence,
      distanceMeters: TWENTY_MI,
      bike: TOURING,
    });
    expect(surface).toEqual({ tone: "good", text: "all paved" });
    expect(bike).toEqual({ tone: "good", text: "Fine for My bike: no gravel, no rough track" });
    expect(checked).toEqual({
      tone: "good",
      text: "Checked 9:14 AM: 3 sources, no closures on this route",
    });
  });

  it("names the gravel and counts a single source in the singular", () => {
    const [, bike, checked] = rideTruth({
      evidence: ROUTES[1]!.evidence,
      distanceMeters: TWENTY_MI,
      bike: TOURING,
    });
    expect(bike.text).toBe("Fine for My bike: 12 mi gravel, no rough track");
    expect(checked.text).toBe("Checked 9:14 AM: 1 source, no closures on this route");
  });

  it("names the roughest stretch and jumps to it for a dual-sport", () => {
    const [, bike] = rideTruth({
      evidence: ROUTES[2]!.evidence,
      distanceMeters: TWENTY_MI,
      bike: DUAL_SPORT,
    });
    expect(bike).toEqual({
      tone: "good",
      text: "Fine for Dual-sport: 10 mi dirt & gravel, 0.8 mi rough track",
      jumpTo: { fromMeters: 8000, toMeters: 9287 },
    });
  });

  it("is bad only when the bike's own limit is exceeded", () => {
    const [, roughBike] = rideTruth({
      evidence: ROUTES[2]!.evidence,
      distanceMeters: TWENTY_MI,
      bike: TOURING,
    });
    expect(roughBike).toEqual({
      tone: "bad",
      text: "Over the limit for My bike: 0.8 mi rough track",
      jumpTo: { fromMeters: 8000, toMeters: 9287 },
    });

    const [, gravelBike] = rideTruth({
      evidence: ROUTES[1]!.evidence,
      distanceMeters: TWENTY_MI,
      bike: STREET,
    });
    expect(gravelBike).toEqual({
      tone: "bad",
      text: "Over the limit for Street: 12 mi gravel",
    });
  });

  it("says a seasonal road is not confirmed instead of clear", () => {
    const [, , checked] = rideTruth({
      evidence: ROUTES[2]!.evidence,
      distanceMeters: TWENTY_MI,
      bike: TOURING,
      warnings: ROUTES[2]!.warnings,
    });
    expect(checked).toEqual({ tone: "warn", text: "1 seasonal road not confirmed" });
  });

  it("says not checked when the answer carried no road runs", () => {
    const [surface, bike, checked] = rideTruth({
      evidence: ROUTES[3]!.evidence,
      distanceMeters: TWENTY_MI,
      bike: TOURING,
    });
    expect(surface.tone).toBe("warn");
    expect(surface.text).toBe("5% gravel · 2 mi unknown");
    expect(bike).toEqual({
      tone: "unknown",
      text: "Not checked for your bike: 2 mi unknown surface",
    });
    expect(checked.tone).toBe("good");
  });

  it("says the closure check did not answer, never that the route is open", () => {
    const [, , checked] = rideTruth({
      evidence: ROUTES[4]!.evidence,
      distanceMeters: TWENTY_MI,
      bike: TOURING,
    });
    expect(checked).toEqual({ tone: "unknown", text: "Closure check did not answer" });
  });

  it("is bad when a closure was reported", () => {
    const [, , checked] = rideTruth({
      evidence: ROUTES[5]!.evidence,
      distanceMeters: TWENTY_MI,
      bike: TOURING,
      warnings: ROUTES[5]!.warnings,
    });
    expect(checked).toEqual({ tone: "bad", text: "A road closure was reported on this route" });
  });
});

describe("copy and edge cases", () => {
  it("treats no evidence at all as three unknowns", () => {
    const lines = rideTruth({ evidence: {}, distanceMeters: TWENTY_MI, bike: TOURING });
    expect(lines).toEqual([
      { tone: "unknown", text: "Surface unknown" },
      { tone: "unknown", text: "Not checked for your bike: rough-track check did not run" },
      { tone: "unknown", text: "Closure check did not answer" },
    ]);
  });

  it("never guesses a bike when none was selected", () => {
    const [, bike] = rideTruth({ evidence: ROUTES[0]!.evidence, distanceMeters: TWENTY_MI });
    expect(bike).toEqual({ tone: "unknown", text: "Not checked for your bike: no bike selected" });
  });

  it("cannot name miles without a ride length", () => {
    const [, bike] = rideTruth({ evidence: ROUTES[0]!.evidence, bike: TOURING });
    expect(bike).toEqual({ tone: "unknown", text: "Not checked for your bike: ride length not known" });
  });

  it("counts the part of the line the road runs did not describe", () => {
    const evidenceMap: RouteEvidence = {
      surfaceMix: evidence(surfaceMix({ paved: 20 })),
      bikeFit: bikeFit({ unmeasuredMeters: Math.round(0.4 * MI) }),
      closures: clearClosures(1),
    };
    const [, bike] = rideTruth({ evidence: evidenceMap, distanceMeters: TWENTY_MI, bike: TOURING });
    expect(bike.tone).toBe("unknown");
    expect(bike.text).toBe("Not checked for your bike: 0.4 mi unknown surface");
  });

  it("calls a fully unknown surface unknown, not a warning about a mostly-known ride", () => {
    const evidenceMap: RouteEvidence = {
      surfaceMix: evidence(surfaceMix({ unknown: 20 })),
      bikeFit: bikeFit(),
      closures: clearClosures(1),
    };
    const [surface, bike] = rideTruth({ evidence: evidenceMap, distanceMeters: TWENTY_MI, bike: TOURING });
    expect(surface).toEqual({ tone: "unknown", text: "Surface unknown" });
    expect(bike.text).toBe("Not checked for your bike: 20 mi unknown surface");
  });

  it("reads a stale closure check as out of date, not clear", () => {
    const evidenceMap: RouteEvidence = {
      surfaceMix: evidence(surfaceMix({ paved: 20 })),
      bikeFit: bikeFit(),
      closures: evidence(0, "stale", [source("pa-511", CHECKED_AT)]),
    };
    const [, , checked] = rideTruth({ evidence: evidenceMap, distanceMeters: TWENTY_MI, bike: TOURING });
    expect(checked).toEqual({ tone: "unknown", text: "Closure check is out of date" });
  });

  it("accepts a clear check with no stated time or source without inventing either", () => {
    const evidenceMap: RouteEvidence = {
      surfaceMix: evidence(surfaceMix({ paved: 20 })),
      bikeFit: bikeFit(),
      closures: evidence(0, "known", []),
    };
    const [, , checked] = rideTruth({ evidence: evidenceMap, distanceMeters: TWENTY_MI, bike: TOURING });
    expect(checked).toEqual({ tone: "good", text: "Checked: no closures on this route" });
  });

  it("warns of an unconfirmed seasonal road even without a warning count", () => {
    const evidenceMap: RouteEvidence = {
      surfaceMix: evidence(surfaceMix({ paved: 20 })),
      bikeFit: bikeFit(),
      closures: clearClosures(1),
      access: UNCONFIRMED_ACCESS,
    };
    const [, , checked] = rideTruth({ evidence: evidenceMap, distanceMeters: TWENTY_MI, bike: TOURING });
    expect(checked).toEqual({ tone: "warn", text: "Seasonal road not confirmed" });
  });

  it("keeps an unmeasured access check out of the closure line", () => {
    const evidenceMap: RouteEvidence = {
      surfaceMix: evidence(surfaceMix({ paved: 20 })),
      bikeFit: bikeFit(),
      closures: clearClosures(1),
      access: unavailableEvidence<number>(),
    };
    const [, , checked] = rideTruth({ evidence: evidenceMap, distanceMeters: TWENTY_MI, bike: TOURING });
    expect(checked.tone).toBe("good");
  });

  it("treats a malformed or unknown bike fit as not checked", () => {
    for (const value of [
      evidence({ roughTrackMeters: "a lot", unmeasuredMeters: 0 }),
      evidence({ roughTrackMeters: 0, unmeasuredMeters: 0 }, "unknown"),
      { value: null, status: "unknown" as EvidenceStatus, confidence: null, provenance: [] },
    ]) {
      const evidenceMap: RouteEvidence = {
        surfaceMix: evidence(surfaceMix({ paved: 20 })),
        bikeFit: value,
        closures: clearClosures(1),
      };
      const [, bike] = rideTruth({ evidence: evidenceMap, distanceMeters: TWENTY_MI, bike: TOURING });
      expect(bike.tone).toBe("unknown");
    }
  });

  it("never trusts a surface mix marked unknown or unavailable", () => {
    for (const status of ["unknown", "unavailable", "stale"] as const) {
      const evidenceMap: RouteEvidence = {
        surfaceMix: evidence(surfaceMix({ paved: 20 }), status),
        bikeFit: bikeFit(),
        closures: clearClosures(1),
      };
      const [surface, bike] = rideTruth({ evidence: evidenceMap, distanceMeters: TWENTY_MI, bike: TOURING });
      expect(surface).toEqual({ tone: "unknown", text: "Surface unknown" });
      expect(bike.tone).toBe("unknown");
    }
  });
});

/**
 * The invariant: unknown or unavailable input never yields `good`. Built as a
 * product of the three evidence states and the bikes, so a future edit that
 * quietly treats an absent value as clear fails here.
 */
describe("unknown or unavailable data never reads as good", () => {
  const SURFACE_STATES = [
    { name: "missing", surfaceMix: undefined, usable: false, gravel: false },
    { name: "all paved", surfaceMix: evidence(surfaceMix({ paved: 20 })), usable: true, gravel: false },
    { name: "partly unknown", surfaceMix: evidence(surfaceMix({ paved: 17, gravel: 1, unknown: 2 })), usable: true, gravel: true },
    { name: "all unknown", surfaceMix: evidence(surfaceMix({ unknown: 20 })), usable: false, gravel: false },
  ] as const;
  const FIT_STATES = [
    { name: "missing", bikeFit: undefined, complete: false, rough: false },
    { name: "complete, no rough ground", bikeFit: bikeFit(), complete: true, rough: false },
    { name: "complete, rough ground", bikeFit: bikeFit({ roughTrackMeters: 1287, worst: { fromMeters: 10, toMeters: 1297 } }), complete: true, rough: true },
    { name: "partly described", bikeFit: bikeFit({ unmeasuredMeters: 804 }), complete: false, rough: false },
  ] as const;
  const CLOSURE_STATES = [
    { name: "missing", closures: undefined, clear: false },
    { name: "unknown", closures: evidence<number | null>(null, "unknown"), clear: false },
    { name: "unavailable", closures: unavailableEvidence<number>(), clear: false },
    { name: "stale", closures: evidence(0, "stale", [source("s", CHECKED_AT)]), clear: false },
    { name: "reported", closures: evidence(0.9, "known", [source("s", CHECKED_AT)]), clear: false },
    { name: "closed", closures: evidence(1, "known", [source("s", CHECKED_AT)]), clear: false },
    { name: "clear", closures: clearClosures(2), clear: true },
  ] as const;

  for (const surface of SURFACE_STATES) {
    for (const fit of FIT_STATES) {
      for (const closure of CLOSURE_STATES) {
        for (const { bike, name } of BIKES) {
          it(`${surface.name} / ${fit.name} / closure ${closure.name} / ${name}`, () => {
            const evidenceMap: RouteEvidence = {
              ...(surface.surfaceMix === undefined ? {} : { surfaceMix: surface.surfaceMix }),
              ...(fit.bikeFit === undefined ? {} : { bikeFit: fit.bikeFit }),
              ...(closure.closures === undefined ? {} : { closures: closure.closures }),
            };
            const [surfaceLine, bikeLine, checkedLine] = rideTruth({
              evidence: evidenceMap,
              distanceMeters: TWENTY_MI,
              bike,
            });

            if (!surface.usable) expect(surfaceLine.tone).not.toBe("good");

            const overGravel = surface.gravel && bike.maintainedGravel === "avoid";
            const overRough = fit.rough && bike.roughTracks === "avoid";
            if (!surface.usable || !fit.complete || overGravel || overRough) {
              expect(bikeLine.tone).not.toBe("good");
            }
            if (overGravel || overRough) expect(bikeLine.tone).toBe("bad");

            if (!closure.clear) expect(checkedLine.tone).not.toBe("good");

            // And the clear case really is clear, so the assertions above are
            // not passing because everything is neutral.
            if (surface.usable && surface.name === "all paved" && fit.name === "complete, no rough ground" &&
              closure.clear && bike.maintainedGravel === "allow") {
              expect(surfaceLine.tone).toBe("good");
              expect(bikeLine.tone).toBe("good");
              expect(checkedLine.tone).toBe("good");
            }
          });
        }
      }
    }
  }
});
