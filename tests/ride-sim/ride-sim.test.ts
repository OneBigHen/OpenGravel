/**
 * Ride simulation — the navigation promise, replayed.
 *
 * Ten committed tracks, five scenarios each, every fix pushed through the real
 * position pipeline and navigation engine. The assertions are the rider-facing
 * promise: a turn is issued once with enough warning, nothing is spoken after it
 * is passed, a clean/noisy/GPS-less ride never raises a false off-route alert,
 * progress never runs backwards, arrival fires once, and an ignored turn raises
 * off-route inside ten seconds and produces a reroute request.
 *
 * Real-time playback is deliberately absent: fixes carry the timestamps a ride
 * would produce, but the loop runs as fast as the CPU allows. A 25-minute ride
 * replays in a few hundred milliseconds.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { haversine } from "@/domain/geometry/analysis";

import {
  arrivalViolations,
  completionViolations,
  cueOrderViolations,
  issueIdentityViolations,
  maneuverGuidanceViolations,
  missedTurnViolations,
  offRouteAlertViolations,
  progressViolations,
  rejoinMeasure,
  reportRerouteViolations,
} from "./assertions";
import { saveRiderReport } from "@/application/persistence/rider-report-repository";
import { newRiderReport, reportsToAvoidAreas } from "@/application/roads/rider-reports";
import { chainage, pointAlong } from "@/application/ride-session/rejoin-splice";
import { loadRoute, loadTracks } from "./fixtures";
import { runScenario } from "./run-scenario";

/** One fixed instant, so every run is byte-for-byte reproducible. */
const START_MS = Date.UTC(2026, 10, 10, 9, 0, 0);
const TRACKS = loadTracks();

function expectNoViolations(violations: readonly string[]): void {
  expect(violations, violations.join("\n")).toEqual([]);
}

function cumulative(geometry: readonly { lon: number; lat: number }[]): number[] {
  const distances = [0];
  for (let index = 0; index + 1 < geometry.length; index += 1) {
    const start = geometry[index];
    const finish = geometry[index + 1];
    if (start === undefined || finish === undefined) continue;
    distances.push((distances.at(-1) ?? 0) + haversine(start, finish));
  }
  return distances;
}

