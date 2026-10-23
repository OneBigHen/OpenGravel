/**
 * The Ride Focus surface (08-RIDE-NAVIGATION-AND-FREE-RIDE §2–§8, §13, §28;
 * 12-DESIGN-SYSTEM-RESPONSIVE-ACCESSIBILITY §3, §10, §15–§17;
 * 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * The surface renders a view model the store derives, so these tests drive the
 * **whole path** where it matters: a real session controller with the real
 * Dexie journal on `fake-indexeddb`, the store's real recovery, and the real
 * component. What they assert is what a rider can see and press:
 *
 * - the dark chrome shows the §4 freshness label, and a stale fix loses its
 *   speed and heading on screen;
 * - a reload (a fresh store over the same journal and pointer) comes back paused
 *   and requires an explicit Resume;
 * - a blocked location keeps Retry / Stop / Finish / Discard reachable;
 * - a wake-lock or speech failure is visible and blocks nothing;
 * - `Stop ride` is two steps, and Finish and Discard are distinguishable;
 * - every primary control carries the 56 px hit-area class, and `globals.css`
 *   really gives it that height (12 §10).
 */

import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import path from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RideFocusEnvironmentPort,
  RideFocusEnvironmentSnapshot,
} from "@/application/ride-session/ports/ride-focus-environment";
import { asPlaceId, type NearbyPlace, type PlacesSource } from "@/application/places";
import type {
  GeometryRef,
  RideId,
  StopId,
} from "@/domain/ride/ids";
import { newRideId, newStopId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";
import type { RideSessionId, SessionInstructionId } from "@/domain/ride-session/ids";
import { asSessionInstructionId } from "@/domain/ride-session/ids";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import {
  instructionIssuedEvent,
  offRouteChangedEvent,
  positionUpdatedEvent,
} from "@/domain/ride-session/create";
import { asRouteCandidateId } from "@/domain/route/ids";
import { asRecordingId } from "@/domain/recording/ids";
import {
  EMPTY_RECORDING_TELEMETRY,
  type RecordingTelemetry,
} from "@/domain/recording/telemetry";
import type { GuidedReroutePlanner, GuidedRerouteResult } from "@/application/ride-session/guided-reroute";
import { buildRideFocusViewModel } from "@/application/ride-session/ride-focus-view-model";
import {
  createRideSessionController,
  type RideSessionController,
} from "@/application/ride-session/ride-session-controller";
import type { RideFocusPointerPort } from "@/application/persistence/ride-focus-pointer";
import { createRideSessionRepository } from "@/infrastructure/storage/ride-session-repository";
import { createRideFocusStore } from "@/ui/stores/ride-focus-store";
import {
  createRiderSettings,
  type RiderSettings,
  type RiderSettingsStoragePort,
} from "@/application/ride-metrics/rider-settings";
import type {
  RideFocusTelemetryInput,
  RideFocusTelemetryProvider,
} from "@/application/ride-session/ride-focus-view-model";
import { RideFocus } from "@/ui/ride/RideFocus";

import { createStubMapHostFactory } from "../support/stub-map-host";

const NOW = "2026-09-21T14:00:00.000Z";
const RIDE_ID: RideId = newRideId();
const GEOMETRY_REF = "geo_ride_line" as GeometryRef;
const ROUTE = { planningGeneration: 3, routeId: asRouteCandidateId("route_best") };
const LINE: readonly Coordinate[] = [
  { lon: -75.44, lat: 40.13 },
  { lon: -75.43, lat: 40.12 },
  { lon: -75.42, lat: 40.11 },
];

let databaseSequence = 0;

function freshDatabaseName(): string {
  databaseSequence += 1;
  return `opengravel-vnext-ride-focus-${databaseSequence}`;
}

interface EnvironmentDouble {
  readonly port: RideFocusEnvironmentPort;
  set(next: Partial<RideFocusEnvironmentSnapshot>): void;
  readonly rideActiveCalls: readonly boolean[];
  readonly permissionRequests: number;
  readonly disposed: boolean;
}

function environmentDouble(
  initial: Partial<RideFocusEnvironmentSnapshot> = {},
): EnvironmentDouble {
  const listeners = new Set<(snapshot: RideFocusEnvironmentSnapshot) => void>();
  let snapshot: RideFocusEnvironmentSnapshot = {
    locationPermission: "granted",
    wakeLock: "active",
    speech: "ready",
    ...initial,
  };
  let permissionRequests = 0;
  let disposed = false;
  const rideActiveCalls: boolean[] = [];
  const notify = (): void => {
    for (const listener of listeners) listener(snapshot);
  };
  return {
    port: {
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        listener(snapshot);
        return () => listeners.delete(listener);
      },
      setRideActive: (active): void => {
        rideActiveCalls.push(active);
      },
      requestLocationPermission: async () => {
        permissionRequests += 1;
        snapshot = { ...snapshot, locationPermission: "granted" };
        notify();
        return "granted";
      },
      dispose: (): void => {
        disposed = true;
      },
    },
    set(next): void {
      snapshot = { ...snapshot, ...next };
      notify();
    },
    get rideActiveCalls(): readonly boolean[] {
      return rideActiveCalls;
    },
    get permissionRequests(): number {
      return permissionRequests;
    },
    get disposed(): boolean {
      return disposed;
    },
  };
}

interface PointerDouble extends RideFocusPointerPort {
  readonly writes: unknown[];
  readonly clears: number;
}

function pointerDouble(target: { sessionId: RideSessionId | null }): PointerDouble {
  const writes: unknown[] = [];
  let clears = 0;
  return {
    get writes() {
      return writes;
    },
    get clears() {
      return clears;
    },
    read: () =>
      target.sessionId === null
        ? { status: "absent" }
        : {
            status: "found",
            pointer: {
              version: 1,
              sessionId: target.sessionId,
              rideId: RIDE_ID,
              routeGeometryRef: GEOMETRY_REF,
              updatedAt: NOW,
            },
          },
    write: (value): void => {
      writes.push(value);
    },
    clear: (): void => {
      clears += 1;
      target.sessionId = null;
    },
  };
}

interface Harness {
  readonly store: ReturnType<typeof createRideFocusStore>;
  readonly controller: RideSessionController;
  readonly environment: EnvironmentDouble;
  readonly pointer: PointerDouble;
  readonly hosts: ReturnType<typeof createStubMapHostFactory>;
  readonly sessionId: RideSessionId;
  readonly databaseName: string;
  /** The store's own 1 Hz refresh, as the ride screen runs it on a mounted phone. */
  readonly tick: () => void;
  /** The identity of the issued maneuver, when the fixture issued one. */
  readonly instructionId: SessionInstructionId | null;
}

/** A deterministic identity per issued fixture maneuver (the journal validates the prefix). */
let instructionSequence = 0;
function nextInstructionId(): SessionInstructionId {
  instructionSequence += 1;
  return asSessionInstructionId(`instr_ride_focus_${instructionSequence}`);
}

const RIDE_FOCUS_PLACE: NearbyPlace = {
  id: asPlaceId("hh:ride-focus-test"),
  kind: "happy_hour",
  name: "Ride Focus Taproom",
  coordinate: { lon: -75.4, lat: 40.1 },
  category: "Bar",
  label: "Til 10 PM",
  status: "now",
  city: "Bridgeport",
  address: "12 Main Street",
  specials: ["$3 drafts"],
  schedule: null,
  rating: null,
  popular: false,
  dogFriendly: null,
  patio: null,
  url: "https://places.example/ride-focus",
  mapsUrl: null,
  offRouteMiles: null,
  routeMile: null,
};

/**
 * A started, moving session over the real journal, a store recovered from the
 * pointer, and the surface rendered — the state `/ride` is in after a normal
 * handoff and resume.
 *
 * Passing `databaseName` + `sessionId` reproduces the **reload**: the journal and
 * the pointer already name a session, so nothing is started and recovery is what
 * puts the ride back (8 §13).
 */
