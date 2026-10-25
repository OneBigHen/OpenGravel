/**
 * Crash suspicion (issue #12 follower safety): synthetic accelerometer and GPS
 * streams through the pure detector — a real crash, a pothole, a phone dropped
 * at a light, a slow tip-over, GPS gaps, the free-fall path and the dismissal
 * debounce. Every scenario states what the detector may and may not conclude.
 */

import { describe, expect, it } from "vitest";

import {
  applyGpsFix,
  applyMotionSample,
  crashDetectorSnapshot,
  createCrashDetector,
  dismissCrashSuspicion,
  INITIAL_CRASH_DETECTOR_STATE,
  type CrashDetectorEvent,
  type CrashDetectorState,
  type GpsFix,
  type MotionSample,
} from "@/domain/safety/crash-detector";

const LAT = 45.5;
const LON = -122.6;
/** One degree of latitude, near enough for the 15 m movement bound. */
const METERS_PER_DEGREE_LAT = 111_320;

interface Step {
  readonly atMs: number;
  readonly fix?: GpsFix;
  readonly motion?: MotionSample;
}

function fixAt(atMs: number, speedMps: number | null, offsetMeters = 0): GpsFix {
  return {
    atMs,
    lat: LAT + offsetMeters / METERS_PER_DEGREE_LAT,
    lon: LON,
    speedMps,
    accuracyM: 5,
  };
}

/** Gravity at rest, along the device's Z axis. */
function rest(atMs: number): MotionSample {
  return { atMs, x: 0, y: 0, z: 9.81 };
}

/** A spike measured in g, always well above the 3.5 g sustained-impact gate by default. */
function spike(atMs: number, g = 4): MotionSample {
  return { atMs, x: 0, y: 0, z: g * 9.81 };
}

/** Weightless samples: free fall reads near 0 g. */
function freeFall(atMs: number): MotionSample {
  return { atMs, x: 0, y: 0, z: 0.5 };
}

function ridingFixSteps(fromMs: number, count: number, speedMps = 12): Step[] {
  return Array.from({ length: count }, (_, index) => {
    const atMs = fromMs + index * 1_000;
    return { atMs, fix: fixAt(atMs, speedMps) };
  });
}

function stoppedFixSteps(
  fromMs: number,
  count: number,
  options: { readonly speedMps?: number | null; readonly offsetMeters?: number } = {},
): Step[] {
  const { speedMps = 0, offsetMeters = 0 } = options;
  return Array.from({ length: count }, (_, index) => {
    const atMs = fromMs + index * 1_000;
    return { atMs, fix: fixAt(atMs, speedMps, offsetMeters) };
  });
}

/** A two-sample spike: 16 ms apart, inside the 100 ms window. */
function sustainedImpactSteps(atMs: number, g = 4): Step[] {
  return [
    { atMs: atMs - 200, motion: rest(atMs - 200) },
    { atMs, motion: spike(atMs, g) },
    { atMs: atMs + 16, motion: spike(atMs + 16, g) },
  ];
}

function feed(
  steps: readonly Step[],
  initial: CrashDetectorState = INITIAL_CRASH_DETECTOR_STATE,
): { readonly state: CrashDetectorState; readonly events: readonly CrashDetectorEvent[] } {
  const ordered = [...steps].sort((first, second) => first.atMs - second.atMs);
  let state = initial;
  const events: CrashDetectorEvent[] = [];
  for (const step of ordered) {
    if (step.fix !== undefined) {
      const result = applyGpsFix(state, step.fix);
      state = result.state;
      events.push(...result.events);
    }
    if (step.motion !== undefined) {
      const result = applyMotionSample(state, step.motion);
      state = result.state;
      events.push(...result.events);
    }
  }
  return { state, events };
}