function longestStationaryRun(run: Awaited<ReturnType<typeof runScenario>>): number {
  let longest = 0;
  let current = 0;
  for (const fix of run.fixes) {
    if (fix.speedMps === 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function longestSilenceMs(run: Awaited<ReturnType<typeof runScenario>>): number {
  let longest = 0;
  for (let index = 1; index < run.fixes.length; index += 1) {
    const previous = run.fixes[index - 1];
    const current = run.fixes[index];
    if (previous === undefined || current === undefined) continue;
    longest = Math.max(longest, current.atMs - previous.atMs);
  }
  return longest;
}

function maxInputOffset(run: Awaited<ReturnType<typeof runScenario>>): number {
  let maximum = 0;
  run.fixes.forEach((fix, index) => {
    const observation = run.observations[index];
    if (observation === undefined) return;
    maximum = Math.max(maximum, haversine(observation, fix.coordinate));
  });
  return maximum;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ride-sim fixture corpus", () => {
  it("holds ten tracks, each with a route, turn instructions and usable anchors", () => {
    expect(TRACKS).toHaveLength(10);
    expect(new Set(TRACKS.map((track) => track.id)).size).toBe(10);
    for (const track of TRACKS) {
      const route = loadRoute(track.routeFixture);
      const distances = cumulative(route.geometry);
      const total = distances.at(-1) ?? 0;
      expect(route.geometry.length, track.id).toBeGreaterThanOrEqual(3);
      expect(total, track.id).toBeCloseTo(route.distanceMeters, 0);

      const turnInstructions = route.instructions.filter(
        (instruction) =>
          instruction.type === "turn" ||
          instruction.type === "roundabout" ||
          instruction.type === "keep-left" ||
          instruction.type === "keep-right",
      );
      expect(turnInstructions.length, track.id).toBeGreaterThanOrEqual(3);
      expect(
        route.instructions.some((instruction) => instruction.type === "finish"),
        `${track.id} needs a finish instruction`,
      ).toBe(true);

      const missed = track.scenarios.missedTurn.instructionIndex;
      expect(missed, track.id).toBeGreaterThan(0);
      expect(missed, track.id).toBeLessThan(route.geometry.length - 1);

      const gapStart = track.scenarios.noGps.startMeters;
      const gapEnd = gapStart + track.speedMps * track.scenarios.noGps.durationSeconds;
      expect(gapStart, track.id).toBeGreaterThan(50);
      expect(gapEnd, track.id).toBeLessThan(total - 50);

      // A GPS blackout or a stationary rider must not straddle a turn: the
      // scenarios test loss/stop handling, not whether a skipped turn is
      // announced.
      const turnDistances = turnInstructions
        .map((instruction) => distances[instruction.geometryIndex ?? 0] ?? 0)
        .filter((at) => at > 0 && at < total);
      for (const at of turnDistances) {
        expect(
          at < gapStart - 25 || at > gapEnd + 25,
          `${track.id}: the no-GPS window crosses the turn at ${at.toFixed(0)} m`,
        ).toBe(true);
        const stopAt = track.scenarios.stop.startMeters;
        expect(
          Math.abs(stopAt - at),
          `${track.id}: the stop sits on the turn at ${at.toFixed(0)} m`,
        ).toBeGreaterThan(100);
      }
    }
  });
});

function onRouteAssertions(run: Awaited<ReturnType<typeof runScenario>>): void {
  expect(run.guidanceAvailable, run.guidanceMessage ?? "guidance unavailable").toBe(true);
  expectNoViolations([
    ...cueOrderViolations(run),
    ...issueIdentityViolations(run),
    ...maneuverGuidanceViolations(run),
    ...arrivalViolations(run),
    ...completionViolations(run),
    ...progressViolations(run),
    ...offRouteAlertViolations(run),
  ]);
}

for (const track of TRACKS) {
  describe(track.name, () => {
    const route = loadRoute(track.routeFixture);

    it("clean follow: every turn announced once in good time, no off-route, arrival once", async () => {
      const run = await runScenario({
        track,
        route,
        scenario: "clean",
        startMs: START_MS,
      });
      onRouteAssertions(run);
      // The clean run really is clean: it follows the recorded line.
      expect(maxInputOffset(run), track.id).toBeLessThan(1e-9);
    });

    it("8 m GPS noise: guidance holds, no off-route, progress never backwards", async () => {
      const run = await runScenario({
        track,
        route,
        scenario: "noise",
        startMs: START_MS,
      });
      onRouteAssertions(run);
      // Prove the scenario actually displaced fixes, rather than silently
      // replaying the clean line with a noise option that did nothing.
      expect(maxInputOffset(run), track.id).toBeGreaterThan(3);
    });

    it("missed turn: off-route within 10 s and a reroute is requested", async () => {
      const run = await runScenario({
        track,
        route,
        scenario: "missed-turn",
        startMs: START_MS,
      });
      expect(run.firstOffRoute, `${track.id}: no off-route transition`).not.toBeNull();
      expectNoViolations([
        ...cueOrderViolations(run),
        ...issueIdentityViolations(run),
        ...(await missedTurnViolations(run)),
      ]);
    });

    // RM-6: the missed-turn reroute, measured once per track and checked three ways.
    let rejoin: Promise<Awaited<ReturnType<typeof rejoinMeasure>>> | null = null;
    const measureRejoin = () => {
      rejoin ??= runScenario({ track, route, scenario: "missed-turn", startMs: START_MS }).then(async (run) => {
        const measure = await rejoinMeasure(run);
        console.log(
          `REJOIN ${track.id} bind=${measure.bindMs?.toFixed(1)}ms calls=${measure.routerCalls} ` +
          `ahead=${measure.aheadMeters.toFixed(0)}m rejoinable=${measure.rejoinableMeters.toFixed(0)}m kept=${measure.keptMeters.toFixed(0)}m`,
        );
        return measure;
      });
      return rejoin;
    };

    it("missed turn: a new route is bound within 5 s of off-route", async () => {
      expectNoViolations((await measureRejoin()).bindViolations);
    });

    it("missed turn: the new route's tail is the planned line from the rejoin point, exactly", async () => {
      expectNoViolations((await measureRejoin()).tailViolations);
    });

    it("missed turn: at least 90% of the planned ride still ahead is kept", async () => {
      expectNoViolations((await measureRejoin()).keptViolations);
    });

    it("rider report 2 km ahead on the line: the new route goes round it and rejoins beyond it", async () => {
      const run = await runScenario({ track, route, scenario: "missed-turn", startMs: START_MS });
      const memory = new Map<string, string>();
      vi.stubGlobal("window", {
        localStorage: {
          getItem: (key: string) => memory.get(key) ?? null,
          setItem: (key: string, value: string) => void memory.set(key, value),
          removeItem: (key: string) => void memory.delete(key),
        },
      });
      const riderAlong = 400;
      const spot = pointAlong(route.geometry, chainage(route.geometry), riderAlong + 2_000).coordinate;
      const now = Date.now();
      const report = newRiderReport({ id: `rr_sim_${track.id}`, point: spot, headingDegrees: null, kind: "gate-closed", nowMs: now });
      expect(saveRiderReport(report, now)).toBe(true);
      const ring = reportsToAvoidAreas([report], now)[0]!.ring;
      const result = await reportRerouteViolations(run, ring, riderAlong);
      console.log(`REPORT ${track.id} ringEnds=${result.ringLast?.toFixed(0)}m rejoinAt=${result.joinAlong?.toFixed(0)}m`);
      expectNoViolations(result.violations);
    });

    it("30 s without GPS: no off-route, announcements and progress resume", async () => {
      const run = await runScenario({
        track,
        route,
        scenario: "no-gps",
        startMs: START_MS,
      });
      onRouteAssertions(run);
      expect(longestSilenceMs(run), track.id).toBeGreaterThanOrEqual(29_000);
    });

    it("2 minute stop: progress holds, no repeat announcements, no off-route", async () => {
      const run = await runScenario({
        track,
        route,
        scenario: "stop",
        startMs: START_MS,
      });
      onRouteAssertions(run);
      expect(longestStationaryRun(run), track.id).toBeGreaterThanOrEqual(120);
    });
  });
}