async function harness(options: {
  readonly position?: "fresh" | "poor" | "stale" | "none";
  readonly instruction?: "turn" | "nameless" | "roundabout" | "roundabout-known-exit";
  readonly environment?: Partial<RideFocusEnvironmentSnapshot>;
  readonly pointerAt?: "session" | "nothing";
  readonly databaseName?: string;
  readonly sessionId?: RideSessionId;
  readonly placesSource?: PlacesSource;
  readonly autoResume?: boolean;
  readonly riderSettings?: RiderSettingsStoragePort;
  readonly reroutePlanner?: GuidedReroutePlanner;
  /** The engine's telemetry provider: lateral offset, live maneuver distance and the "then" pair. */
  readonly telemetry?: RideFocusTelemetryProvider;
  /** A fixed identity for the issued maneuver, so telemetry can name it. */
  readonly instructionId?: SessionInstructionId;
  /** The matcher's continuity verdict for a positioned ride; defaults to "on-route". */
  readonly offRoute?: Parameters<typeof offRouteChangedEvent>[0];
} = {}): Promise<Harness> {
  const databaseName = options.databaseName ?? freshDatabaseName();
  const repository = createRideSessionRepository({ databaseName });
  const controller = createRideSessionController({ repository, now: () => NOW });
  const fresh = options.sessionId === undefined;
  const started = fresh
    ? await controller.start({
        activity: "guided",
        rideId: RIDE_ID,
        rideRevision: 7,
        route: ROUTE,
        itinerary: [newStopId() as StopId],
        at: NOW,
      })
    : null;
  if (fresh && started?.state === null) throw new Error("the fixture session did not start");
  const sessionId = options.sessionId ?? started?.state?.sessionId;
  if (sessionId === undefined) throw new Error("the fixture session has no identity");

  const target: { sessionId: RideSessionId | null } = {
    sessionId: options.pointerAt === "nothing" ? null : sessionId,
  };
  const environment = environmentDouble(options.environment);
  const pointer = pointerDouble(target);
  let tickHandler: (() => void) | null = null;
  const store = createRideFocusStore({
    controller,
    environment: () => environment.port,
    pointer,
    readRouteLine: async () => LINE,
    now: () => NOW,
    ...(options.riderSettings === undefined ? {} : { riderSettings: options.riderSettings }),
    ...(options.reroutePlanner === undefined ? {} : { reroutePlanner: options.reroutePlanner }),
    ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
    // The store's own clock is the surface's freshness, not the test's business.
    setInterval: (handler) => {
      tickHandler = handler;
      return 1;
    },
    clearInterval: () => undefined,
  });
  await store.getState().start();
  // Recovery restores a moving session paused (8 §13); on a fresh visit this is
  // the explicit Resume a rider performs, and on a reload the test performs it
  // through the surface itself.
  if (fresh && options.autoResume !== false && store.getState().status === "ready") await store.getState().resume();

  if (options.position === "fresh") {
    await controller.dispatch(
      positionUpdatedEvent(
        {
          coordinate: { lon: -75.4385, lat: 40.1385 },
          observedAt: NOW,
          accuracyMeters: 6,
          headingDegrees: 212,
          speedMps: 14.2,
        },
        NOW,
      ),
    );
  }
  if (options.position === "poor") {
    // A current fix the device measured badly: usable, but not fresh-good.
    await controller.dispatch(
      positionUpdatedEvent(
        {
          coordinate: { lon: -75.4385, lat: 40.1385 },
          observedAt: NOW,
          accuracyMeters: 120,
          headingDegrees: 212,
          speedMps: 14.2,
        },
        NOW,
      ),
    );
  }
  if (options.position === "stale") {
    // Observed 42 s before now, *arriving* now: the event instant is current, the
    // fix is not. Conflating the two would be a timestamp regression the reducer
    // rightly refuses.
    await controller.dispatch(
      positionUpdatedEvent(
        {
          coordinate: { lon: -75.4385, lat: 40.1385 },
          observedAt: new Date(Date.parse(NOW) - 42_000).toISOString(),
          accuracyMeters: 6,
          headingDegrees: 212,
          speedMps: 14.2,
        },
        NOW,
      ),
    );
  }
  if (options.position === "fresh" || options.position === "poor" || options.position === "stale") {
    await controller.dispatch(offRouteChangedEvent(options.offRoute ?? "on-route", NOW));
  }
  if (options.instruction !== undefined) {
    const roundabout = options.instruction.startsWith("roundabout");
    const instructionId = options.instructionId ?? nextInstructionId();
    await controller.dispatch(
      instructionIssuedEvent(
        roundabout
          ? {
              instructionId,
              kind: "roundabout",
              maneuver: null,
              roadName: options.instruction === "roundabout" ? null : "PA-23",
              distanceMeters: 120,
              targetStopId: null,
              ...(options.instruction === "roundabout-known-exit" ? { exitNumber: 2 } : {}),
            }
          : {
              instructionId,
              kind: "turn",
              maneuver: "left",
              roadName: options.instruction === "turn" ? "Gravel Pike" : "  ",
              distanceMeters: 120,
              targetStopId: null,
            },
        NOW,
      ),
    );
  }
  const issuedInstructionId = controller.navigationState()?.instruction?.instructionId ?? null;
  await store.getState().setMapReady(true);

  const hosts = createStubMapHostFactory();
  render(
    <RideFocus
      store={store}
      mapHostFactory={hosts.factory}
      basemap="empty"
      {...(options.placesSource === undefined ? {} : { placesSource: options.placesSource })}
    />,
  );
  await act(async () => {
    hosts.hosts[0]?.reportStatus({ state: "ready", reason: null });
  });

  return {
    store, controller, environment, pointer, hosts, sessionId, databaseName,
    tick: () => tickHandler?.(),
    instructionId: issuedInstructionId,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("dark chrome and honest states", () => {
  it("keeps the sheet open for a moment after the initial paused recovery is resumed", async () => {
    const { store } = await harness({ autoResume: false });
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "open");

    // The rider's own tap on Resume.
    fireEvent.pointerDown(screen.getByTestId("ride-resume"));
    await act(async () => { await store.getState().resume(); });

    // The Pause the rider reaches for next is still under their finger (DV-10
    // closes the sheet on its own once they stop touching it).
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "open");
    expect(screen.getByTestId("ride-pause")).toBeVisible();
  });

  it("opens on the map when the start-of-ride pause ends by itself", async () => {
    const { store } = await harness({ autoResume: false });
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "open");

    // The planner's handoff resumes the ride; nobody touched the sheet.
    await act(async () => { await store.getState().resume(); });

    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "closed");
  });

  it("puts the unavailable GPS warning in the top card once", async () => {
    await harness({ position: "none" });
    expect(screen.getByTestId("ride-warning-gps-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("ride-guidance-state")).toHaveTextContent("No GPS fix");
    expect(screen.getByTestId("ride-gps")).not.toHaveTextContent("No GPS fix");
    expect(screen.getAllByText(/No GPS fix/)).toHaveLength(1);
  });

  it("renders the ride identity, the freshness label and unknown telemetry", async () => {
    await harness({ position: "fresh" });

    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-activity", "guided");
    expect(screen.getByTestId("ride-activity")).toHaveTextContent("Guided ride");
    expect(screen.getByTestId("ride-gps")).toHaveTextContent("Good GPS fix");
    expect(screen.getByTestId("ride-gps")).toHaveAttribute("data-tone", "good");
    expect(screen.getByTestId("ride-speed")).toHaveTextContent("32 mph");
    expect(screen.getByTestId("ride-heading")).toHaveTextContent("SW");
    // 8 §2/§5: the engine has not answered, so progress and ETA say so.
    expect(screen.getByTestId("ride-eta")).toHaveTextContent("Unknown");
    expect(screen.getByTestId("ride-remaining")).toHaveTextContent("Unknown");
    // 8 §5: the matcher has not answered, so the *known* objective is the stop
    // list and the bar stays dashed rather than claiming a fraction.
    expect(screen.getByTestId("ride-progress-text")).toHaveTextContent("Stop 0 of 1");
    expect(screen.getByTestId("ride-progress-track")).toHaveAttribute("data-known", "false");
  });

  it("shows a stale fix as stale, with no speed or heading presented as current", async () => {
    await harness({ position: "stale" });

    expect(screen.getByTestId("ride-gps")).toHaveTextContent("Stale GPS");
    expect(screen.getByTestId("ride-gps")).toHaveAttribute("data-tone", "bad");
    expect(screen.getByTestId("ride-gps")).toHaveTextContent("last fix 42 s ago");
    expect(screen.getByTestId("ride-speed")).toHaveTextContent("—");
    expect(screen.getByTestId("ride-heading")).toHaveTextContent("—");
    expect(screen.getByTestId("ride-warning-gps-stale")).toBeInTheDocument();
  });

  it("suspends ahead guidance and shows no maneuver content while the fix is stale", async () => {
    await harness({ position: "stale", instruction: "turn" });

    expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "suspended");
    expect(screen.queryByTestId("ride-maneuver-road")).not.toBeInTheDocument();
    expect(screen.getByTestId("ride-guidance-state")).toHaveTextContent("stale");
  });

  it("shows the issued maneuver, and no road line when the session named no road", async () => {
    await harness({ position: "fresh", instruction: "turn" });
    expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "maneuver");
    expect(screen.getByTestId("ride-maneuver-distance")).toHaveTextContent("400 ft");
    expect(screen.getByTestId("ride-maneuver-road")).toHaveTextContent("onto Gravel Pike");

    cleanup();
    await harness({ position: "fresh", instruction: "nameless" });
    expect(screen.queryByTestId("ride-maneuver-road")).not.toBeInTheDocument();
    expect(screen.getByTestId("ride-maneuver")).toHaveTextContent("Turn left");
  });

  it("adds a quiet then row when the following maneuver is within a mile", async () => {
    const instructionId = asSessionInstructionId("instr_then_near");
    await harness({
      position: "fresh",
      instruction: "turn",
      instructionId,
      telemetry: () => ({
        routeProgress: 0.4,
        remainingDistanceMeters: 8_000,
        remainingDurationSeconds: 900,
        etaIso: null,
        followingManeuver: {
          afterInstructionId: instructionId,
          kind: "keep-right",
          maneuver: null,
          roadName: "Ridge Road",
          distanceFromCurrentMeters: 640,
        },
      }),
    });

    expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-then", "true");
    const then = screen.getByTestId("ride-maneuver-then");
    expect(then).toHaveTextContent("Then");
    expect(then).toHaveTextContent("Keep right onto Ridge Road");
    expect(screen.getByTestId("ride-maneuver-then-glyph")).toHaveAttribute(
      "data-glyph",
      "keep-right",
    );
    // A glance, not a second instruction: the row is hidden from assistive tech
    // and creates no second live region inside the 1 Hz card.
    expect(then).toHaveAttribute("aria-hidden", "true");
    expect(then).not.toHaveAttribute("aria-live");
    expect(screen.getByTestId("ride-maneuver-then")).not.toHaveAttribute("role");
  });

  it("keeps the then row out of the card when it is far or unknown", async () => {
    const instructionId = asSessionInstructionId("instr_then_far");
    const telemetry = (gapMeters: number | null): RideFocusTelemetryProvider => () => ({
      routeProgress: 0.4,
      remainingDistanceMeters: 8_000,
      remainingDurationSeconds: 900,
      etaIso: null,
      followingManeuver:
        gapMeters === null
          ? null
          : {
              afterInstructionId: instructionId,
              kind: "turn",
              maneuver: "right",
              roadName: "Ridge Road",
              distanceFromCurrentMeters: gapMeters,
            },
    });

    await harness({ position: "fresh", instruction: "turn", instructionId, telemetry: telemetry(3_000) });
    expect(screen.queryByTestId("ride-maneuver-then")).toBeNull();
    expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-then", "false");

    cleanup();
    await harness({ position: "fresh", instruction: "turn", instructionId, telemetry: telemetry(null) });
    expect(screen.queryByTestId("ride-maneuver-then")).toBeNull();
  });

  it("badges a provider-stated roundabout exit and never invents one", async () => {
    await harness({ position: "fresh", instruction: "roundabout-known-exit" });
    expect(screen.getByTestId("ride-maneuver")).toHaveTextContent("Take the 2nd exit");
    expect(screen.getByTestId("ride-maneuver-glyph")).toHaveAttribute("data-glyph", "roundabout");
    expect(screen.getByTestId("ride-maneuver-exit")).toHaveTextContent("2");

    cleanup();
    await harness({ position: "fresh", instruction: "roundabout" });
    expect(screen.getByTestId("ride-maneuver")).toHaveTextContent("Enter the roundabout");
    expect(screen.queryByTestId("ride-maneuver-exit")).toBeNull();
  });

  it("declares the then row and the exit badge in the stylesheet", () => {
    const read = (file: string): string =>
      readFileSync(path.join(process.cwd(), "src", "app", file), "utf8");
    const ruleIn = (css: string, selector: string): string => {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };

    const globals = read("globals.css");
    const then = ruleIn(globals, ".og-ride__maneuver-then");
    // Third grid row under the action line, spanning the icon column too.
    expect(then).toMatch(/grid-column:\s*1 \/ -1/);
    expect(then).toMatch(/border-top:\s*1px solid/);
    expect(then).toMatch(/padding-top:\s*8px/);
    expect(then).toMatch(/min-height:\s*30px/);
    expect(then).toMatch(/font-size:\s*15px/);
    expect(then).toMatch(/font-weight:\s*600/);
    // Reduced motion has nothing to stop: the row appears instantly, always.
    expect(then).not.toMatch(/(animation|transition)[\w-]*\s*:/);
    // One line, ellipsised rather than wrapping the card.
    expect(ruleIn(globals, ".og-ride__maneuver-then-action")).toMatch(
      /text-overflow:\s*ellipsis/,
    );
    expect(ruleIn(globals, '.og-ride__maneuver[data-then="true"]')).toMatch(/min-height:\s*126px/);

    const exit = ruleIn(globals, ".og-ride__maneuver-exit");
    expect(exit).toMatch(/width:\s*24px/);
    expect(exit).toMatch(/height:\s*24px/);
    expect(exit).toMatch(/font-size:\s*13px/);
    expect(exit).toMatch(/font-weight:\s*800/);
    expect(exit).toMatch(/font-variant-numeric:\s*tabular-nums/);

    const glass = read("theme-glass.css");
    expect(
      ruleIn(glass, ':root[data-theme="day"] .og-ride__maneuver[data-then="true"]'),
    ).toMatch(/min-height:\s*138px/);
    expect(ruleIn(glass, ':root[data-theme="day"] .og-ride__maneuver-then')).toMatch(
      /border-top-color:\s*rgb\(255 255 255 \/ 24%\)/,
    );
    // Day badging: white disc, green numeral and ring; Night keeps paper/ink.
    expect(ruleIn(glass, ':root[data-theme="day"] .og-ride__maneuver-exit')).toMatch(
      /box-shadow:\s*0 0 0 2px #0b6b35/,
    );
  });

  it("draws the route line and the rider position into the map scene", async () => {
    const { hosts } = await harness({ position: "fresh" });

    const scene = hosts.hosts[0]?.lastScene();
    expect(scene?.mode).toBe("ride");
    expect(scene?.routes).toHaveLength(1);
    expect(scene?.routes[0]?.state).toBe("selected");
    expect(scene?.riderPosition?.confidence).toBe("good");
    expect(scene?.selectedObject).toBeNull();
  });

  it("draws the whole-ride offer preview even without a segment suggestion", async () => {
    const { store, hosts } = await harness({ position: "fresh" });
    const preview = [{ lon: -75.4, lat: 40.1 }, { lon: -75.3, lat: 40.2 }];
    act(() => store.setState({
      liveSuggestion: null,
      rideOffer: { id: "loop:45", kind: "loop", shownAt: NOW, lifetimeMs: 30000,
        summary: { title: "Curvy loop", kicker: "From here", minutes: 45, distanceMeters: 30000, chips: [], spoken: "Curvy loop" } },
      suggestionPreviewLine: preview,
    }));
    await waitFor(() => expect(hosts.hosts[0]?.lastScene()?.routes).toHaveLength(2));
    expect(hosts.hosts[0]?.lastScene()?.routes[1]?.geometry).toEqual(preview);
  });

  it("closes ride controls when the rider requests a whole-ride offer", async () => {
    const { store } = await harness({ position: "fresh" });
    const request = vi.fn();
    act(() => store.setState({
      navigation: { ...store.getState().navigation!, activity: "free" },
      suggestions: "on", rideOffersAvailable: true, requestRideOffer: request,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Show ride controls" }));
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "open");
    fireEvent.click(screen.getByTestId("ride-offer-request"));
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "closed");
  });

  it("passes enabled places into the ride map scene when a source is supplied", async () => {
    const inExtent = vi.fn(async () => ({
      availability: "available" as const,
      places: [RIDE_FOCUS_PLACE],
      fetchedAt: NOW,
      attribution: "Ride Focus source",
    }));
    const placesSource: PlacesSource = {
      id: "ride-test",
      inExtent,
      alongRoute: async () => ({
        availability: "available",
        places: [],
        fetchedAt: NOW,
        attribution: "Ride Focus source",
      }),
    };
    const { hosts } = await harness({ placesSource });
    vi.useFakeTimers();

    act(() => {
      hosts.hosts[0]?.reportViewport({ minLon: -75.5, minLat: 40, maxLon: -75.3, maxLat: 40.2 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(inExtent).toHaveBeenCalledWith(
      expect.any(Object),
      { kinds: ["happy_hour"], window: "now" },
      expect.any(AbortSignal),
    );
    expect(hosts.hosts[0]?.lastScene()?.places?.map((place) => place.id)).toContain(RIDE_FOCUS_PLACE.id);
    expect(screen.getByTestId("places-control")).toBeInTheDocument();
  });

  it("renders no places UI when a source is absent", async () => {
    const { hosts } = await harness();

    expect(screen.queryByTestId("places-control")).not.toBeInTheDocument();
    expect(screen.queryByTestId("place-card")).not.toBeInTheDocument();
    expect(hosts.hosts[0]?.lastScene()?.places).toBeUndefined();
  });
});

/**
 * Off the line: a guided ride with a real instruction, a fix the device
 * accepted, and the matcher's own lateral offset (67 m ≈ 200 ft).
 */
async function offRouteHarness(options: {
  readonly position?: "fresh" | "poor";
  readonly reroutePlanner?: GuidedReroutePlanner;
} = {}): Promise<Harness> {
  const harnessed = await harness({
    position: options.position ?? "fresh",
    instruction: "turn",
    telemetry: () => ({
      routeProgress: null,
      remainingDistanceMeters: null,
      remainingDurationSeconds: null,
      etaIso: null,
      distanceFromRouteMeters: 67,
    }),
    ...(options.reroutePlanner === undefined ? {} : { reroutePlanner: options.reroutePlanner }),
  });
  await act(async () => {
    await harnessed.controller.dispatch(offRouteChangedEvent("off-route", NOW));
    // The ride screen re-derives its frame once a second (the store's own tick).
    harnessed.tick();
  });
  return harnessed;
}

describe("off the route: the recovery is on the card (DV-10)", () => {
  it("shows how far off the line, plus Reroute now and Details, and reroutes once", async () => {
    const plan = vi.fn(async () => ({ status: "unavailable" as const, reason: "no-route" as const }));
    const { store } = await offRouteHarness({ reroutePlanner: { plan } });

    expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "suspended");
    expect(screen.getByTestId("ride-guidance-state")).toHaveTextContent("Off the route");
    // The engine's own measurement, in the maneuver card's feet/mile rule.
    expect(screen.getByTestId("ride-off-route-distance")).toHaveTextContent("200 ft off route");

    const reroute = screen.getByTestId("ride-reroute-now");
    expect(reroute).toHaveTextContent("Reroute now");
    expect(reroute).toBeEnabled();
    expect(reroute).toHaveClass("og-ride__action", "og-ride__action--primary");
    expect(screen.getByTestId("ride-off-route-details")).toHaveTextContent("Details");
    // The sheet is not needed to recover.
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "closed");

    await act(async () => {
      fireEvent.click(reroute);
    });
    await waitFor(() => expect(plan).toHaveBeenCalledTimes(1));
    // It is the store's own reroute, so its failure is the store's own copy.
    expect(store.getState().rerouteError).toContain("Keep riding toward the line");
    expect(screen.getByTestId("ride-toast")).toHaveTextContent("Keep riding toward the line");

    fireEvent.click(screen.getByTestId("ride-off-route-details"));
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "open");
  });

  it("refuses the reroute on a fix that is not fresh-good, with the reason on the button", async () => {
    const plan = vi.fn(async () => ({ status: "unavailable" as const, reason: "gps" as const }));
    await offRouteHarness({ position: "poor", reroutePlanner: { plan } });

    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-gps", "fresh-poor");
    const reroute = screen.getByTestId("ride-reroute-now");
    expect(reroute).toBeDisabled();
    expect(reroute).toHaveAttribute("title", "Rerouting needs a fresh, accurate GPS fix.");

    fireEvent.click(reroute);
    await waitFor(() => expect(reroute).toBeDisabled());
    expect(plan).not.toHaveBeenCalled();
  });

  it("keeps the card in place while a reroute is in flight, and never sends two", async () => {
    let settle: ((result: GuidedRerouteResult) => void) | null = null;
    const plan = vi.fn(() => new Promise<GuidedRerouteResult>((resolve) => {
      settle = resolve;
    }));
    const { store } = await offRouteHarness({ reroutePlanner: { plan } });

    fireEvent.click(screen.getByTestId("ride-reroute-now"));
    await waitFor(() => expect(store.getState().rerouteBusy).toBe(true));

    const reroute = screen.getByTestId("ride-reroute-now");
    expect(reroute).toHaveTextContent("Routing…");
    expect(reroute).toBeDisabled();
    expect(reroute).toHaveAttribute("aria-busy", "true");

    fireEvent.click(reroute);
    expect(plan).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle?.({ status: "unavailable", reason: "no-route" });
    });
    await waitFor(() => expect(screen.getByTestId("ride-reroute-now")).toHaveTextContent("Reroute now"));
  });

  it("offers the distance but no recovery controls when the ride cannot reroute at all", async () => {
    await offRouteHarness();

    expect(screen.getByTestId("ride-off-route-distance")).toHaveTextContent("200 ft off route");
    expect(screen.queryByTestId("ride-off-route-actions")).toBeNull();
  });

  it("adds neither the distance nor the controls to a different suspension", async () => {
    await harness({ autoResume: false, telemetry: () => ({
      routeProgress: null,
      remainingDistanceMeters: null,
      remainingDurationSeconds: null,
      etaIso: null,
      distanceFromRouteMeters: 67,
    }) });

    expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "suspended");
    expect(screen.queryByTestId("ride-off-route-distance")).toBeNull();
    expect(screen.queryByTestId("ride-off-route-actions")).toBeNull();
  });
});