describe("impact rules", () => {
  const riding = ridingFixSteps(0, 20); // fixes 0 ms … 19 000 ms at 12 m/s

  it("ignores an ordinary ride: gravity at rest never reads as an impact", () => {
    const motions = Array.from({ length: 40 }, (_, index) => ({
      atMs: 20_000 + index * 50,
      motion: rest(20_000 + index * 50),
    }));
    const { state } = feed([...riding, ...motions]);
    expect(state.phase).toBe("watching");
    expect(state.impactAtMs).toBeNull();
  });

  it("needs two consecutive samples inside 100 ms: a single spike is not an impact", () => {
    const { state } = feed([...riding, { atMs: 20_000, motion: spike(20_000) }]);
    expect(state.phase).toBe("watching");
  });

  it("needs the two samples inside 100 ms: 150 ms apart is not sustained", () => {
    const { state } = feed([
      ...riding,
      { atMs: 20_000, motion: spike(20_000) },
      { atMs: 20_150, motion: spike(20_150) },
    ]);
    expect(state.phase).toBe("watching");
  });

  it("accepts two samples inside 100 ms as the gated impact", () => {
    const { state } = feed([...riding, ...sustainedImpactSteps(20_000)]);
    expect(state.phase).toBe("post-impact");
    expect(state.impactAtMs).toBe(20_016);
    expect(state.impactLocation).toEqual({ lat: LAT, lon: LON });
  });

  it("accepts a free fall of at least 300 ms landed with 2.5 g, even as one sample", () => {
    const { state } = feed([
      ...riding,
      ...[19_500, 19_600, 19_700, 19_800, 19_900].map((atMs) => ({ atMs, motion: freeFall(atMs) })),
      { atMs: 20_200, motion: spike(20_200, 3) },
    ]);
    expect(state.phase).toBe("post-impact");
    expect(state.impactAtMs).toBe(20_200);
  });

  it("ignores a too-short free fall", () => {
    const { state } = feed([
      ...riding,
      ...[19_800, 19_900].map((atMs) => ({ atMs, motion: freeFall(atMs) })),
      { atMs: 20_000, motion: spike(20_000, 3) },
    ]);
    expect(state.phase).toBe("watching");
  });

  it("ignores a landing more than a second after the free fall ended", () => {
    const { state } = feed([
      ...riding,
      ...[19_500, 19_600, 19_700, 19_800, 19_900].map((atMs) => ({ atMs, motion: freeFall(atMs) })),
      { atMs: 21_200, motion: spike(21_200, 3) },
    ]);
    expect(state.phase).toBe("watching");
  });

  it("does not arm from a spike with no riding speed inside the window", () => {
    // The only fix is 25 s old: unknown recent speed is never read as riding.
    const { state } = feed([
      { atMs: 0, fix: fixAt(0, 12) },
      ...sustainedImpactSteps(25_000),
    ]);
    expect(state.phase).toBe("watching");
  });

  it("never turns a null speed into evidence of riding", () => {
    const unknown = Array.from({ length: 20 }, (_, index) => {
      const atMs = index * 1_000;
      return { atMs, fix: fixAt(atMs, null) };
    });
    const { state } = feed([...unknown, ...sustainedImpactSteps(20_000)]);
    expect(state.phase).toBe("watching");
  });
});

