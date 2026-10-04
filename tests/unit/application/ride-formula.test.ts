import { describe, expect, it } from "vitest";

import type { ProviderCandidate, ProviderRouteOptions } from "@/application/planner/route-provider";
import { scoreCandidateWithRideFormula } from "@/application/planner/ride-formula";

const options: ProviderRouteOptions = {
  includeAlternatives: true,
  avoidHighways: false,
  tollPolicy: "allow-with-warning",
  surfacePreference: "dirt-preferred",
  roadCharacter: "backroads",
  vehicle: "motorcycle",
};

function candidate(overrides: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    providerId: "test",
    profile: "motorcycle_fastest",
    geometry: [
      { lon: -75, lat: 40 },
      { lon: -74.99, lat: 40.002 },
      { lon: -74.98, lat: 40 },
    ],
    distanceMeters: 10_000,
    durationSeconds: 1_000,
    roadSummary: {
      totalMeters: 10_000,
      surfaceByRoadClassMeters: { "gravel|unclassified": 7_000, "asphalt|tertiary": 3_000 },
      curvatureMeters: { "0.8": 7_000, "1": 3_000 },
      tollMeters: 0,
      roadRuns: [
        {
          meters: 7_000,
          durationSeconds: 700,
          surface: "gravel",
          roadClass: "unclassified",
          roadEnvironment: "rural",
          urbanDensity: "rural",
          curvatureRatio: 0.8,
          toll: false,
          trackType: "grade1",
          smoothness: "good",
          maxSpeedKmh: 64,
          maxSpeedEstimated: false,
          roadClassLink: false,
          roundabout: false,
          carAccess: true,
          roadAccess: "yes",
        },
        {
          meters: 3_000,
          durationSeconds: 300,
          surface: "asphalt",
          roadClass: "tertiary",
          roadEnvironment: "rural",
          urbanDensity: "rural",
          curvatureRatio: 1,
          toll: false,
          trackType: null,
          smoothness: "good",
          maxSpeedKmh: 80,
          maxSpeedEstimated: true,
          roadClassLink: false,
          roundabout: false,
          carAccess: true,
          roadAccess: "yes",
        },
      ],
    },
    ...overrides,
  };
}

describe("ride formula evidence projection", () => {
  it("reads a track grade as dirt only when the surface is untagged, and never grade1", () => {
    const base = candidate();
    const runs = base.roadSummary!.roadRuns!;
    const withRuns = (first: Partial<(typeof runs)[number]>) => candidate({ roadSummary: { ...base.roadSummary!, roadRuns: [{ ...runs[0]!, ...first }, runs[1]!] } });
    const share = (value: ProviderCandidate) => scoreCandidateWithRideFormula(value, options).variables.unpavedShare.value;
    // PA 44: asphalt|secondary|grade1 used to read as 15 km of dirt.
    expect(share(withRuns({ surface: "asphalt", trackType: "grade1" }))).toBe(0);
    expect(share(withRuns({ surface: "asphalt", trackType: "grade3" }))).toBe(0);
    expect(share(withRuns({ surface: "missing", trackType: "grade1" }))).toBe(0);
    expect(share(withRuns({ surface: "missing", trackType: "grade2" }))).toBeCloseTo(0.7);
    expect(share(withRuns({ surface: "gravel", trackType: null }))).toBeCloseTo(0.7);
  });
  it("projects raw road runs, Franco geometry, and canonical evidence into formula variables", () => {
    const result = scoreCandidateWithRideFormula(candidate(), options, {
      canonicalEligible: true,
      closureAssessment: { trust: 0.9, confidence: 0.8 },
      fastestSeconds: 900,
    });

    expect(result.eligible).toBe(true);
    expect(result.variables.unpavedShare?.value).toBeCloseTo(0.7);
    expect(result.variables.continuousDirtMeters?.value).toBe(7_000);
    expect(result.variables.francoTotalCurvature?.value).not.toBeNull();
    expect(result.variables.trust?.value).toBe(0.9);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("leaves trust and surface facts unknown when the provider supplied no evidence", () => {
    const noFacts = candidate({ roadSummary: undefined });
    const result = scoreCandidateWithRideFormula(noFacts, options);

    expect(result.variables.trust?.value).toBeNull();
    expect(result.variables.unpavedShare?.value).toBeNull();
    expect(result.variables.continuousDirtMeters?.value).toBeNull();
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("uses the explicit discovery target for both arrival and return slack", () => {
    const result = scoreCandidateWithRideFormula(candidate(), options, {
      discovery: { targetMinutes: 30, toleranceMinutes: 5 },
    });

    expect(result.variables.arrivalSlackMinutes?.value).toBe(13.333333333333332);
    expect(result.variables.returnSlackMinutes?.value).toBe(13.333333333333332);
  });
});