/** The real projection of a recording session, so the surface sees what the app produces. */
function recordingViewModel(
  store: ReturnType<typeof createRideFocusStore>,
  overrides: Partial<SessionNavigationState> = {},
  input: {
    readonly telemetry?: RideFocusTelemetryInput | null;
    readonly recordingTelemetry?: RecordingTelemetry | null;
  } = {},
) {
  const navigation = {
    ...store.getState().navigation!,
    recordingId: asRecordingId("rec_indicator"),
    ...overrides,
  };
  return {
    navigation,
    viewModel: buildRideFocusViewModel({
      navigation,
      environment: { locationPermission: "granted", wakeLock: "active", speech: "ready" },
      telemetry: input.telemetry ?? null,
      recordingSummary: { distanceMeters: 12_874, elapsedSeconds: 1_872, movingSeconds: 1_440, pointCount: 640 },
      recordingTelemetry: input.recordingTelemetry ?? null,
      now: NOW,
    }),
  };
}

describe("recording from the map screen", () => {
  it("turns the sheet toggle into a recording indicator with a spoken elapsed time", async () => {
    const { store } = await harness({ position: "fresh" });
    const { navigation, viewModel } = recordingViewModel(store);
    act(() => store.setState({ navigation, viewModel }));

    const toggle = screen.getByTestId("ride-strip");
    expect(toggle).toHaveAttribute("data-recording", "true");
    // The elapsed time is visible text, and it is also what a screen reader hears.
    expect(screen.getByTestId("ride-rec-time")).toHaveTextContent("31:12");
    expect(toggle).toHaveTextContent("REC");
    expect(toggle).toHaveAccessibleName("Recording, 31 minutes 12 seconds. Show ride controls.");

    // Still the sheet toggle it always was.
    fireEvent.click(toggle);
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "open");
    expect(toggle).toHaveAccessibleName("Recording, 31 minutes 12 seconds. Hide ride controls.");
  });

  it("keeps the plain chevron when nothing is being recorded", async () => {
    await harness({ position: "fresh" });

    const toggle = screen.getByTestId("ride-strip");
    expect(toggle).not.toHaveAttribute("data-recording");
    expect(toggle).toHaveAccessibleName("Show ride controls");
    expect(toggle).not.toHaveTextContent("REC");
    expect(screen.queryByTestId("ride-rec-time")).toBeNull();
  });

  it("returns to the finished ride's summary once the ride is terminal", async () => {
    const { store } = await harness({ position: "fresh" });
    const { navigation, viewModel } = recordingViewModel(store, {
      activity: "completed",
      endedAt: NOW,
      endReason: "completed",
    });
    act(() => store.setState({ navigation, viewModel }));

    expect(screen.getByTestId("ride-terminal")).toHaveTextContent("Recorded ride saved");
    const strip = screen.getByTestId("ride-strip");
    expect(strip).toHaveClass("og-ride__strip-summary");
    expect(strip).toHaveTextContent("Recorded ride saved");
    expect(screen.queryByTestId("ride-rec-time")).toBeNull();
  });
});