describe("crash scenarios", () => {
  /** Riding, a two-sample spike, then stopped fixes long enough to confirm. */
  function crashToConfirmation(impactAt = 20_016) {
    return feed([
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(impactAt),
      // The stopped fixes start at 22 000 ms and run past 22 000 + 20 000.
      ...stoppedFixSteps(22_000, 22),
    ]);
  }

  it("raises one suspected crash after the stop holds for 20 s, with the last position", () => {
    const { state, events } = crashToConfirmation();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "suspected",
      atMs: 42_000,
      location: { lat: LAT, lon: LON },
    });
    expect(state.phase).toBe("suspected");
  });

  it("does not raise anything while the stop is still unconfirmed", () => {
    const { state, events } = feed([
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(20_016),
      ...stoppedFixSteps(22_000, 10), // 22 s … 31 s, only 9 s of stop
    ]);
    expect(events).toEqual([]);
    expect(state.phase).toBe("confirming-stop");
  });

  it("treats a spike followed by continued riding as a pothole", () => {
    const { state, events } = feed([
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(20_016),
      ...ridingFixSteps(21_000, 20, 9),
    ]);
    expect(events).toEqual([]);
    expect(state.phase).toBe("watching");
    expect(state.impactAtMs).toBeNull();
  });

  it("does not trigger on a phone dropped at a standstill", () => {
    const { state, events } = feed([
      // Rode in, then stood at the light for 21 s before the phone was dropped.
      ...ridingFixSteps(0, 10),
      ...stoppedFixSteps(10_000, 21),
      ...sustainedImpactSteps(31_016),
      ...stoppedFixSteps(32_000, 30),
    ]);
    expect(events).toEqual([]);
    expect(state.phase).toBe("watching");
  });

  it("does not trigger on a slow tip-over at 4 m/s: the riding gate is a documented limit", () => {
    const { state, events } = feed([
      ...ridingFixSteps(0, 20, 4),
      ...sustainedImpactSteps(20_016),
      ...stoppedFixSteps(22_000, 30),
    ]);
    expect(events).toEqual([]);
    expect(state.phase).toBe("watching");
  });

  it("aborts when the stop starts moving again before 20 s", () => {
    const { state, events } = feed([
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(20_016),
      ...stoppedFixSteps(22_000, 10),
      { atMs: 32_000, fix: fixAt(32_000, 4) }, // not stopped, not continued riding
      ...stoppedFixSteps(33_000, 30),
    ]);
    expect(events).toEqual([]);
    expect(state.phase).toBe("watching");
  });

  it("aborts when no stop starts inside 15 s of the impact", () => {
    const { state, events } = feed([
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(20_016),
      ...stoppedFixSteps(36_000, 1, { speedMps: 5 }), // 15 984 ms after the impact
      ...stoppedFixSteps(37_000, 25),
    ]);
    expect(events).toEqual([]);
    expect(state.phase).toBe("watching");
  });

  it("bridges a GPS gap by distance: a fix 20 s later within 15 m still confirms the stop", () => {
    const { state, events } = feed([
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(20_016),
      { atMs: 22_000, fix: fixAt(22_000, 0) },
      // No fixes for 20 s; the device reports no speed, but the position moved 4 m.
      { atMs: 42_000, fix: fixAt(42_000, null, 4) },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.atMs).toBe(42_000);
    expect(state.phase).toBe("suspected");
  });

  it("does not bridge a GPS gap that ends far from the stop", () => {
    const { state, events } = feed([
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(20_016),
      { atMs: 22_000, fix: fixAt(22_000, 0) },
      { atMs: 42_000, fix: fixAt(42_000, null, 200) },
    ]);
    expect(events).toEqual([]);
    expect(state.phase).toBe("watching");
  });

  it("stays silent through a GPS gap before the impact (unknown speed is not riding)", () => {
    const { state, events } = feed([
      { atMs: 0, fix: fixAt(0, 12) },
      ...sustainedImpactSteps(30_000),
      ...stoppedFixSteps(31_000, 30),
    ]);
    expect(events).toEqual([]);
    expect(state.phase).toBe("watching");
  });

  it("is deterministic and never mutates the state it is given", () => {
    const steps = [
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(20_016),
      ...stoppedFixSteps(22_000, 22),
    ];
    const first = feed(steps);
    const second = feed(steps);
    expect(first.events).toEqual(second.events);
    expect(first.state).toEqual(second.state);
    expect(INITIAL_CRASH_DETECTOR_STATE.fixes).toEqual([]);
    expect(INITIAL_CRASH_DETECTOR_STATE.motion).toEqual([]);
  });

  it("drops out-of-order and non-finite samples instead of reading them as calm", () => {
    const { state } = feed([
      ...ridingFixSteps(0, 20),
      { atMs: 20_000, motion: rest(20_000) },
      { atMs: 19_000, motion: spike(19_000) },
      { atMs: Number.NaN, motion: spike(Number.NaN) },
      { atMs: 20_100, motion: { atMs: 20_100, x: Number.NaN, y: 0, z: 0 } },
    ]);
    expect(state.phase).toBe("watching");
    expect(state.impactAtMs).toBeNull();
  });
});

