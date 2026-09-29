import { describe, expect, it } from "vitest";
import { buildReturnIntent } from "@/application/free-ride/return-routing";
import { defaultRideIntent } from "@/domain/ride/create";
import { asGeometryRef, asRoadSpanId, type AvoidAreaId } from "@/domain/ride/ids";

const intent = {
  ...defaultRideIntent(),
  shape: "loop" as const,
  avoidAreas: [{ id: "avoid_forest" as AvoidAreaId, name: "Closed road", geometryRef: asGeometryRef("geo_avoid"), enabled: true, createdBy: "rider" as const }],
  roadSpans: [{ id: asRoadSpanId("span_legal"), mode: "must" as const, direction: "forward" as const, geometryRef: asGeometryRef("geo_span"), anchorRefs: [{ lon: -77.1, lat: 40.1 }, { lon: -77.2, lat: 40.2 }] }],
};

describe("buildReturnIntent", () => {
  it("plans a fresh explicit destination while preserving hard riding constraints", () => {
    const result = buildReturnIntent({
      authoredIntent: intent,
      currentPosition: { lon: -77, lat: 40 },
      target: { kind: "chosen-destination", coordinate: { lon: -77.2, lat: 40.2 }, label: "Cabin" },
      mode: "fatigue",
    });

    expect(result).toMatchObject({ ok: true, selectionRole: "lower-workload", requiresFreshPlan: true });
    if (!result.ok) return;
    expect(result.intent.shape).toBe("destination");
    expect(result.intent.start?.coordinate).toEqual({ lon: -77, lat: 40 });
    expect(result.intent.finish?.coordinate).toEqual({ lon: -77.2, lat: 40.2 });
    expect(result.intent.roadCharacter).toBe("efficient");
    expect(result.intent.traffic).toBe("minimize-delay");
    expect(result.intent.bike).toEqual(intent.bike);
    expect(result.intent.surface).toEqual(intent.surface);
    expect(result.intent.terrain).toEqual(intent.terrain);
    expect(result.intent.avoidAreas).toEqual(intent.avoidAreas);
    expect(result.intent.roadSpans).toEqual(intent.roadSpans);
    expect(result.intent.stops).toEqual([]);
    expect(result.intent.sketch).toBeNull();
  });

  it("never treats old route geometry as a reverse route", () => {
    expect(buildReturnIntent({
      authoredIntent: intent,
      currentPosition: { lon: -77, lat: 40 },
      target: { kind: "session-start", coordinate: { lon: -77.1, lat: 40.1 }, label: "Ride start" },
      mode: "turn-around",
    })).toMatchObject({ ok: true, requiresFreshPlan: true, selectionRole: "best-ride" });
  });

  it("refuses a missing or invalid explicit target", () => {
    expect(buildReturnIntent({
      authoredIntent: intent,
      currentPosition: { lon: -77, lat: 40 },
      target: { kind: "chosen-destination", coordinate: { lon: 181, lat: 40 }, label: null },
      mode: "head-home",
    })).toEqual({ ok: false, reason: "invalid-return-target" });
  });

  it("plans a curvy loop of the chosen length from where the rider is (Loop from here)", () => {
    const result = buildReturnIntent({
      authoredIntent: { ...intent, roadCharacter: "balanced" },
      currentPosition: { lon: -77, lat: 40 },
      target: { kind: "session-start", coordinate: { lon: -77, lat: 40 }, label: "Loop start" },
      mode: "loop",
      loopMinutes: 120,
    });
    expect(result).toMatchObject({ ok: true, selectionRole: "best-ride" });
    if (!result.ok) return;
    expect(result.intent.shape).toBe("loop");
    expect(result.intent.start?.coordinate).toEqual({ lon: -77, lat: 40 });
    expect(result.intent.finish).toBeNull();
    expect(result.intent.time).toMatchObject({ kind: "budget", targetMinutes: 120 });
    expect(result.intent.roadCharacter).toBe("curvy");
    expect(result.intent.avoidAreas).toEqual(intent.avoidAreas);
  });

  it("keeps a rider's twistier choice, and refuses a nonsense length", () => {
    const backroads = buildReturnIntent({
      authoredIntent: { ...intent, roadCharacter: "backroads" },
      currentPosition: { lon: -77, lat: 40 },
      target: { kind: "session-start", coordinate: { lon: -77, lat: 40 }, label: "Loop start" },
      mode: "loop",
      loopMinutes: 60,
    });
    expect(backroads.ok && backroads.intent.roadCharacter).toBe("backroads");
    expect(buildReturnIntent({
      authoredIntent: intent,
      currentPosition: { lon: -77, lat: 40 },
      target: { kind: "session-start", coordinate: { lon: -77, lat: 40 }, label: "Loop start" },
      mode: "loop",
      loopMinutes: 5,
    })).toEqual({ ok: false, reason: "invalid-return-target" });
  });

  it("gets a rider who missed a turn back onto the rest of the loop", () => {
    const rejoin = [{ lon: -77.05, lat: 40.05 }, { lon: -77.1, lat: 40.02 }];
    const result = buildReturnIntent({
      authoredIntent: intent,
      currentPosition: { lon: -77.02, lat: 40.04 },
      target: { kind: "session-start", coordinate: { lon: -77, lat: 40 }, label: "Loop start" },
      mode: "loop",
      rejoin,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.shape).toBe("destination");
    expect(result.intent.finish?.coordinate).toEqual({ lon: -77, lat: 40 });
    expect(result.intent.shaping.map((point) => point.coordinate)).toEqual(rejoin);
  });
});