describe("the post-ride summary (08 §13)", () => {
  const RIDE: RecordingTelemetry = {
    ...EMPTY_RECORDING_TELEMETRY,
    acceptedDistanceMeters: 12_874,
    movingMs: 24 * 60_000,
    maxSpeedMps: 22.352,
    elevation: { currentMeters: 120, sampledAtMs: 0, gainMeters: 300, lossMeters: 280, sampleCount: 200 },
  };

  function finishedRecording(store: ReturnType<typeof createRideFocusStore>, fraction: number | null) {
    return recordingViewModel(
      store,
      { activity: "completed", endedAt: NOW, endReason: "completed" },
      {
        telemetry: {
          routeProgress: fraction,
          remainingDistanceMeters: null,
          remainingDurationSeconds: null,
          etaIso: null,
        },
        recordingTelemetry: RIDE,
      },
    );
  }

  it("shows the ride's shape above its numbers, and one obvious next action", async () => {
    const { store } = await harness({ position: "fresh" });
    const { navigation, viewModel } = finishedRecording(store, 0.5);
    act(() => store.setState({ navigation, viewModel }));

    const card = screen.getByTestId("ride-terminal");
    const sketch = screen.getByTestId("ride-route-sketch");
    expect(card).toContainElement(sketch);
    expect(sketch).toHaveAttribute("role", "img");
    expect(sketch).toHaveAttribute("data-split", "known");
    // The label says what is known: the ridden distance and how far along the
    // route the engine placed the rider. The route's total is not on this
    // surface, so it is not invented for the sentence.
    expect(sketch).toHaveAccessibleName("Route sketch: 8.0 mi ridden, 50% along the route.");

    // The sketch is above the stats, and the stats keep their own grid.
    const summary = screen.getByTestId("ride-summary");
    expect(sketch.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 432 s of standing still is a sixth stat, from the summary's two clocks.
    expect(screen.getByTestId("ride-summary-stopped")).toHaveTextContent("Stopped");
    expect(screen.getByTestId("ride-summary-stopped")).toHaveTextContent("7");
    expect(summary.querySelectorAll(".og-ride__summary-stat")).toHaveLength(6);

    // My rides leads, and the way back to the planner is the surface's own link.
    const rides = screen.getByTestId("ride-summary-rides");
    expect(rides).toHaveAttribute("href", "/rides");
    expect(rides).toHaveClass("og-ride__action");
    expect(rides).toHaveTextContent("View in My rides");
    const exits = screen.getAllByTestId("ride-exit");
    expect(exits).toHaveLength(1);
    expect(exits[0]).toHaveClass("og-ride__action");
    expect(exits[0]).toHaveTextContent("Back to the planner");
  });

  it("draws the route alone when the engine never said how far along the rider got", async () => {
    const { store } = await harness({ position: "fresh" });
    const { navigation, viewModel } = finishedRecording(store, null);
    act(() => store.setState({ navigation, viewModel }));

    const sketch = screen.getByTestId("ride-route-sketch");
    expect(sketch).toHaveAttribute("data-split", "unknown");
    expect(sketch.querySelectorAll(".og-ride__sketch-line--travelled")).toHaveLength(0);
    expect(sketch).toHaveAccessibleName("Route sketch: 8.0 mi ridden.");
  });

  it("omits the sketch, and only the sketch, when there is no route line", async () => {
    const { store } = await harness({ position: "fresh" });
    const { navigation, viewModel } = finishedRecording(store, 0.5);
    act(() => store.setState({ navigation, viewModel, routeLine: [], routeLineAvailable: false }));

    expect(screen.queryByTestId("ride-route-sketch")).not.toBeInTheDocument();
    expect(screen.getByTestId("ride-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("ride-line-unavailable")).not.toBeInTheDocument();
  });

  it("offers My rides only when the recording actually landed there", async () => {
    // A guided ride finished without a recording: nothing is in My rides, so the
    // card does not send the rider to an empty library.
    await harness({ position: "fresh" });
    fireEvent.click(screen.getByTestId("ride-stop"));
    fireEvent.click(screen.getByTestId("ride-finish"));
    await waitFor(() => expect(screen.getByTestId("ride-terminal")).toHaveTextContent("Ride finished"));

    expect(screen.queryByTestId("ride-summary-rides")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("ride-exit")).toHaveLength(1);
    // The route line is still there, so the shape of the ride is drawn; nothing
    // is claimed about how much of it was covered.
    expect(screen.getByTestId("ride-route-sketch")).toHaveAttribute("data-split", "unknown");
    expect(screen.queryByTestId("ride-summary")).not.toBeInTheDocument();
  });

  it("draws the sketch in the ride's own tokens, at the size it was designed, with no motion", () => {
    const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const rule = (selector: string): string => {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(rule(".og-ride__sketch")).toMatch(/max-width:\s*320px/);
    expect(rule(".og-ride__sketch-line")).toMatch(/stroke-width:\s*4/);
    expect(rule(".og-ride__sketch-line--travelled")).toMatch(/stroke:\s*var\(--og-ember\)/);
    expect(rule(".og-ride__sketch-line--remaining")).toMatch(
      /color-mix\(in srgb, var\(--og-topo-sage\) 45%, transparent\)/,
    );
    // The sketch appears with the card and never animates (12 §15).
    expect(css).not.toMatch(/\.og-ride__sketch[^{]*\{[^}]*(animation|transition)/);
  });
});

describe("device failures are visible and non-blocking (08 §3, §7, §8)", () => {
  it("keeps the session controllable when location is blocked", async () => {
    const { environment, store } = await harness({
      position: "none",
      environment: { locationPermission: "denied" },
    });

    expect(screen.getByTestId("ride-warning-location-denied")).toHaveTextContent(
      "Location is blocked",
    );
    // 8 §3: Retry / Finish / Discard, and the ride still runs.
    expect(screen.getByTestId("ride-retry-location")).toBeEnabled();
    expect(screen.getByTestId("ride-stop")).toBeEnabled();
    expect(screen.getByTestId("ride-pause")).toBeEnabled();

    fireEvent.click(screen.getByTestId("ride-retry-location"));
    await waitFor(() => expect(environment.permissionRequests).toBe(1));

    fireEvent.click(screen.getByTestId("ride-stop"));
    expect(screen.getByTestId("ride-stop-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("ride-finish")).toBeEnabled();
    expect(screen.getByTestId("ride-discard")).toBeEnabled();
    fireEvent.click(screen.getByTestId("ride-keep-riding"));
    expect(store.getState().stopConfirm).toBe(false);
  });

  it("surfaces a wake-lock failure without blocking anything", async () => {
    await harness({ position: "fresh", environment: { wakeLock: "failed" } });

    expect(screen.getByTestId("ride-warning-wake-lock")).toHaveTextContent(
      "couldn't be kept awake",
    );
    expect(screen.getByTestId("ride-pause")).toBeEnabled();
    expect(screen.queryByTestId("ride-terminal")).not.toBeInTheDocument();
  });

  it("surfaces an unsupported wake lock with the guidance it implies", async () => {
    await harness({ position: "fresh", environment: { wakeLock: "unsupported" } });

    expect(screen.getByTestId("ride-warning-wake-lock")).toHaveTextContent(
      "can't keep the screen awake",
    );
  });

  it("surfaces a speech failure without blocking anything", async () => {
    await harness({ position: "fresh", environment: { speech: "failed" } });

    expect(screen.getByTestId("ride-warning-speech")).toHaveTextContent(
      "Voice announcements failed",
    );
    expect(screen.getByTestId("ride-pause")).toBeEnabled();
  });

  it("asks for the wake lock while the ride moves and releases it on pause", async () => {
    const { environment, store } = await harness({ position: "fresh" });

    expect(environment.rideActiveCalls).toContain(true);
    await act(async () => {
      await store.getState().pause();
    });
    expect(environment.rideActiveCalls[environment.rideActiveCalls.length - 1]).toBe(false);
  });
});

describe("reload, resume and stop (08 §2, §13)", () => {
  it("restores a reloaded ride paused, and requires an explicit Resume", async () => {
    // First visit: start a ride and leave the surface (the store's own stop).
    const first = await harness({ position: "fresh" });
    const before = first.controller.snapshot();
    expect(before?.activity).toBe("guided");
    act(() => {
      first.store.getState().stop();
    });
    cleanup();

    // The reload: a brand-new controller and store over the same journal, with
    // the pointer still naming the session.
    const restored = await harness({
      databaseName: first.databaseName,
      sessionId: first.sessionId,
    });

    expect(screen.getByTestId("ride-status")).toHaveTextContent("Ride restored");
    expect(screen.getByTestId("ride-status")).toHaveTextContent("paused");
    expect(screen.getByTestId("ride-resume")).toBeInTheDocument();
    expect(screen.queryByTestId("ride-pause")).not.toBeInTheDocument();
    // The restored session is the same one, still moving nothing: 8 §13 requires
    // the rider's explicit resume, never an automatic one.
    expect(restored.controller.snapshot()?.sessionId).toBe(first.sessionId);
    expect(restored.controller.snapshot()?.activity).toBe("paused");
    // Its retained fix is fresh here because the fixture clock is fixed; what the
    // surface shows about it is derived, never stored.
    expect(screen.getByTestId("ride-gps")).toHaveTextContent("Good GPS fix");

    fireEvent.click(screen.getByTestId("ride-resume"));
    await waitFor(() => expect(screen.getByTestId("ride-pause")).toBeInTheDocument());
    expect(restored.controller.snapshot()?.activity).toBe("guided");
    // The rider's own first command dismisses the recovery note: it is a
    // statement about the state they just left.
    expect(screen.queryByTestId("ride-status")).not.toBeInTheDocument();
  });

  it("finishes the ride through the two-step stop, and clears the pointer", async () => {
    const { store, controller, pointer } = await harness({ position: "fresh" });

    fireEvent.click(screen.getByTestId("ride-stop"));
    expect(screen.getByTestId("ride-stop-confirm")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ride-finish"));
    await waitFor(() => expect(screen.getByTestId("ride-terminal")).toBeInTheDocument());

    expect(screen.getByTestId("ride-terminal")).toHaveTextContent("Ride finished");
    expect(controller.snapshot()?.endReason).toBe("completed");
    expect(pointer.clears).toBe(1);
    expect(store.getState().stopConfirm).toBe(false);
  });

  it("tells a discarded ride apart from a finished one", async () => {
    const { controller } = await harness({ position: "fresh" });

    fireEvent.click(screen.getByTestId("ride-stop"));
    fireEvent.click(screen.getByTestId("ride-discard"));
    await waitFor(() => expect(screen.getByTestId("ride-terminal")).toBeInTheDocument());

    expect(screen.getByTestId("ride-terminal")).toHaveTextContent("Ride discarded");
    expect(controller.snapshot()?.endReason).toBe("abandoned");
  });

  it("offers an honest empty state when no session is recorded", async () => {
    await harness({ pointerAt: "nothing" });

    // No session is not a failure: the screen says so, keeps the app's own frame
    // (the tab bar every other surface has) and offers the action that starts a
    // ride. `Try again` used to retry a load that had nothing to load.
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-status", "absent");
    expect(screen.getByTestId("ride-recovery")).toHaveTextContent("No ride in progress");
    // The card is the same empty-state one My rides opens with, and the app's
    // own bar (the bottom tab bar on a phone) is around it.
    expect(screen.getByTestId("ride-recovery").closest(".og-empty-state")).not.toBeNull();
    expect(screen.getByTestId("primary-nav")).toBeInTheDocument();
    const plan = screen.getByRole("link", { name: "Plan a ride" });
    expect(plan).toHaveAttribute("href", "/");
    expect(screen.queryByTestId("ride-retry-recovery")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("keeps Try again for a ride that could not be opened", async () => {
    const { store } = await harness({ pointerAt: "nothing" });

    act(() => {
      store.setState({ status: "unavailable", statusMessage: null });
    });

    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-status", "unavailable");
    expect(screen.getByTestId("ride-retry-recovery")).toHaveTextContent("Try again");
    // Retrying is the point here, so the empty state's invitation is not shown.
    expect(screen.queryByTestId("ride-plan-ride")).not.toBeInTheDocument();
  });

  it("stays minimal once a ride is running: no tab bar in ride mode", async () => {
    await harness({ position: "fresh" });

    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-status", "ready");
    expect(screen.queryByTestId("primary-nav")).not.toBeInTheDocument();
  });
});

describe("camera (08 §2, DV-10)", () => {
  it("follows the rider heading-up on the first good fix, and hands the camera back on a pan", async () => {
    const { store, hosts } = await harness({ position: "fresh" });
    const host = hosts.hosts[0];

    await waitFor(() => expect(store.getState().follow).toBe(true));
    await waitFor(() => expect(host?.follows.length).toBeGreaterThan(0));
    const camera = host?.follows.at(-1);
    // Street level, tilted, and turned to the road ahead.
    expect(camera?.zoom).toBeGreaterThanOrEqual(15);
    expect(camera?.pitch).toBeGreaterThan(0);
    expect(camera?.bearing).not.toBeNull();
    // Following: no Re-center on screen.
    expect(screen.queryByTestId("ride-recenter")).not.toBeInTheDocument();

    act(() => {
      host?.emit({ type: "camera-changed" });
    });
    expect(store.getState()).toMatchObject({ follow: false, cameraHeld: true, rideCamera: null });
    expect(screen.getByTestId("ride-recenter")).toBeVisible();
  });

  it("keeps the rider's own zoom or pan until they ask for a view again", async () => {
    const { store, hosts } = await harness({ position: "fresh" });
    const host = hosts.hosts[0];
    await waitFor(() => expect(store.getState().follow).toBe(true));

    act(() => {
      host?.emit({ type: "camera-changed" });
    });
    expect(store.getState()).toMatchObject({ follow: false, cameraHeld: true });
    const fitsWhileHeld = host?.fits.length ?? 0;
    const followsWhileHeld = host?.follows.length ?? 0;
    // A HUD that re-renders while the rider holds the camera must not re-frame it.
    act(() => {
      store.setState({ rerouteMessage: "New route · 3 mi to go" });
    });
    expect(host?.fits.length).toBe(fitsWhileHeld);
    expect(host?.follows.length).toBe(followsWhileHeld);

    fireEvent.click(screen.getByTestId("ride-recenter"));
    expect(store.getState()).toMatchObject({ follow: true, cameraHeld: false });
    await waitFor(() => expect(host?.follows.length).toBeGreaterThan(followsWhileHeld));
    expect(screen.queryByTestId("ride-recenter")).not.toBeInTheDocument();
  });

  it("snaps back to following 10 s after the rider's last pan", async () => {
    const { store, hosts } = await harness({ position: "fresh" });
    const host = hosts.hosts[0];
    await waitFor(() => expect(store.getState().follow).toBe(true));

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      act(() => {
        host?.emit({ type: "camera-changed" });
      });
      act(() => {
        vi.advanceTimersByTime(6_000);
        host?.emit({ type: "camera-changed" });
      });
      act(() => {
        vi.advanceTimersByTime(6_000);
      });
      // Only 6 s since the last touch: still the rider's.
      expect(store.getState().follow).toBe(false);
      act(() => {
        vi.advanceTimersByTime(4_500);
      });
      expect(store.getState()).toMatchObject({ follow: true, cameraHeld: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no Re-center without a position", async () => {
    const { store } = await harness({ position: "none" });

    expect(store.getState().viewModel?.controls.recenter).toEqual({
      enabled: false,
      reason: "There is no position to center on yet.",
    });
    expect(screen.queryByTestId("ride-recenter")).not.toBeInTheDocument();
  });
});

describe("route progress on the map (08 §5)", () => {
  const progress = (routeProgress: number): RideFocusTelemetryProvider => () => ({
    routeProgress,
    remainingDistanceMeters: 1_200,
    remainingDurationSeconds: 240,
    etaIso: null,
  });

  it("dims the part of the line already ridden and keeps the road ahead bright", async () => {
    const { hosts } = await harness({ position: "fresh", telemetry: progress(0.5) });

    await waitFor(() => {
      const scene = hosts.hosts[0]?.lastScene();
      expect(scene?.routes.map((route) => route.state)).toEqual(["selected", "travelled"]);
    });
    const routes = hosts.hosts[0]?.lastScene()?.routes ?? [];
    const ridden = routes.find((route) => route.state === "travelled")?.geometry ?? [];
    const ahead = routes.find((route) => route.state === "selected")?.geometry ?? [];
    // Half of the fixture line, and the two halves meet where the rider is.
    expect(ridden[0]).toEqual(LINE[0]);
    expect(ridden.at(-1)?.lon).toBeCloseTo(-75.43, 3);
    expect(ahead[0]).toEqual(ridden.at(-1));
    expect(ahead.at(-1)).toEqual(LINE.at(-1));
  });

  it("never splits on a progress answer the matcher is not standing behind", async () => {
    // A stale fix has no current progress to draw: the whole line stays ahead.
    const stale = await harness({ position: "stale", telemetry: progress(0.5) });
    await waitFor(() => expect(stale.hosts.hosts[0]?.lastScene()).not.toBeNull());
    expect(stale.hosts.hosts[0]?.lastScene()?.routes).toHaveLength(1);

    // The same fraction with the matcher off the line is not progress along it.
    const off = await harness({ position: "fresh", telemetry: progress(0.5), offRoute: "off-route" });
    await waitFor(() => expect(off.hosts.hosts[0]?.lastScene()).not.toBeNull());
    expect(off.hosts.hosts[0]?.lastScene()?.routes).toHaveLength(1);
    expect(off.hosts.hosts[0]?.lastScene()?.routes[0]?.state).toBe("selected");
  });
});

describe("12 §10 touch targets", () => {
  it("gives every primary control the 56 px hit-area class", async () => {
    await harness({ position: "fresh" });

    for (const id of [
      "ride-pause",
      "ride-stop",
      "ride-exit",
    ]) {
      expect(screen.getByTestId(id)).toHaveClass("og-ride__action");
    }
  });

  it("declares the 56 px hit area and the dark chrome in the stylesheet", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src", "app", "globals.css"),
      "utf8",
    );
    const rule = (selector: string): string => {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };

    const action = rule(".og-ride__action");
    expect(action).toMatch(/min-height:\s*56px/);
    expect(action).toMatch(/min-width:\s*56px/);
    // DV-10: the strip's end button and Re-center are glove-sized too.
    const end = rule(".og-ride__strip-end");
    expect(end).toMatch(/width:\s*56px/);
    expect(end).toMatch(/height:\s*56px/);
    expect(rule(".og-ride__recenter")).toMatch(/min-height:\s*56px/);

    // 12 §3: Ride Focus is dark chrome in day and night, not a themed surface.
    const ride = rule(".og-ride");
    expect(ride).toMatch(/background:\s*var\(--og-ink\)/);
    expect(ride).toMatch(/color:\s*var\(--og-paper\)/);
    expect(ride).not.toMatch(/prefers-color-scheme/);
  });

  it("gives the off-route card and the recording indicator their own fixed geometry", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src", "app", "globals.css"),
      "utf8",
    );
    const rule = (selector: string, from = 0): string => {
      const start = css.indexOf(`${selector} {`, from);
      expect(start).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };

    // The suspended card grew a row of recovery controls; the box stays fixed
    // so nothing re-lays out under a thumb at speed.
    const suspended = rule('.og-ride__maneuver[data-kind="suspended"]');
    expect(suspended).toMatch(/min-height:\s*124px/);
    // Landscape: the same row at 116 px.
    const landscape = rule('.og-ride__maneuver[data-kind="suspended"]', css.lastIndexOf('.og-ride__maneuver[data-kind="suspended"] {'));
    expect(landscape).toMatch(/min-height:\s*116px/);

    // Both recovery controls are 56 px, side by side.
    const row = rule(".og-ride__off-route-actions");
    expect(row).toMatch(/display:\s*flex/);
    // The recording indicator keeps the sheet toggle's 56×56 target.
    const toggle = rule(".og-ride-metrics__toggle");
    expect(toggle).toMatch(/width:\s*56px/);
    expect(toggle).toMatch(/height:\s*56px/);
    // No pulse in either theme: a dot beside a counting clock is the signal, so
    // there is nothing for `prefers-reduced-motion` to stop.
    const recording = rule('.og-ride-metrics__toggle[data-recording="true"]');
    expect(recording).not.toMatch(/animation|transition/);
    expect(rule(".og-ride__off-route-distance")).toMatch(/font-size:\s*15px/);
  });
});

/** An in-memory RiderSettings port that records every save. */
function settingsDouble(initial: RiderSettings = createRiderSettings()): RiderSettingsStoragePort & {
  readonly saved: RiderSettings[];
} {
  let current = initial;
  const saved: RiderSettings[] = [];
  return {
    saved,
    read: () => current,
    write: (next): void => {
      current = next;
      saved.push(next);
    },
    clear: (): void => {
      current = createRiderSettings();
    },
  };
}

describe("the instrument strip (RIDE-INSTRUMENT-STRIP §2, §15, §17.8)", () => {
  it("shows exactly three readouts, each a real button, with the guided defaults", async () => {
    await harness({ position: "fresh" });
    const strip = screen.getByTestId("ride-metric-strip");
    const slots = strip.querySelectorAll("button");
    expect(slots).toHaveLength(3);
    expect(strip).toHaveAttribute("data-mode", "guided");
    expect(strip).toHaveAttribute("data-preset", "navigate");
    expect(screen.getByTestId("ride-metric-slot-0")).toHaveAttribute("data-metric", "speed.current");
    expect(screen.getByTestId("ride-metric-value-0")).toHaveTextContent("32");
    // The fixture engine has not answered, so the route readouts wait: a dash, never 0.
    expect(screen.getByTestId("ride-metric-value-1")).toHaveTextContent("—");
    expect(screen.getByTestId("ride-metric-slot-1")).toHaveAttribute("data-state", "waiting");
    expect(screen.getByTestId("ride-metric-slot-0")).toHaveAccessibleName(
      "Speed, 32 miles per hour. Show ride controls.",
    );
  });

  it("drops the speed bubble while a readout shows speed, and keeps it otherwise", async () => {
    await harness({
      position: "fresh",
      riderSettings: settingsDouble({
        ...createRiderSettings(),
        uiPreferences: { ...createRiderSettings().uiPreferences, rideMetrics: ["route.eta", "heading", "route.progress"] },
      }),
    });
    expect(screen.getByTestId("ride-speed-bubble")).toBeInTheDocument();
    cleanup();
    await harness({ position: "fresh" });
    expect(screen.queryByTestId("ride-speed-bubble")).toBeNull();
  });

  it("opens the sheet, never a picker, when a readout is tapped while moving", async () => {
    await harness({ position: "fresh" });
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "closed");
    fireEvent.click(screen.getByTestId("ride-metric-slot-1"));
    expect(screen.queryByTestId("ride-metric-picker")).toBeNull();
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "open");
    expect(screen.getByTestId("ride-metrics-hint")).toHaveTextContent("when you're stopped");
  });

  it("refuses a slot change from the store while moving", async () => {
    const settings = settingsDouble();
    const { store } = await harness({ position: "fresh", riderSettings: settings });
    expect(store.getState().setRideMetric(1, "route.eta")).toBe(false);
    expect(store.getState().applyRideMetricPreset("navigate")).toBe(false);
    expect(settings.saved).toHaveLength(0);
  });

  it("changes one readout from the picker while paused, saves it and announces it", async () => {
    const settings = settingsDouble();
    await harness({ autoResume: false, riderSettings: settings });
    expect(screen.getByTestId("ride-metric-strip")).toHaveAttribute("data-customizable", "true");

    fireEvent.click(screen.getByTestId("ride-metric-slot-1"));
    const picker = screen.getByRole("dialog", { name: /Readout 2/ });
    expect(picker).toBeInTheDocument();
    // Presets first, then metrics by category; nothing slice A cannot back.
    expect(screen.getByTestId("ride-metric-preset-navigate")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("ride-metric-option-context.smart")).toBeNull();
    expect(screen.getByTestId("ride-metric-option-route.distanceRemaining")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("ride-metric-option-route.eta"));
    expect(screen.queryByTestId("ride-metric-picker")).toBeNull();
    expect(screen.getByTestId("ride-metric-slot-1")).toHaveAttribute("data-metric", "route.eta");
    // Only that slot changed.
    expect(screen.getByTestId("ride-metric-slot-0")).toHaveAttribute("data-metric", "speed.current");
    expect(screen.getByTestId("ride-metric-slot-2")).toHaveAttribute("data-metric", "route.timeRemaining");
    expect(screen.getByTestId("ride-metric-strip")).toHaveAttribute("data-preset", "custom");
    expect(settings.saved.at(-1)?.uiPreferences.rideMetrics).toEqual(["speed.current", "route.eta", "route.timeRemaining"]);
    expect(screen.getByTestId("ride-metric-announcement")).toHaveTextContent("Readout 2 now shows Arrival.");
    expect(screen.getByTestId("ride-metric-slot-1")).toHaveFocus();
  });

  it("applies a preset over all three readouts", async () => {
    const settings = settingsDouble({
      ...createRiderSettings(),
      uiPreferences: { ...createRiderSettings().uiPreferences, rideMetrics: ["heading", "route.eta", "route.progress"] },
    });
    await harness({ autoResume: false, riderSettings: settings });
    expect(screen.getByTestId("ride-metric-strip")).toHaveAttribute("data-preset", "custom");
    fireEvent.click(screen.getByTestId("ride-metric-slot-0"));
    fireEvent.click(screen.getByTestId("ride-metric-preset-navigate"));
    expect(screen.getByTestId("ride-metric-strip")).toHaveAttribute("data-preset", "navigate");
    expect(settings.saved.at(-1)?.uiPreferences.rideMetrics).toEqual([
      "speed.current",
      "route.distanceRemaining",
      "route.timeRemaining",
    ]);
  });

  it("closes the picker on Escape without a change", async () => {
    const settings = settingsDouble();
    await harness({ autoResume: false, riderSettings: settings });
    fireEvent.click(screen.getByTestId("ride-metric-slot-2"));
    fireEvent.keyDown(screen.getByTestId("ride-metric-picker"), { key: "Escape" });
    expect(screen.queryByTestId("ride-metric-picker")).toBeNull();
    expect(settings.saved).toHaveLength(0);
  });

  it("closes an open picker by itself once the rider is moving", async () => {
    const { store, controller } = await harness({ autoResume: false });
    fireEvent.click(screen.getByTestId("ride-metric-slot-0"));
    expect(screen.getByTestId("ride-metric-picker")).toBeInTheDocument();
    await act(async () => {
      await store.getState().resume();
      await controller.dispatch(
        positionUpdatedEvent(
          { coordinate: { lon: -75.4385, lat: 40.1385 }, observedAt: NOW, accuracyMeters: 6, headingDegrees: 212, speedMps: 14.2 },
          NOW,
        ),
      );
      await store.getState().setMapReady(true);
    });
    expect(screen.getByTestId("ride-metric-strip")).toHaveAttribute("data-customizable", "false");
    expect(screen.queryByTestId("ride-metric-picker")).toBeNull();
  });

  it("keeps the rider's choice across a reload", async () => {
    const settings = settingsDouble();
    const first = await harness({ autoResume: false, riderSettings: settings });
    fireEvent.click(screen.getByTestId("ride-metric-slot-2"));
    fireEvent.click(screen.getByTestId("ride-metric-option-heading"));
    cleanup();
    first.store.getState().stop();

    await harness({ databaseName: first.databaseName, sessionId: first.sessionId, riderSettings: settings });
    expect(screen.getByTestId("ride-metric-slot-2")).toHaveAttribute("data-metric", "heading");
  });

  it("gives the readouts, the toggle and the picker options glove-sized targets", () => {
    const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const rule = (selector: string): string => {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(rule(".og-ride-metrics__slot")).toMatch(/min-height:\s*56px/);
    expect(rule(".og-ride-metrics__toggle")).toMatch(/height:\s*56px/);
    expect(rule(".og-ride-metric-picker__option")).toMatch(/min-height:\s*52px/);
    expect(rule(".og-ride-metrics__value")).toMatch(/tabular-nums/);
    // §2.4: no animation on the strip at all, so reduced motion has nothing to stop.
    const block = css.slice(css.indexOf("Ride instrument strip"), css.indexOf("The right-hand rail"));
    expect(block).not.toMatch(/^\s*(animation|transition)[\w-]*\s*:/m);
  });
});