describe("dismissal debounce", () => {
  function suspectedStateAndTime() {
    const { state, events } = feed([
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(20_016),
      ...stoppedFixSteps(22_000, 22),
    ]);
    expect(events).toHaveLength(1);
    return { state, atMs: events[0]?.atMs as number };
  }

  it("withholds the next suspicion for two minutes after a dismissal", () => {
    const first = suspectedStateAndTime();
    const dismissed = dismissCrashSuspicion(first.state, first.atMs);
    expect(dismissed.phase).toBe("watching");
    expect(dismissed.dismissedAtMs).toBe(first.atMs);

    // A second crash 40 s after the dismissal: the spike is inside the debounce.
    const secondImpact = first.atMs + 40_000;
    const second = feed(
      [
        ...ridingFixSteps(first.atMs + 10_000, 20),
        ...sustainedImpactSteps(secondImpact + 16),
        ...stoppedFixSteps(secondImpact + 2_000, 22),
      ],
      dismissed,
    );
    expect(second.events).toEqual([]);
    expect(second.state.phase).toBe("watching");
  });

  it("raises a suspicion whose evidence completes after the debounce, even if the impact was inside it", () => {
    const first = suspectedStateAndTime();
    const dismissed = dismissCrashSuspicion(first.state, first.atMs);
    // Impact 100 s after the dismissal, stop confirmed ~22 s later: the
    // suspicion itself is outside the two minutes, so it is not withheld.
    const secondImpact = first.atMs + 100_016;
    const second = feed(
      [
        ...ridingFixSteps(first.atMs + 70_000, 20),
        ...sustainedImpactSteps(secondImpact),
        ...stoppedFixSteps(secondImpact + 2_000, 22),
      ],
      dismissed,
    );
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.atMs).toBe(secondImpact + 22_000);
    expect(second.state.phase).toBe("suspected");
  });

  it("suspected again once two minutes have passed since the dismissal", () => {
    const first = suspectedStateAndTime();
    const dismissed = dismissCrashSuspicion(first.state, first.atMs);
    const secondImpact = first.atMs + 130_000;
    const second = feed(
      [
        ...ridingFixSteps(first.atMs + 100_000, 20),
        ...sustainedImpactSteps(secondImpact + 16),
        ...stoppedFixSteps(secondImpact + 2_000, 22),
      ],
      dismissed,
    );
    expect(second.events).toHaveLength(1);
    expect(second.state.phase).toBe("suspected");
  });
});

describe("crashDetectorSnapshot", () => {
  it("reports the confirming phase, stop duration and debounce deadline", () => {
    const { state } = feed([
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(20_016),
      ...stoppedFixSteps(22_000, 30),
    ]);
    const snapshot = crashDetectorSnapshot(state, 50_000);
    expect(snapshot.phase).toBe("suspected");
    expect(snapshot.suspected?.atMs).toBe(42_000);
    // The first stopped fix is at 22 000 ms, so by 50 000 ms the stop has
    // held for 28 s and the suspicion is already raised.
    expect(snapshot.stoppedForMs).toBe(28_000);
    expect(snapshot.debounceUntilMs).toBeNull();

    const dismissed = dismissCrashSuspicion(state, 60_000);
    expect(crashDetectorSnapshot(dismissed, 61_000).debounceUntilMs).toBe(180_000);
  });

  it("reads as watching once the stop window has passed with no stop", () => {
    const { state } = feed([...ridingFixSteps(0, 20), ...sustainedImpactSteps(20_016)]);
    expect(state.phase).toBe("post-impact");
    expect(crashDetectorSnapshot(state, 30_000).phase).toBe("post-impact");
    expect(crashDetectorSnapshot(state, 40_000).phase).toBe("watching");
  });
});

describe("createCrashDetector", () => {
  it("drives the same stream through the harness and answers stateFor(nowMs)", () => {
    const detector = createCrashDetector();
    const steps = [
      ...ridingFixSteps(0, 20),
      ...sustainedImpactSteps(20_016),
      ...stoppedFixSteps(22_000, 22),
    ].sort((first, second) => first.atMs - second.atMs);

    const events: CrashDetectorEvent[] = [];
    for (const step of steps) {
      if (step.fix !== undefined) events.push(...detector.pushFix(step.fix));
      if (step.motion !== undefined) events.push(...detector.pushMotion(step.motion));
    }

    expect(events.map((event) => event.type)).toEqual(["suspected"]);
    expect(detector.stateFor(43_000).phase).toBe("suspected");
    expect(detector.stateFor(43_000).suspected?.atMs).toBe(42_000);

    detector.dismiss(43_000);
    expect(detector.stateFor(43_000).phase).toBe("watching");
    expect(detector.stateFor(43_000).debounceUntilMs).toBe(163_000);

    detector.reset();
    expect(detector.stateFor(43_000).phase).toBe("watching");
  });
});
