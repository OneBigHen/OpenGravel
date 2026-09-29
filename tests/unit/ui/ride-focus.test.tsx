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
import type { RideSessionId } from "@/domain/ride-session/ids";
import {
  instructionIssuedEvent,
  newSessionInstruction,
  offRouteChangedEvent,
  positionUpdatedEvent,
} from "@/domain/ride-session/create";
import { asRouteCandidateId } from "@/domain/route/ids";
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
  readonly position?: "fresh" | "stale" | "none";
  readonly instruction?: "turn" | "nameless";
  readonly environment?: Partial<RideFocusEnvironmentSnapshot>;
  readonly pointerAt?: "session" | "nothing";
  readonly databaseName?: string;
  readonly sessionId?: RideSessionId;
  readonly placesSource?: PlacesSource;
  readonly autoResume?: boolean;
  readonly riderSettings?: RiderSettingsStoragePort;
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
  const store = createRideFocusStore({
    controller,
    environment: () => environment.port,
    pointer,
    readRouteLine: async () => LINE,
    now: () => NOW,
    ...(options.riderSettings === undefined ? {} : { riderSettings: options.riderSettings }),
    // The store's own clock is the surface's freshness, not the test's business.
    setInterval: () => 0,
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
  if (options.position === "fresh" || options.position === "stale") {
    await controller.dispatch(offRouteChangedEvent("on-route", NOW));
  }
  if (options.instruction !== undefined) {
    await controller.dispatch(
      instructionIssuedEvent(
        newSessionInstruction({
          kind: "turn",
          maneuver: "left",
          roadName: options.instruction === "turn" ? "Gravel Pike" : "  ",
          distanceMeters: 120,
          targetStopId: null,
        }),
        NOW,
      ),
    );
  }
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

  return { store, controller, environment, pointer, hosts, sessionId, databaseName };
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

    expect(screen.getByTestId("ride-recovery")).toHaveTextContent("no ride in progress");
    expect(screen.getByTestId("ride-exit")).toHaveAttribute("href", "/");
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
