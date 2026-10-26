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

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RideFocusEnvironmentPort,
  RideFocusEnvironmentSnapshot,
} from "@/application/ride-session/ports/ride-focus-environment";
import type { MapHostFactory } from "@/application/map/map-host";
import type { MapLayersSource } from "@/application/map-layers";
import type { PlaceSearchPort } from "@/application/geocoding/place-search";
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
  /** What the map was told to draw, when the stub advertises a night look. */
  readonly nightLooks: readonly ("map" | "night")[];
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
  /** Advertise a night look on the stub renderer and record what the map asks it for. */
  readonly nightLook?: boolean;
  /** The instant this whole fixture lives at; the shared NOW unless a test needs dusk. */
  readonly at?: string;
  /** The rider's map layers: gas along the route, and the Free Ride's nearby search. */
  readonly mapLayersSource?: MapLayersSource;
  /** The app's own place search, for "search along this ride". */
  readonly placeSearch?: PlaceSearchPort;
  /** The active bike's usable range, for the ride sheet's "next gas" line. */
  readonly usableRangeMiles?: number | null;
} = {}): Promise<Harness> {
  const instant = options.at ?? NOW;
  const databaseName = options.databaseName ?? freshDatabaseName();
  const repository = createRideSessionRepository({ databaseName });
  const controller = createRideSessionController({ repository, now: () => instant });
  const fresh = options.sessionId === undefined;
  const started = fresh
    ? await controller.start({
        activity: "guided",
        rideId: RIDE_ID,
        rideRevision: 7,
        route: ROUTE,
        itinerary: [newStopId() as StopId],
        at: instant,
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
    now: () => instant,
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
          observedAt: instant,
          accuracyMeters: 6,
          headingDegrees: 212,
          speedMps: 14.2,
        },
        instant,
      ),
    );
  }
  if (options.position === "poor") {
    // A current fix the device measured badly: usable, but not fresh-good.
    await controller.dispatch(
      positionUpdatedEvent(
        {
          coordinate: { lon: -75.4385, lat: 40.1385 },
          observedAt: instant,
          accuracyMeters: 120,
          headingDegrees: 212,
          speedMps: 14.2,
        },
        instant,
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
          observedAt: new Date(Date.parse(instant) - 42_000).toISOString(),
          accuracyMeters: 6,
          headingDegrees: 212,
          speedMps: 14.2,
        },
        instant,
      ),
    );
  }
  if (options.position === "fresh" || options.position === "poor" || options.position === "stale") {
    await controller.dispatch(offRouteChangedEvent(options.offRoute ?? "on-route", instant));
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
        instant,
      ),
    );
  }
  const issuedInstructionId = controller.navigationState()?.instruction?.instructionId ?? null;
  await store.getState().setMapReady(true);

  const hosts = createStubMapHostFactory();
  const nightLooks: ("map" | "night")[] = [];
  const mapHostFactory: MapHostFactory = options.nightLook === true
    ? (container, hostOptions) =>
        Object.assign(hosts.factory(container, hostOptions), {
          supportsNightLook: true,
          setBasemapLook: (look: "map" | "night"): void => {
            nightLooks.push(look);
          },
        })
    : hosts.factory;
  render(
    <RideFocus
      store={store}
      mapHostFactory={mapHostFactory}
      basemap="empty"
      {...(options.placesSource === undefined ? {} : { placesSource: options.placesSource })}
      {...(options.mapLayersSource === undefined ? {} : { mapLayersSource: options.mapLayersSource })}
      {...(options.placeSearch === undefined ? {} : { placeSearch: options.placeSearch })}
      {...(options.usableRangeMiles === undefined ? {} : { usableRangeMiles: options.usableRangeMiles })}
    />,
  );
  await act(async () => {
    hosts.hosts[0]?.reportStatus({ state: "ready", reason: null });
  });

  return {
    store, controller, environment, pointer, hosts, sessionId, databaseName, nightLooks,
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
    expect(screen.getByTestId("ride-gps")).toHaveTextContent("Finding GPS");
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
    // Before the first on-route fix the whole route's length is what is left: a
    // number, never "Unknown" while a route exists.
    expect(screen.getByTestId("ride-remaining")).not.toHaveTextContent("Unknown");
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
    expect(screen.getByTestId("ride-guidance-state")).toHaveTextContent("Waiting for a GPS fix");
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
    // v2 §1: the ride's second line is the page's body size, not a sixth size.
    expect(then).toMatch(/font-size:\s*var\(--og-text-body\)/);
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
    expect(exit).toMatch(/font-size:\s*var\(--og-text-caption\)/);
    expect(exit).toMatch(/font-weight:\s*800/);
    expect(exit).toMatch(/font-variant-numeric:\s*tabular-nums/);

    const glass = read("theme-glass.css");
    expect(
      ruleIn(glass, ':root[data-theme="day"] .og-ride__maneuver[data-then="true"]'),
    ).toMatch(/min-height:\s*126px/);
    expect(ruleIn(glass, ':root[data-theme="day"] .og-ride__maneuver-then')).toMatch(
      /border-top-color:\s*rgb\(255 255 255 \/ 24%\)/,
    );
    // Day badging: white disc, green numeral and ring; Night keeps paper/ink.
    expect(ruleIn(glass, ':root[data-theme="day"] .og-ride__maneuver-exit')).toMatch(
      /box-shadow:\s*0 0 0 2px #0b6b35/,
    );
  });

  it("keeps a disabled ride action's label readable in the day theme", () => {
    const read = (file: string): string =>
      readFileSync(path.join(process.cwd(), "src", "app", file), "utf8");
    const ruleIn = (css: string, selector: string): string => {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };

    const glass = read("theme-glass.css");
    // Day paints the ride white, and the primary action's text with it. Both are
    // kept above the disabled rule on purpose: that pair is what made a disabled
    // "Reroute now" / "Routing…" an empty white pill beside "Details".
    expect(ruleIn(glass, ':root[data-theme="day"] .og-ride .og-ride__action--primary')).toMatch(
      /color:\s*#ffffff/,
    );
    const disabled = ruleIn(glass, ':root[data-theme="day"] .og-ride .og-ride__action:disabled');
    expect(disabled).toMatch(/color:\s*var\(--og-ride-muted\)/);
    expect(disabled).toMatch(/background:\s*var\(--og-ride-surface\)/);
    // Day declares those two as ink-ish text on the white ride surface, so the
    // label is painted, not white on white.
    const dayBlock = glass.slice(glass.indexOf(':root[data-theme="day"] .og-ride {'));
    const day = dayBlock.slice(0, dayBlock.indexOf("}"));
    expect(day).toMatch(/--og-ride-muted:\s*#3a4540/);
    expect(day).toMatch(/--og-raised-dark:\s*#ffffff/);
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
  it("says the way back, shows how far off, offers one New route from here, and reroutes once", async () => {
    const plan = vi.fn(async () => ({ status: "unavailable" as const, reason: "no-route" as const }));
    const { store } = await offRouteHarness({ reroutePlanner: { plan } });

    expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "suspended");
    // The same card says what to do next, in plain words: no heading is known
    // here, so it names the road and never guesses left or right.
    expect(screen.getByTestId("ride-guidance-state")).toHaveTextContent(/^Head back to /);
    expect(screen.queryByText(/Off the route/)).toBeNull();
    // The engine's own measurement, in the maneuver card's feet/mile rule.
    expect(screen.getByTestId("ride-off-route-distance")).toHaveTextContent("200 ft off route");

    const reroute = screen.getByTestId("ride-reroute-now");
    expect(reroute).toHaveTextContent("New route from here");
    expect(reroute).toBeEnabled();
    expect(reroute).toHaveClass("og-ride__action", "og-ride__action--primary");
    // One action: no second button on the card.
    expect(screen.getByTestId("ride-off-route-actions").querySelectorAll("button")).toHaveLength(1);
    expect(screen.queryByTestId("ride-off-route-details")).toBeNull();
    // The sheet is not needed to recover.
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "closed");

    await act(async () => {
      fireEvent.click(reroute);
    });
    await waitFor(() => expect(plan).toHaveBeenCalledTimes(1));
    // It is the store's own reroute, so its failure is the store's own copy.
    expect(store.getState().rerouteError).toContain("Keep riding toward the line");
    // The card carries the failure itself; there is no second banner.
    expect(screen.getByTestId("ride-off-route-distance")).toHaveTextContent("Keep riding toward the line");
    expect(screen.queryByTestId("ride-toast")).toBeNull();
  });

  it("never raises the ride-changed-elsewhere banner: it keeps riding and offers the newer version quietly", async () => {
    const plan = vi.fn(async () => ({ status: "unavailable" as const, reason: "stale-ride" as const }));
    const { store } = await offRouteHarness({ reroutePlanner: { plan } });

    fireEvent.click(screen.getByTestId("ride-reroute-now"));
    await waitFor(() => expect(plan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.getState().newerVersionReady).toBe(true));

    expect(screen.queryByText(/changed on another screen/i)).toBeNull();
    expect(screen.queryByText(/Return to Plan/i)).toBeNull();
    expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "suspended");
    // The sheet has the quiet row.
    const row = screen.getByTestId("ride-newer-version");
    expect(row).toHaveTextContent("A newer version of this ride is ready");
    expect(within(row).getByRole("link", { name: "Switch", hidden: true })).toBeInTheDocument();
  });

  it("refuses the reroute on a fix that is not fresh-good, with the reason on the button", async () => {
    const plan = vi.fn(async () => ({ status: "unavailable" as const, reason: "gps" as const }));
    await offRouteHarness({ position: "poor", reroutePlanner: { plan } });

    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-gps", "fresh-poor");
    const reroute = screen.getByTestId("ride-reroute-now");
    expect(reroute).toBeDisabled();
    // Disabled is not blank: the label stays, and the day theme paints it (see
    // the stylesheet test below) instead of white on the white disabled pill.
    expect(reroute).toHaveTextContent("New route from here");
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
    await waitFor(() => expect(screen.getByTestId("ride-reroute-now")).toHaveTextContent("New route from here"));
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
  it("names the recording on one line above the readouts, and speaks the elapsed time", async () => {
    const { store } = await harness({ position: "fresh" });
    const { navigation, viewModel } = recordingViewModel(store);
    act(() => store.setState({ navigation, viewModel }));

    // The screen itself carries the state, so the strip's size follows it.
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-recording", "true");
    const strip = screen.getByTestId("ride-strip-bar");
    expect(strip).toHaveAttribute("data-recording", "true");

    // One line: a small danger dot and the word. No badge, no second clock.
    const state = screen.getByTestId("ride-recording-state");
    expect(state).toHaveTextContent("Recording");
    expect(state.querySelector(".og-ride__recording-state-dot")).not.toBeNull();
    expect(state).not.toHaveTextContent("REC");
    // The elapsed time is not a second number on screen; it is what a screen
    // reader hears after the word.
    expect(state).toHaveTextContent("31 minutes 12 seconds");
    expect(screen.queryByTestId("ride-rec-time")).toBeNull();

    // The readouts keep their own row, so nothing squeezes a 24 px figure.
    expect(strip.querySelectorAll(".og-ride-metrics__slot")).toHaveLength(3);

    // And the chevron is still the sheet toggle it always was.
    const toggle = screen.getByTestId("ride-menu");
    expect(toggle).toHaveAccessibleName("Show ride controls");
    fireEvent.click(toggle);
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "open");
    expect(toggle).toHaveAccessibleName("Hide ride controls");
  });

  it("says nothing about recording when nothing is being recorded", async () => {
    await harness({ position: "fresh" });

    expect(screen.getByTestId("ride-focus")).not.toHaveAttribute("data-recording");
    const strip = screen.getByTestId("ride-strip-bar");
    const toggle = screen.getByTestId("ride-menu");
    expect(strip).not.toHaveAttribute("data-recording");
    expect(toggle).toHaveAccessibleName("Show ride controls");
    expect(screen.queryByTestId("ride-recording-state")).toBeNull();
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
    // The recording is over: the state line goes with the readouts.
    expect(screen.queryByTestId("ride-recording-state")).toBeNull();
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
    // Four headline numbers, in the order a rider says them: distance, time,
    // top speed, climb. They are the card; nothing else competes with them.
    expect(summary.querySelectorAll(".og-ride__summary-stat")).toHaveLength(4);
    expect(
      Array.from(summary.querySelectorAll(".og-ride__summary dt")).map((label) => label.textContent),
    ).toEqual(["Distance", "Moving time", "Top speed", "Climb"]);
    expect(screen.getByTestId("ride-summary-max")).toHaveTextContent("50");
    expect(screen.getByTestId("ride-summary-climb")).toHaveTextContent("984");
    // 432 s of standing still, and the average, are one quiet line under them —
    // both still from the summary's own clocks, never invented.
    const meta = screen.getByTestId("ride-summary-meta");
    expect(meta).toHaveTextContent("Avg speed 20 mph");
    expect(screen.getByTestId("ride-summary-stopped")).toHaveTextContent("Stopped");
    expect(screen.getByTestId("ride-summary-stopped")).toHaveTextContent("7");

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

  it("turns the map from the compass, which appears only while the map is rotated or north-up", async () => {
    const { store, hosts } = await harness({ position: "fresh" });
    const host = hosts.hosts[0];
    if (host === undefined) throw new Error("the ride created no map host");
    await waitFor(() => expect(store.getState().follow).toBe(true));

    // Pointing up the road: nothing to turn back, so no compass on screen.
    act(() => {
      host.reportCamera({ bearing: 0, zoom: 16, minZoom: 0, maxZoom: 22, metersPerPixel: 9 });
    });
    expect(screen.queryByTestId("ride-compass")).toBeNull();

    act(() => {
      host.reportCamera({ bearing: 212, zoom: 16, minZoom: 0, maxZoom: 22, metersPerPixel: 9 });
    });
    const headingUp = host.follows.at(-1)?.bearing ?? null;
    expect(headingUp).not.toBeNull();

    // North-up re-issues the follow frame, so this is the same reading the next
    // fix would produce: the map turns.
    fireEvent.click(screen.getByTestId("ride-compass"));
    const northUp = host.follows.at(-1);
    expect(store.getState().northUp).toBe(true);
    expect(northUp?.bearing).toBe(0);
    // The arrow still points up the road: the direction of travel is not the
    // direction the screen is turned.
    expect(host.lastScene()?.riderPosition?.heading).toBe(headingUp);

    expect(screen.getByTestId("ride-compass")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("ride-compass")).toHaveAccessibleName("North up");
    // North-up with a straight map keeps the compass, so heading-up is one tap away.
    act(() => {
      host.reportCamera({ bearing: 0, zoom: 16, minZoom: 0, maxZoom: 22, metersPerPixel: 9 });
    });
    fireEvent.click(screen.getByTestId("ride-compass"));
    expect(store.getState().northUp).toBe(false);
    expect(host.follows.at(-1)?.bearing).toBe(headingUp);
  });

  it("still turns a map the rider has panned, where no follow frame will", async () => {
    const { store, hosts } = await harness({ position: "fresh" });
    const host = hosts.hosts[0];
    await waitFor(() => expect(store.getState().follow).toBe(true));

    act(() => {
      host?.emit({ type: "camera-changed" });
    });
    expect(store.getState().follow).toBe(false);

    act(() => {
      host?.reportCamera({ bearing: 40, zoom: 16, minZoom: 0, maxZoom: 22, metersPerPixel: 9 });
    });
    fireEvent.click(screen.getByTestId("ride-compass"));
    expect(host?.northResets).toBe(1);
    expect(store.getState().northUp).toBe(true);
  });

  it("has no + / - zoom on touch: the map zooms by pinch", async () => {
    await harness({ position: "fresh" });
    expect(screen.queryByTestId("ride-zoom-in")).toBeNull();
    expect(screen.queryByTestId("ride-zoom-out")).toBeNull();
    // The planner map's own column (compass, + / -) is hidden on the ride screen.
    const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const at = css.indexOf(".og-ride__map .og-map__cluster");
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/display:\s*none/);
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

describe("round 2: starting off route, the paused card, music, the menu button", () => {
  it("shows the whole route's distance and arrival while the ride starts off the line, never a dash", async () => {
    await harness({
      position: "fresh",
      instruction: "turn",
      offRoute: "off-route",
      telemetry: () => ({
        routeProgress: null,
        remainingDistanceMeters: null,
        remainingDurationSeconds: null,
        etaIso: null,
        distanceFromRouteMeters: 67,
      }),
    });
    await waitFor(() => expect(screen.getByTestId("ride-metric-value-1").textContent).not.toBe("—"));
    expect(screen.getByTestId("ride-metric-value-1").textContent).toMatch(/^\d/);
  });

  it("opens the sheet from the Menu button, found by its test id", async () => {
    await harness({ position: "fresh" });
    const menu = screen.getByTestId("ride-menu");
    expect(menu).toHaveTextContent("Menu");
    fireEvent.click(menu);
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "open");
  });

  it("a paused ride is one compact card with Resume, and no second status pill", async () => {
    const { store } = await harness({ position: "fresh", instruction: "turn" });
    await act(async () => {
      await store.getState().pause();
    });
    await waitFor(() => expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "suspended"));
    expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-compact", "true");
    expect(screen.getByTestId("ride-guidance-state")).toHaveTextContent("Ride paused");
    expect(screen.getByTestId("ride-card-resume")).toHaveTextContent("Resume");
    expect(screen.queryByTestId("ride-toast")).toBeNull();
  });
});

describe("the strip and the sheet while riding a route (ride overhaul)", () => {
  const HELD = {
    routeProgress: 0.5,
    remainingDistanceMeters: 4_800,
    remainingDurationSeconds: 600,
    etaIso: "2026-09-21T14:10:00.000Z",
  };

  it("keeps the last known distance left and arrival while off the route, never a dash", async () => {
    let offset: number | null = null;
    const { tick, controller } = await harness({
      position: "fresh",
      instruction: "turn",
      telemetry: () => ({ ...HELD, distanceFromRouteMeters: offset }),
    });
    expect(screen.getByTestId("ride-metric-slot-1")).toHaveAttribute("data-metric", "route.distanceRemaining");
    expect(screen.getByTestId("ride-metric-slot-2")).toHaveAttribute("data-metric", "route.eta");
    expect(screen.getByTestId("ride-metric-value-1")).toHaveTextContent("3.0");
    const arrival = screen.getByTestId("ride-metric-value-2").textContent;
    expect(arrival).toMatch(/^\d{1,2}:\d{2}$/);

    offset = 67;
    await act(async () => {
      await controller.dispatch(offRouteChangedEvent("off-route", NOW));
      tick();
    });
    expect(screen.getByTestId("ride-maneuver")).toHaveAttribute("data-kind", "suspended");
    expect(screen.getByTestId("ride-metric-value-1")).toHaveTextContent("3.0");
    expect(screen.getByTestId("ride-metric-value-2").textContent).not.toBe("—");
    expect(screen.getByTestId("ride-metric-value-2").textContent).toMatch(/^\d{1,2}:\d{2}$/);
  });

  it("End ride in the sheet goes to the finish question; Keep riding comes back", async () => {
    const { store } = await harness({ position: "fresh" });
    fireEvent.click(screen.getByTestId("ride-menu"));
    const end = screen.getByTestId("ride-stop");
    expect(end).toHaveTextContent("End ride");
    expect(end).toBeVisible();
    fireEvent.click(end);
    expect(store.getState().stopConfirm).toBe(true);
    expect(screen.getByTestId("ride-stop-confirm")).toBeVisible();
    expect(screen.getByTestId("ride-finish")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ride-keep-riding"));
    expect(store.getState().stopConfirm).toBe(false);
  });

  it("Cancel route keeps riding as Free Ride on the same session", async () => {
    const { store, controller } = await harness({ position: "fresh" });
    const sessionId = controller.snapshot()?.sessionId;
    fireEvent.click(screen.getByTestId("ride-menu"));
    const cancel = screen.getByTestId("continue-free-ride");
    expect(cancel).toHaveTextContent("Cancel route");
    expect(cancel).toHaveTextContent("Keep riding as Free Ride");
    await act(async () => {
      fireEvent.click(cancel);
    });
    await waitFor(() => expect(store.getState().navigation?.activity).toBe("free"));
    // Same session, nothing thrown away; there is no route left to cancel.
    expect(controller.snapshot()?.sessionId).toBe(sessionId);
    expect(screen.queryByTestId("continue-free-ride")).toBeNull();
  });

  it("offers Cancel route only on a guided ride, never on Free Ride", async () => {
    const { store } = await harness({ position: "fresh" });
    await act(async () => {
      await store.getState().continueFreeRide();
    });
    await waitFor(() => expect(store.getState().navigation?.activity).toBe("free"));
    expect(screen.queryByTestId("continue-free-ride")).toBeNull();
    expect(screen.getByTestId("ride-stop")).toHaveTextContent("End ride");
  });

  it("keeps the off-route card compact with one 56 px action", () => {
    const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const rule = (selector: string): string => {
      const start = css.lastIndexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(rule('.og-ride__maneuver[data-kind="suspended"][data-compact="true"] .og-ride__off-route-action')).toMatch(/min-height:\s*56px/);
    // Title is the page's 20 px headline, 700; the card has no fixed tall minimum.
    const title = rule('.og-ride__maneuver[data-kind="suspended"][data-compact="true"] .og-ride__maneuver-suspended');
    expect(title).toMatch(/font-size:\s*var\(--og-text-headline\)/);
    expect(title).toMatch(/font-weight:\s*700/);
    expect(rule('.og-ride__maneuver[data-kind="suspended"][data-compact="true"]')).toMatch(/min-height:\s*0/);
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
      "ride-exit",
    ]) {
      expect(screen.getByTestId(id)).toHaveClass("og-ride__action");
    }
    // The sheet's rows are the same glove size.
    expect(screen.getByTestId("ride-stop")).toHaveClass("og-ride__sheet-row");
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
    // The off-route recovery's labels are the page's body size, not 15 px.
    expect(action).toMatch(/font-size:\s*var\(--og-text-body\)/);
    // DV-10: the strip's exit button and the sheet's rows are glove-sized too.
    const end = rule(".og-ride__strip-end");
    expect(end).toMatch(/width:\s*56px/);
    expect(end).toMatch(/height:\s*56px/);
    expect(rule(".og-ride__sheet-row")).toMatch(/min-height:\s*56px/);
    // DV-10's glove rail: 56 px round buttons, spaced so a thumb cannot reach two.
    const rail = rule(".og-ride__rail-button");
    expect(rail).toMatch(/width:\s*56px/);
    expect(rail).toMatch(/height:\s*56px/);
    expect(rule(".og-ride__rail")).toMatch(/gap:\s*12px/);
    // The compass needle is the map's rotation, drawn in the theme's own ink.
    expect(rule(".og-ride__compass-needle")).toMatch(/rotate\(calc\(var\(--og-bearing/);

    // 12 §3: Ride Focus is dark chrome in day and night, not a themed surface.
    const ride = rule(".og-ride");
    expect(ride).toMatch(/background:\s*var\(--og-ink\)/);
    expect(ride).toMatch(/color:\s*var\(--og-paper\)/);
    expect(ride).not.toMatch(/prefers-color-scheme/);
  });

  it("follows the sun on Auto: dusk darkens the screen and the map, without storing a choice", async () => {
    // 02:00Z at the fixture's own coordinate: the sun set hours ago.
    const { hosts, store } = await harness({
      position: "fresh",
      nightLook: true,
      at: "2026-09-22T02:00:00.000Z",
    });

    expect(store.getState().sunlight).toBe("night");
    expect(document.documentElement.dataset["theme"]).toBe("night");
    // The map opens in the same night rather than turning a frame later.
    expect(hosts.options.at(-1)?.basemapLook).toBe("night");
    // The sun is a fact about now, not a choice: Auto is still what is stored.
    expect(window.localStorage.getItem("og-appearance")).toBeNull();
    expect(screen.getByTestId("ride-display-auto")).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the phone's own theme in daylight, and never decides it from the clock hour alone", async () => {
    // The shared fixture instant is late morning at the same coordinate.
    const { store } = await harness({ position: "fresh" });
    expect(store.getState().sunlight).toBe("day");
    expect(screen.getByTestId("ride-display-auto")).toHaveAttribute("aria-pressed", "true");
  });

  it("turns the screen Day or Night from the sheet, with Auto following the sun", async () => {
    await harness({ position: "fresh" });

    expect(screen.getByTestId("ride-display")).toHaveAccessibleName("Screen");
    expect(screen.getByTestId("ride-display-auto")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("ride-display-night"));
    expect(document.documentElement.dataset["theme"]).toBe("night");
    expect(screen.getByTestId("ride-display-night")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("ride-display-day"));
    expect(document.documentElement.dataset["theme"]).toBe("day");

    // Back to the device's own choice, so this file leaves no mode behind.
    fireEvent.click(screen.getByTestId("ride-display-auto"));
    expect(screen.getByTestId("ride-display-auto")).toHaveAttribute("aria-pressed", "true");
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
    // The sheet toggle keeps its 56×56 target.
    const toggle = rule(".og-ride-metrics__toggle");
    expect(toggle).toMatch(/width:\s*56px/);
    expect(toggle).toMatch(/height:\s*56px/);
    // Recording is one line above the readouts, and the strip is taller by
    // exactly that line so nothing stacked over it moves onto it.
    expect(rule('.og-ride[data-recording="true"]')).toMatch(
      /--og-ride-strip-live-h:\s*calc\(var\(--og-ride-strip-h\)\s*\+\s*20px\)/,
    );
    expect(rule(".og-ride__strip")).toMatch(/height:\s*var\(--og-ride-strip-live-h\)/);
    expect(rule(".og-ride__recording-state")).toMatch(/height:\s*18px/);
    expect(rule(".og-ride__recording-state-dot")).toMatch(/background:\s*var\(--og-danger-light\)/);
    // No pulse in either theme: a dot beside a word is the signal, so there is
    // nothing for `prefers-reduced-motion` to stop.
    expect(rule(".og-ride__recording-state")).not.toMatch(/animation|transition/);
    // The measured offset is the page's body size (design system v2 §1).
    expect(rule(".og-ride__off-route-distance")).toMatch(/font-size:\s*var\(--og-text-body\)/);
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
    // The fixture engine has not answered, so the distance left is the whole
    // route's length (never a dash, never 0).
    expect(screen.getByTestId("ride-metric-value-1")).not.toHaveTextContent("—");
    expect(screen.getByTestId("ride-metric-value-1").textContent).toMatch(/^\d/);
    expect(screen.getByTestId("ride-metric-slot-0")).toHaveAccessibleName(
      "Speed, 32 miles per hour. Show ride controls.",
    );
  });

  it("shows the whole route's length, not 0 left, when off the route reads the ride's finish", async () => {
    // Off the line the matcher projects onto the nearest point of a loop, which
    // can be the closing miles: the strip showed "0.0 mi / 0 min" 900 ft off
    // route on a ride that was nowhere near done.
    await harness({
      position: "fresh",
      offRoute: "off-route",
      telemetry: () => ({
        routeProgress: 1,
        remainingDistanceMeters: 0,
        remainingDurationSeconds: 0,
        etaIso: NOW,
        distanceFromRouteMeters: 275,
      }),
    });

    expect(screen.getByTestId("ride-off-route-distance")).toHaveTextContent("900 ft off route");
    // Not "0.0" (the finish the matcher projected) and not a dash: the route's own length.
    expect(screen.getByTestId("ride-metric-value-1").textContent).toMatch(/^\d/);
    expect(screen.getByTestId("ride-metric-value-1")).not.toHaveTextContent(/^0(\.0)?$/);
    expect(screen.getByTestId("ride-remaining")).not.toHaveTextContent("Unknown");
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

    fireEvent.click(screen.getByTestId("ride-metric-option-route.timeRemaining"));
    expect(screen.queryByTestId("ride-metric-picker")).toBeNull();
    expect(screen.getByTestId("ride-metric-slot-1")).toHaveAttribute("data-metric", "route.timeRemaining");
    // Only that slot changed.
    expect(screen.getByTestId("ride-metric-slot-0")).toHaveAttribute("data-metric", "speed.current");
    expect(screen.getByTestId("ride-metric-slot-2")).toHaveAttribute("data-metric", "route.eta");
    expect(screen.getByTestId("ride-metric-strip")).toHaveAttribute("data-preset", "custom");
    expect(settings.saved.at(-1)?.uiPreferences.rideMetrics).toEqual(["speed.current", "route.timeRemaining", "route.eta"]);
    expect(screen.getByTestId("ride-metric-announcement")).toHaveTextContent("Readout 2 now shows Time left.");
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
      "route.eta",
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
    // The ride tier is 56 px (12 §10); the picker is part of the ride.
    expect(rule(".og-ride-metric-picker__option")).toMatch(/min-height:\s*56px/);
    expect(rule(".og-ride-metrics__value")).toMatch(/tabular-nums/);
    // §2.4: no animation on the strip at all, so reduced motion has nothing to stop.
    const block = css.slice(css.indexOf("Ride instrument strip"), css.indexOf("The right-hand rail"));
    expect(block).not.toMatch(/^\s*(animation|transition)[\w-]*\s*:/m);
  });
});


describe("Free Ride recording controls", () => {
  it("keeps the Free Ride sheet controls available during a recording without opening the sheet", async () => {
    const { store } = await harness({ position: "fresh" });
    const projected = recordingViewModel(store, { activity: "free", plan: { ...store.getState().navigation!.plan, route: null } });
    act(() => store.setState({ ...projected, suggestions: "on" }));
    expect(screen.getByTestId("ride-focus")).toHaveAttribute("data-sheet", "closed");
    expect(screen.getByTestId("free-ride-controls")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show ride controls" }));
    expect(screen.getByTestId("free-ride-controls")).toBeVisible();
    expect(screen.getByTestId("free-ride-suggestions-toggle")).toBeVisible();
    expect(screen.getByRole("button", { name: "Head Home" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Loop from here" })).toBeVisible();
    // The recording row says what the press does; its switch says it is on.
    const recordingToggle = screen.getByTestId("free-ride-recording-toggle");
    expect(recordingToggle).toHaveTextContent("Stop recording");
    expect(recordingToggle.querySelector(".og-ride__switch")).toHaveAttribute("data-on", "true");
    // No sentence explains the controls; the one line left is the consequence
    // of turning the track off.
    expect(screen.getByText("Turning recording off discards the track.")).toBeVisible();
  });

  it("says what a press does when nothing is being recorded, and hides the discard note", async () => {
    const { store } = await harness({ position: "fresh" });
    const base = store.getState().navigation!;
    const navigation = { ...base, activity: "free" as const, plan: { ...base.plan, route: null } };
    const viewModel = buildRideFocusViewModel({
      navigation,
      environment: { locationPermission: "granted", wakeLock: "active", speech: "ready" },
      suggestions: "on",
      now: NOW,
    });
    act(() => store.setState({ navigation, viewModel, suggestions: "on" }));
    fireEvent.click(screen.getByRole("button", { name: "Show ride controls" }));

    const recordingToggle = screen.getByTestId("free-ride-recording-toggle");
    expect(recordingToggle).toHaveTextContent("Record this ride");
    expect(recordingToggle.querySelector(".og-ride__switch")).toHaveAttribute("data-on", "false");
    // The suggestions switch still reports its own state to assistive tech.
    expect(screen.getByTestId("free-ride-suggestions-toggle")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Turning recording off discards the track.")).not.toBeInTheDocument();
  });

  it("searches from where the rider is, orders by distance and Go navigates there", async () => {
    const places = [
      {
        id: "fixture:far-cafe",
        label: "Far Cafe, PA",
        name: "Far Cafe",
        context: "Carbon County, PA",
        coordinate: { lon: -75.3, lat: 40.3 },
        provider: "fixture",
      },
      {
        id: "fixture:near-cafe",
        label: "Near Cafe, PA",
        name: "Near Cafe",
        context: "Carbon County, PA",
        coordinate: { lon: -75.43, lat: 40.15 },
        provider: "fixture",
      },
    ];
    const search: PlaceSearchPort = {
      search: vi.fn(async () => ({ status: "ok" as const, places })),
      reverse: vi.fn(async () => null),
    };
    const { store } = await harness({ position: "fresh", placeSearch: search });
    const base = store.getState().navigation!;
    const navigation = { ...base, activity: "free" as const, plan: { ...base.plan, route: null } };
    const viewModel = buildRideFocusViewModel({
      navigation,
      environment: { locationPermission: "granted", wakeLock: "active", speech: "ready" },
      suggestions: "on",
      now: NOW,
    });
    const navigateTo = vi.fn(async () => undefined);
    act(() => store.setState({ navigation, viewModel, suggestions: "on", navigateTo }));
    fireEvent.click(screen.getByRole("button", { name: "Show ride controls" }));

    fireEvent.click(screen.getByTestId("ride-stop-search"));
    // The chip is a quick search, biased to where the rider is.
    fireEvent.click(screen.getByTestId("ride-stop-coffee"));
    expect(search.search).toHaveBeenCalledWith("coffee shop", expect.objectContaining({ bias: { lon: -75.4385, lat: 40.1385 } }));

    const list = await screen.findByTestId("ride-stop-results");
    const rows = within(list).getAllByTestId("ride-stop-option");
    expect(rows[0]?.textContent).toContain("Near Cafe");
    // Free Ride has no line to measure along, so the distance reads as "away".
    expect(rows[0]?.textContent).toMatch(/ mi away/);
    expect(rows[1]?.textContent).toContain("Far Cafe");

    fireEvent.click(rows[0]!);
    const confirm = await screen.findByTestId("ride-stop-confirm");
    expect(confirm.textContent).toContain("Near Cafe");
    fireEvent.click(screen.getByTestId("ride-stop-confirm-go"));
    expect(navigateTo).toHaveBeenCalledWith({ coordinate: { lon: -75.43, lat: 40.15 }, label: "Near Cafe" });
    expect(screen.queryByTestId("ride-stop-search-field")).toBeNull();
  });

  it("offers to save an unrecorded summary and links to My rides after saving", async () => {
    const { store } = await harness({ position: "fresh" });
    const finish = vi.fn(async () => undefined);
    act(() => store.setState({ canSaveFreeRideSummary: true, stopConfirm: true, finish }));
    // Save is the card's one obvious action.
    const save = screen.getByTestId("ride-finish");
    expect(save).toHaveTextContent("Save summary");
    expect(save).toHaveClass("og-ride__action--primary");
    fireEvent.click(save);
    expect(finish).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Finish without saving" }));
    expect(finish).toHaveBeenLastCalledWith(false);
    const navigation = { ...store.getState().navigation!, activity: "completed" as const, endedAt: NOW, endReason: "completed" as const };
    const viewModel = buildRideFocusViewModel({ navigation, environment: { locationPermission: "granted", wakeLock: "active", speech: "ready" }, now: NOW });
    act(() => store.setState({ navigation, viewModel, savedSummaryRideId: RIDE_ID }));
    expect(screen.getByText("Free Ride summary saved")).toBeVisible();
    expect(screen.getByRole("link", { name: "View in My rides" })).toHaveAttribute("href", "/rides");
  });
});

describe("the ride screen's number scale and controls (small-screen design system v2 §5)", () => {
  const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };

  it("reads the maneuver and the street at their own sizes, not a sixth guess", () => {
    const root = rule(".og-ride");
    // The ride scale lives once, on the ride root: 34 px for the distance and
    // 24 px for a readout, with the unit on the page's 12 px caption size.
    expect(root).toMatch(/--og-ride-text-maneuver:\s*34px/);
    expect(root).toMatch(/--og-ride-text-readout:\s*24px/);

    const distance = rule(".og-ride__maneuver-distance");
    expect(distance).toMatch(/font-size:\s*var\(--og-ride-text-maneuver\)/);
    expect(distance).toMatch(/font-weight:\s*700/);
    expect(distance).toMatch(/tabular-nums/);

    const street = rule(".og-ride__maneuver-action");
    expect(street).toMatch(/font-size:\s*var\(--og-text-headline\)/);
    expect(street).toMatch(/font-weight:\s*700/);
    // A long road name wraps instead of being clamped away.
    expect(street).not.toMatch(/-webkit-line-clamp/);
    expect(street).not.toMatch(/text-overflow/);

    expect(rule(".og-ride-metrics__value")).toMatch(/font-size:\s*var\(--og-ride-text-readout\)/);
    expect(rule(".og-ride-metrics__value")).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(rule(".og-ride-metrics__unit")).toMatch(/font-size:\s*var\(--og-text-caption\)/);
  });

  it("never clips a readout: the value is shown whole, number and unit on one line, caption one line", () => {
    const reading = rule(".og-ride-metrics__reading");
    expect(reading).toMatch(/overflow:\s*visible/);
    // "47 mph", never stacked.
    expect(reading).toMatch(/flex-direction:\s*row/);
    expect(reading).not.toMatch(/text-overflow/);

    const caption = rule(".og-ride-metrics__caption");
    expect(caption).toMatch(/white-space:\s*nowrap/);
    expect(caption).toMatch(/font-size:\s*var\(--og-text-caption\)/);
    expect(caption).not.toMatch(/text-overflow/);

    // The only step-down is the seven-character clock, and it lands on the page
    // headline size rather than a number nobody can read.
    const long = rule('.og-ride-metrics__reading[data-long="true"] .og-ride-metrics__value');
    expect(long).toMatch(/font-size:\s*var\(--og-text-headline\)/);

    // Every readout rule is on a token: no raw font sizes left in this block.
    for (const selector of [
      ".og-ride-metrics__value",
      ".og-ride-metrics__unit",
      ".og-ride-metrics__caption",
    ]) {
      expect(rule(selector)).not.toMatch(/font-size:\s*\d/);
    }
  });

  it("keeps one right-hand control column of at most three 56 px buttons, with no red X", async () => {
    const rail = rule(".og-ride__rail-button");
    expect(rail).toMatch(/width:\s*56px/);
    expect(rail).toMatch(/height:\s*56px/);

    await harness({ position: "fresh" });
    const column = screen.getByRole("group", { name: "Map and voice" });
    const buttons = within(column).getAllByRole("button");
    expect(buttons.length).toBeLessThanOrEqual(3);
    for (const button of buttons) expect(button).toHaveClass("og-ride__rail-button");
    // The old unlabeled red X is gone; the end of the ride is a named row in the sheet.
    expect(screen.queryByTestId("ride-end")).toBeNull();
    expect(screen.queryByRole("button", { name: "End this ride" })).toBeNull();
    expect(screen.getByTestId("ride-stop")).toHaveTextContent("End ride");
    // The strip holds readouts and the labelled menu button only; nothing beside
    // them squeezes a 24 px reading below the width it needs.
    const strip = screen.getByTestId("ride-menu").closest(".og-ride__strip");
    expect(strip).not.toBeNull();
    expect(strip?.querySelectorAll(".og-ride-metrics__slot")).toHaveLength(3);
    expect(strip?.querySelector(".og-ride__strip-end")).toBeNull();
    expect(screen.getByTestId("ride-menu")).toHaveTextContent("Menu");
  });

  it("leaves the map full-bleed, with the card and the strip floating over it", () => {
    const map = rule(".og-ride__map");
    expect(map).toMatch(/position:\s*absolute/);
    expect(map).toMatch(/inset:\s*0/);
    // The chrome is overlays, not a layout that shrinks the map, and the strip
    // is sized to its 56 px content (56 + 10 padding + 2 border).
    expect(rule(".og-ride")).toMatch(/--og-ride-strip-h:\s*68px/);
    expect(rule(".og-ride__strip")).toMatch(/position:\s*absolute/);
  });
});

/**
 * "Next gas" on the ride (maps-for-riders §5): the sheet's fuel line is built on
 * the gas the ride already prefetches along its own route, not a second search,
 * and its one button routes through the ride's own reroute command (§1: the map
 * never edits the ride by itself).
 */
describe("next gas on the ride", () => {
  function fuelLayers(): MapLayersSource {
    return {
      load: vi.fn(async () => ({ features: [], unavailable: [] })),
      trafficTileUrl: null,
      along: vi.fn(async (_line, layerId) =>
        layerId === "fuel"
          ? {
              available: true,
              stops: [
                {
                  feature: {
                    id: "osm:node/42",
                    layerId: "fuel" as const,
                    name: "Sheetz",
                    detail: null,
                    weight: null,
                    geometry: { type: "Point" as const, coordinates: [-75.42, 40.11] as const },
                  },
                  alongMeters: 2_600,
                  offMeters: 20,
                },
              ],
            }
          : { available: true, stops: [] },
      ),
    };
  }

  it("reads the next station off the ride's own fuel prefetch", async () => {
    const layers = fuelLayers();
    await harness({ position: "fresh", mapLayersSource: layers, usableRangeMiles: 120 });
    expect(await screen.findByTestId("ride-fuel-line")).toHaveTextContent(/^Next gas \d+ mi · Sheetz$/);
    // One along-route call per layer for the whole ride, not one per tick.
    const fuelCalls = (layers.along as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      ([, layerId]) => layerId === "fuel",
    );
    expect(fuelCalls).toHaveLength(1);
    expect(screen.queryByTestId("ride-fuel-add-stop")).toBeNull();
  });

  it("adds the station as a stop through the ride's reroute, and only when pressed", async () => {
    const plan = vi.fn(async () => ({ status: "unavailable" as const, reason: "no-route" as const }));
    await harness({
      position: "fresh",
      mapLayersSource: fuelLayers(),
      usableRangeMiles: 1,
      telemetry: () => ({
        routeProgress: 0,
        remainingDistanceMeters: 2_600,
        remainingDurationSeconds: 300,
        etaIso: null,
      }),
      reroutePlanner: { plan },
    });

    const line = await screen.findByTestId("ride-fuel-line");
    expect(line.textContent).toMatch(/^Gas: \d+ mi to next station — range left ~\d+ mi$/);
    expect(plan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("ride-fuel-add-stop"));
    await waitFor(() => expect(plan).toHaveBeenCalled());
    expect(plan).toHaveBeenCalledWith(
      expect.objectContaining({ detour: { coordinate: { lon: -75.42, lat: 40.11 }, label: "Sheetz" } }),
    );
  });
});

describe("search along this ride", () => {
  it("searches from the rider's own position and adds the chosen place through the ride's reroute", async () => {
    const plan = vi.fn(async () => ({ status: "unavailable" as const, reason: "no-route" as const }));
    const search: PlaceSearchPort = {
      search: vi.fn(async () => ({
        status: "ok" as const,
        places: [
          {
            id: "fixture:riverside-diner",
            label: "Riverside Diner, PA",
            name: "Riverside Diner",
            context: "Carbon County, PA",
            coordinate: { lon: -75.42, lat: 40.11 },
            provider: "fixture",
          },
        ],
      })),
      reverse: vi.fn(async () => null),
    };
    await harness({ position: "fresh", placeSearch: search, reroutePlanner: { plan } });
    if (screen.getByTestId("ride-focus").getAttribute("data-sheet") === "closed") {
      fireEvent.click(screen.getByTestId("ride-menu"));
    }
    fireEvent.click(await screen.findByTestId("ride-add-stop"));
    fireEvent.click(screen.getByTestId("ride-stop-coffee"));

    // The planner's own search, biased to where the rider is.
    expect(search.search).toHaveBeenCalledWith(
      "coffee shop",
      expect.objectContaining({ bias: { lon: -75.4385, lat: 40.1385 } }),
    );

    fireEvent.click(await screen.findByTestId("ride-stop-option"));
    // A tap only selects; nothing is planned until the rider confirms (§1).
    expect(plan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("ride-stop-confirm-go"));
    await waitFor(() => expect(plan).toHaveBeenCalled());
    expect(plan).toHaveBeenCalledWith(
      expect.objectContaining({ detour: { coordinate: { lon: -75.42, lat: 40.11 }, label: "Riverside Diner" } }),
    );
  });
});
