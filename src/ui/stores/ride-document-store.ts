/**
 * The `RideDocument` container (02-ARCHITECTURE-CONTRACT §5, §8).
 *
 * A thin container: it holds the current document and exposes exactly one
 * mutation entry, `dispatch(command)`, which is `applyRideCommand` and nothing
 * else. The domain reducer remains the only authority over authored state —
 * eligibility, staleness, no-ops, revision bumps and history all happen there.
 *
 * The store deliberately does not expose zustand's `setState`: the returned
 * object is only `getState`/`getInitialState`/`subscribe` (`ReadonlyStoreApi`),
 * so "no raw setter" is a property of the type rather than a convention
 * (02 §8: components cannot obtain raw setter access).
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import { arriveByTime, type ArrivalTarget } from "@/application/planner/arrive-by";
import {
  detectCrossTabConflict,
  forkRideDocument,
  type CrossTabConflict,
} from "@/application/planner/cross-tab";
import type {
  BootstrapHintRead,
  BootstrapPointerPort,
  LoadRideResult,
  RideDraftPointer,
  RideRepositoryPort,
  SaveResult,
} from "@/application/persistence/ride-repository";
import { createRideDocument } from "@/domain/ride/create";
import type { RideCommand, RideCommandResult } from "@/domain/ride/commands";
import { newCommandId, newPointId, newStopId } from "@/domain/ride/ids";
import type { ShapingId, StopId } from "@/domain/ride/ids";
import { undoRide, redoRide, type HistoryMoveResult } from "@/domain/ride/history";
import { applyRideCommand } from "@/domain/ride/reducer";
import type {
  CommandSource,
  BikeConstraintSnapshot,
  Coordinate,
  LocationProvenance,
  RideDocument,
  RidePoint,
  StopArrivalIntent,
  StopPoint,
} from "@/domain/ride/types";
import { DRAFT_DIRTY_STORAGE_KEY } from "@/application/persistence/local-data-keys";

export type SaveIndicatorState =
  | "unsaved"
  | "saving"
  | "saved"
  | "failed"
  | "quota"
  | "conflict";

export interface SaveStatus {
  readonly state: SaveIndicatorState;
  /** The last actual repository result; pending/conflict states have no fake result. */
  readonly result: SaveResult | null;
}

export interface RestoreStatus {
  readonly state: "idle" | "loading" | "restored" | "corrupt" | "failed";
  readonly message: string | null;
}

export interface RideDocumentState {
  readonly document: RideDocument;
  /** The last dispatch result, so a surface can explain a refused command. */
  readonly lastResult: RideCommandResult | null;
  readonly saveStatus: SaveStatus;
  readonly restoreStatus: RestoreStatus;
  /** Planning answers are intentionally not part of a RideDocument checkpoint. */
  readonly planningRestored: false;
  readonly conflict: CrossTabConflict | null;
  readonly reloadLatest: () => Promise<void>;
  readonly keepMyCopy: () => Promise<void>;
  /** Re-attempts the latest failed checkpoint without pretending export exists. */
  readonly retrySave: () => void;
  /** The one mutation entry; wraps the domain reducer and surfaces its result. */
  readonly dispatch: (command: RideCommand) => RideCommandResult;
  /**
   * Whole-ride undo (03 §27, 04 §20). It returns the crossed entry's label so the
   * surface can say what it undid, or `null` at the origin. Undo is a move, not a
   * command: it never appends history, and it clears `lastResult` because the last
   * command no longer describes the document.
   */
  readonly undo: () => HistoryMoveResult;
  readonly redo: () => HistoryMoveResult;
}

/** Read-only store surface: no `setState`, no second write path. */
export type RideDocumentStore = Pick<
  StoreApi<RideDocumentState>,
  "getState" | "getInitialState" | "subscribe"
>;

export interface RideDocumentStoreOptions {
  readonly document?: RideDocument;
  /** Read the active garage bike only when a client-side new-ride decision needs it. */
  readonly newRideBike?: () => BikeConstraintSnapshot;
  readonly now?: () => string;
  readonly repository?: RideRepositoryPort;
  readonly bootstrapPointer?: BootstrapPointerPort;
}

const CHECKPOINT_DEBOUNCE_MS = 250;
const CHECKPOINT_BURST_BOUND_MS = 1_500;

interface CheckpointRequest {
  readonly document: RideDocument;
  readonly generation: number;
  readonly skipConflictRead: boolean;
}

function markDraftDirty(dirty: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (dirty) window.localStorage.setItem(DRAFT_DIRTY_STORAGE_KEY, "1");
    else window.localStorage.removeItem(DRAFT_DIRTY_STORAGE_KEY);
  } catch {
    // Persistence is still authoritative; a private browsing context may reject
    // this advisory marker without making the ride itself unsaved.
  }
}

function writerTokenForTab(): string {
  return crypto.randomUUID();
}

function saveStateFor(result: SaveResult): SaveStatus {
  if (result.ok) return { state: "saved", result };
  return {
    state:
      result.reason === "quota"
        ? "quota"
        : result.reason === "conflict"
          ? "conflict"
          : "failed",
    result,
  };
}

/**
 * Creates one ride-document container. `dispatch` is a no-op for a `stale` or
 * `invalid` command: the document only moves when the reducer says `applied`,
 * and a `noop` leaves the same document in place (OGV-D-115).
 */
export function createRideDocumentStore(
  options: RideDocumentStoreOptions = {},
): RideDocumentStore {
  const now = options.now;
  const repository = options.repository ?? null;
  const writerToken = writerTokenForTab();
  let baseRevision = options.document?.revision ?? 0;
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  let checkpointBurstTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledCheckpoint: CheckpointRequest | null = null;
  let checkpointGeneration = 0;
  let scheduleCheckpoint: ((document: RideDocument) => void) | null = null;
  let flushCheckpoint: ((force?: boolean) => void) | null = null;
  let retryCheckpoint: (() => void) | null = null;
  let queuedCheckpoint: CheckpointRequest | null = null;
  let checkpointInFlight: Promise<void> | null = null;
  /** Bumped whenever a flush supersedes the drain that is currently running. */
  let checkpointDrainEpoch = 0;
  let inspectForConflict: (() => Promise<void>) | null = null;
  let cancelPendingCheckpoint = (): void => undefined;

  const store = createStore<RideDocumentState>((set, get) => ({
    document:
      options.document ??
      createRideDocument(now === undefined ? {} : { now: now() }),
    lastResult: null,
    saveStatus: { state: "unsaved", result: null },
    restoreStatus: { state: "idle", message: null },
    planningRestored: false,
    conflict: null,

    reloadLatest: async (): Promise<void> => {
      if (repository === null) return;
      cancelPendingCheckpoint();
      const current = get().document;
      let loaded: LoadRideResult;
      try {
        loaded = await repository.loadRide(current.rideId);
      } catch (error: unknown) {
        set({
          restoreStatus: { state: "failed", message: "Could not reload your draft" },
        });
        void error;
        return;
      }
      if (loaded === null) {
        set({ restoreStatus: { state: "failed", message: "The latest draft is unavailable" } });
        return;
      }
      if (!loaded.ok) {
        set({ restoreStatus: { state: "corrupt", message: "Could not restore your draft" } });
        return;
      }
      baseRevision = loaded.document.revision;
      set({
        document: loaded.document,
        conflict: null,
        restoreStatus: { state: "restored", message: "Restored your draft" },
        saveStatus: { state: "unsaved", result: get().saveStatus.result },
      });
    },

    keepMyCopy: async (): Promise<void> => {
      const copy = forkRideDocument(
        get().document,
        now === undefined ? new Date().toISOString() : now(),
      );
      baseRevision = copy.revision;
      set({
        document: copy,
        conflict: null,
        restoreStatus: { state: "idle", message: null },
        saveStatus: { state: "unsaved", result: get().saveStatus.result },
      });
      markDraftDirty(true);
      scheduleCheckpoint?.(copy);
    },

    retrySave: (): void => {
      retryCheckpoint?.();
    },

    dispatch(command: RideCommand): RideCommandResult {
      const commandWithBike = command.type === "ride.create"
        && command.bike === undefined
        && typeof window !== "undefined"
        && options.newRideBike !== undefined
        ? { ...command, bike: options.newRideBike() }
        : command;
      const result = applyRideCommand(
        get().document,
        commandWithBike,
        now === undefined ? {} : { now: now() },
      );
      switch (result.outcome) {
        case "applied":
          markDraftDirty(true);
          set({
            document: result.document,
            lastResult: result,
            restoreStatus: { state: "idle", message: null },
            saveStatus:
              get().conflict === null
                ? { state: "unsaved", result: get().saveStatus.result }
                : get().saveStatus,
          });
          scheduleCheckpoint?.(result.document);
          break;
        case "noop":
          set({ document: result.document, lastResult: result });
          break;
        case "stale":
        case "invalid":
          // The document does not move; the result is surfaced so the surface
          // can say why (a stale command is a UI bug, not a silent success).
          set({ lastResult: result });
          break;
      }
      return result;
    },

    undo(): HistoryMoveResult {
      const move = undoRide(get().document, now === undefined ? {} : { now: now() });
      if (move === null) return null;
      markDraftDirty(true);
      set({
        document: move.document,
        lastResult: null,
        saveStatus: { state: "unsaved", result: get().saveStatus.result },
      });
      scheduleCheckpoint?.(move.document);
      return move;
    },

    redo(): HistoryMoveResult {
      const move = redoRide(get().document, now === undefined ? {} : { now: now() });
      if (move === null) return null;
      markDraftDirty(true);
      set({
        document: move.document,
        lastResult: null,
        saveStatus: { state: "unsaved", result: get().saveStatus.result },
      });
      scheduleCheckpoint?.(move.document);
      return move;
    },
  }));

  // Keep the internal mutation reference private while the returned store stays
  // a read-only Zustand surface. This is only used by the persistence closures.
  const setState = store.setState;

  cancelPendingCheckpoint = (): void => {
    checkpointGeneration += 1;
    scheduledCheckpoint = null;
    queuedCheckpoint = null;
    if (checkpointTimer !== null) {
      clearTimeout(checkpointTimer);
      checkpointTimer = null;
    }
    if (checkpointBurstTimer !== null) {
      clearTimeout(checkpointBurstTimer);
      checkpointBurstTimer = null;
    }
  };

  const setConflict = (conflict: CrossTabConflict): void => {
    cancelPendingCheckpoint();
    setState({
      conflict,
      saveStatus: { state: "conflict", result: store.getState().saveStatus.result },
    });
  };

  const readConflict = async (): Promise<CrossTabConflict | null> => {
    if (repository?.readRideRevision === undefined) return null;
    const current = store.getState().document;
    const stored = await repository.readRideRevision(current.rideId);
    if (stored === null) return null;
    return detectCrossTabConflict({
      storedRevision: stored.revision,
      storedWriterToken: stored.writerToken,
      ourBaseRevision: baseRevision,
      ourRevision: current.revision,
      writerToken,
    });
  };

  inspectForConflict = async (): Promise<void> => {
    if (repository === null || store.getState().conflict !== null) return;
    try {
      const conflict = await readConflict();
      if (conflict !== null) setConflict(conflict);
    } catch (error: unknown) {
      setState({
        saveStatus: { state: "failed", result: store.getState().saveStatus.result },
      });
      void error;
    }
  };

  const persist = async (request: CheckpointRequest): Promise<void> => {
    const { document, generation, skipConflictRead } = request;
    if (repository === null || store.getState().conflict !== null) return;

    if (!skipConflictRead) {
      let conflict: CrossTabConflict | null;
      try {
        conflict = await readConflict();
      } catch (error: unknown) {
        if (generation !== checkpointGeneration) return;
        setState({
          saveStatus: { state: "failed", result: store.getState().saveStatus.result },
        });
        void error;
        return;
      }
      if (conflict !== null) {
        if (generation === checkpointGeneration) setConflict(conflict);
        return;
      }
    }

    if (generation === checkpointGeneration) {
      setState({ saveStatus: { state: "saving", result: store.getState().saveStatus.result } });
    }
    let result: SaveResult;
    try {
      // Keep this call before the first await for lifecycle flushes: the IDB
      // transaction is started from the event handler rather than a later task.
      const save = repository.saveRide(document, {
        writerToken,
        baseRevision,
      });
      result = await save;
    } catch (error: unknown) {
      result = { ok: false, reason: "write-failed", error };
    }
    if (result.ok) {
      // A serialized older checkpoint still became the accepted durable base for
      // the newer queued document, even when its UI generation is stale.
      baseRevision = Math.max(baseRevision, document.revision);
    }
    if (generation !== checkpointGeneration) return;
    if (!result.ok && result.reason === "conflict") {
      setConflict(result.conflict);
      setState({ saveStatus: saveStateFor(result) });
      return;
    }
    if (result.ok) {
      options.bootstrapPointer?.write({
        rideId: document.rideId,
        updatedAt: document.updatedAt,
      });
      markDraftDirty(false);
    }
    setState({ saveStatus: saveStateFor(result) });
  };

  const startCheckpointDrain = (): void => {
    if (checkpointInFlight !== null) return;
    const epoch = checkpointDrainEpoch;
    const drain = async (): Promise<void> => {
      while (queuedCheckpoint !== null && epoch === checkpointDrainEpoch) {
        const next = queuedCheckpoint;
        queuedCheckpoint = null;
        await persist(next);
      }
      if (epoch !== checkpointDrainEpoch) return;
      checkpointInFlight = null;
      if (queuedCheckpoint !== null) startCheckpointDrain();
    };
    checkpointInFlight = drain();
  };

  const enqueueCheckpoint = (request: CheckpointRequest): void => {
    // Only the newest not-yet-started checkpoint matters. The active write is
    // allowed to finish, then the queue drains this latest snapshot.
    queuedCheckpoint = request;
    startCheckpointDrain();
  };

  /**
   * Whether authored state is still on its way to durable storage. A queued or
   * in-flight checkpoint counts: during unload its promise need never settle, so
   * a flush must be able to start the newest snapshot on its own instead of
   * waiting behind it.
   */
  const hasOutstandingCheckpoint = (): boolean =>
    scheduledCheckpoint !== null ||
    queuedCheckpoint !== null ||
    checkpointInFlight !== null;

  /**
   * Detaches the running drain from the store's bookkeeping. The write it already
   * started may still land, but its result can no longer move the UI (its
   * generation was retired by `cancelPendingCheckpoint`) and it can no longer make
   * a newer snapshot wait. A late write cannot clobber the newer one: the
   * repository refuses a stale revision, and it accepts this writer's own newer
   * revision over its own earlier row.
   */
  const supersedeInFlightCheckpoint = (): void => {
    checkpointDrainEpoch += 1;
    checkpointInFlight = null;
  };

  scheduleCheckpoint = (document: RideDocument): void => {
    checkpointGeneration += 1;
    const generation = checkpointGeneration;
    if (checkpointTimer !== null) clearTimeout(checkpointTimer);
    scheduledCheckpoint = {
      document,
      generation,
      skipConflictRead: false,
    };
    if (store.getState().conflict !== null) {
      checkpointTimer = null;
      return;
    }
    checkpointTimer = setTimeout(() => {
      if (scheduledCheckpoint?.generation !== generation) return;
      const pending = scheduledCheckpoint;
      scheduledCheckpoint = null;
      checkpointTimer = null;
      if (checkpointBurstTimer !== null) {
        clearTimeout(checkpointBurstTimer);
        checkpointBurstTimer = null;
      }
      enqueueCheckpoint(pending);
    }, CHECKPOINT_DEBOUNCE_MS);
    if (checkpointBurstTimer === null) {
      checkpointBurstTimer = setTimeout(() => {
        checkpointBurstTimer = null;
        flushCheckpoint?.();
      }, CHECKPOINT_BURST_BOUND_MS);
    }
  };

  flushCheckpoint = (force = false): void => {
    if (repository === null || store.getState().conflict !== null) return;
    if (!force && !hasOutstandingCheckpoint()) return;
    const document = store.getState().document;
    cancelPendingCheckpoint();
    // A flush is a durability deadline (the burst bound, `retrySave`, or the page
    // going away), so it starts the newest snapshot immediately instead of queueing
    // it behind a checkpoint that may never settle. Superseding the running drain is
    // what makes this independent: `enqueueCheckpoint` calls `saveRide` synchronously
    // from here, so the IndexedDB transaction is created while the handler is live.
    supersedeInFlightCheckpoint();
    enqueueCheckpoint({
      document,
      generation: checkpointGeneration,
      skipConflictRead: true,
    });
  };
  retryCheckpoint = (): void => {
    markDraftDirty(true);
    flushCheckpoint?.(true);
  };

  const reconcileBootstrapPointer = (pointer: RideDraftPointer): void => {
    if (options.bootstrapPointer === undefined) return;
    try {
      const read = options.bootstrapPointer.read();
      const cached = read.status === "found" ? read.hint : null;
      if (cached?.rideId !== pointer.rideId || cached.updatedAt !== pointer.updatedAt) {
        options.bootstrapPointer.write(pointer);
      }
    } catch {
      options.bootstrapPointer.write(pointer);
    }
  };

  /**
   * Adopts a durable document as the planner's document. The checkpoint that
   * follows rewrites the IndexedDB draft pointer, including the geometry refs the
   * recovered ride holds, so the next boot does not need the localStorage hint.
   */
  const adoptRestoredDocument = (
    restored: RideDocument,
    pointer: RideDraftPointer,
  ): void => {
    baseRevision = restored.revision;
    reconcileBootstrapPointer(pointer);
    setState({
      document: restored,
      restoreStatus: { state: "restored", message: "Restored your draft" },
      planningRestored: false,
    });
    scheduleCheckpoint(restored);
  };

  const readBootstrapHint = (): BootstrapHintRead => {
    try {
      return options.bootstrapPointer?.read() ?? { status: "absent" };
    } catch {
      // A port that throws has told us the read failed, not that the hint is gone.
      return { status: "unreadable" };
    }
  };

  const restore = async (): Promise<void> => {
    if (typeof window === "undefined" || repository === null) return;
    const startingDocument = store.getState().document;
    const untouched = (): boolean => store.getState().document === startingDocument;
    const seedWithActiveBike = (): void => {
      if (!untouched() || options.newRideBike === undefined) return;
      const bike = options.newRideBike();
      const document = createRideDocument({
        bike,
        ...(now === undefined ? {} : { now: now() }),
      });
      setState({
        document,
        restoreStatus: { state: "idle", message: null },
        planningRestored: false,
        saveStatus: { state: "unsaved", result: store.getState().saveStatus.result },
      });
    };
    setState({ restoreStatus: { state: "loading", message: null } });
    try {
      const pointer = await repository.loadDraftPointer();
      if (pointer !== null) {
        reconcileBootstrapPointer(pointer);
        const loaded = await repository.loadRide(pointer.rideId);
        if (loaded === null) {
          seedWithActiveBike();
          setState({ restoreStatus: { state: "idle", message: null } });
          return;
        }
        if (!loaded.ok) {
          setState({
            restoreStatus: { state: "corrupt", message: "Could not restore your draft" },
          });
          return;
        }
        if (!untouched()) {
          setState({ restoreStatus: { state: "idle", message: null } });
          return;
        }
        adoptRestoredDocument(loaded.document, pointer);
        return;
      }

      // The IndexedDB pointer is gone: a partial write, an eviction, or a lost
      // pointer with the ride still durable. The localStorage hint is not
      // authoritative, but it is the only remaining lead, so try the ride it names
      // once before declaring the hint dead (5.1s finding 4).
      const hintRead = readBootstrapHint();
      if (hintRead.status === "corrupt") {
        // A cache that cannot be parsed holds no lead and will never become one: drop
        // it instead of coming back to the same dead entry on every boot.
        options.bootstrapPointer?.invalidate();
      }
      if (hintRead.status !== "found") {
        // "absent" has nothing to drop, and "unreadable" may still be good: a read
        // failure keeps the hint for the next boot (5.1t finding A6).
        if (hintRead.status === "absent" || hintRead.status === "corrupt") seedWithActiveBike();
        setState({ restoreStatus: { state: "idle", message: null } });
        return;
      }
      const recovered = await repository.loadRide(hintRead.hint.rideId);
      if (recovered === null || !recovered.ok) {
        options.bootstrapPointer?.invalidate();
        if (recovered === null) seedWithActiveBike();
        setState({
          restoreStatus:
            recovered === null
              ? { state: "idle", message: null }
              : { state: "corrupt", message: "Could not restore your draft" },
        });
        return;
      }
      if (!untouched()) {
        setState({ restoreStatus: { state: "idle", message: null } });
        return;
      }
      adoptRestoredDocument(recovered.document, {
        id: "active",
        rideId: recovered.document.rideId,
        updatedAt: recovered.document.updatedAt,
      });
    } catch (error: unknown) {
      setState({ restoreStatus: { state: "failed", message: "Could not restore your draft" } });
      // A failed read is not a reason to claim the default ride was saved.
      void error;
    }
  };

  if (typeof window !== "undefined" && repository !== null) {
    const browserDocument = window.document;
    const inspectWhenVisible = (): void => {
      if (browserDocument.visibilityState === "hidden") void flushCheckpoint?.();
      else void inspectForConflict?.();
    };
    browserDocument.addEventListener("visibilitychange", inspectWhenVisible);
    window.addEventListener("focus", inspectWhenVisible);
    window.addEventListener("pagehide", () => flushCheckpoint?.());
  }

  void restore();

  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  };
}

/** The process-wide planner document container. */
export const rideDocumentStore: RideDocumentStore = createRideDocumentStore();

const defaultNow = (): string => new Date().toISOString();

/**
 * The fields every command carries (02-ARCHITECTURE-CONTRACT §5). Built in one
 * place so a new command helper cannot forget the ownership identity a stale
 * dispatch is caught by.
 */
function commandBase(
  document: RideDocument,
  source: CommandSource,
  label: string,
): {
  readonly commandId: ReturnType<typeof newCommandId>;
  readonly rideId: RideDocument["rideId"];
  readonly baseRevision: number;
  readonly source: CommandSource;
  readonly label: string;
} {
  return {
    commandId: newCommandId(),
    rideId: document.rideId,
    baseRevision: document.revision,
    source,
    label,
  };
}

/**
 * Where a coordinate the rider authored by gesture came from. Every point command
 * below states `map`, because that is what authored it: a tap, a drag or a typed
 * coordinate are all the rider placing a point, and the provenance vocabulary has
 * no better word for "the rider put it here this second".
 */
function mapProvenance(now: () => string): LocationProvenance {
  return { type: "map", selectedAt: now() };
}

/** A new endpoint: identity is minted here, position and provenance carry over. */
function mapPoint(
  kind: "start" | "finish",
  coordinate: Coordinate,
  now: () => string,
): RidePoint {
  return {
    id: newPointId(),
    kind,
    coordinate: { lon: coordinate.lon, lat: coordinate.lat },
    // A point placed by clicking the map is authored by the rider through the
    // map: the provenance says so, and the label stays unset (no invented name).
    provenance: mapProvenance(now),
  };
}

/**
 * A moved endpoint keeps its identity and its label: a rider who renames a place
 * and then corrects its position must not lose the name (03 §1 — identity and
 * position are different facts). Its provenance becomes the map's, because the
 * *position* is what provenance describes and the rider just authored it.
 *
 * The exception is a label that was a claim *about the old position*: a searched
 * place's name or "your location". Dragging "Jim Thorpe, PA" twenty miles east
 * does not keep it in Jim Thorpe, so that label is dropped and the moved pin is
 * named from its new coordinate like any other dropped pin (OGV-D-260).
 */
function movedEndpoint(
  current: RidePoint,
  coordinate: Coordinate,
  now: () => string,
): RidePoint {
  const positional = current.provenance.type === "search" || current.provenance.type === "gps";
  const { label, ...rest } = current;
  return {
    ...(positional || label === undefined ? rest : { ...rest, label }),
    coordinate: { lon: coordinate.lon, lat: coordinate.lat },
    provenance: mapProvenance(now),
  };
}

/** What a picked search result authors: the place, its name, and where it came from. */
export interface SearchedPlace {
  readonly label: string;
  readonly coordinate: Coordinate;
  readonly provider: string;
  readonly placeId?: string;
}

/**
 * Builds `start.set` / `finish.set` for a place picked from search (M1). One
 * rider action, one command: the coordinate, the label and `search` provenance
 * arrive together, so the name never lags the pin. An existing endpoint keeps its
 * identity (it is being *replaced in place*, 04 §15), a missing one is minted.
 */
export function searchedEndpointCommand(
  document: RideDocument,
  slot: "start" | "finish",
  place: SearchedPlace,
  query: string,
): PlaceStartCommand | PlaceFinishCommand {
  const current = slot === "start" ? document.intent.start : document.intent.finish;
  const point: RidePoint = {
    id: current?.id ?? newPointId(),
    kind: slot,
    coordinate: { lon: place.coordinate.lon, lat: place.coordinate.lat },
    label: place.label,
    provenance: {
      type: "search",
      provider: place.provider,
      query,
      ...(place.placeId === undefined ? {} : { placeId: place.placeId }),
    },
  };
  const base = commandBase(document, "rider", slot === "start" ? "Set start" : "Set destination");
  return slot === "start"
    ? { ...base, type: "start.set", point }
    : { ...base, type: "finish.set", point };
}

/**
 * Builds `start.set` from the rider's own position ("Current location", M1).
 * The rider asked for it, so it is a deliberate `rider` edit — undoable, and
 * allowed to replace an authored start — unlike the `system-location` seed.
 */
export function currentLocationStartCommand(
  document: RideDocument,
  fix: { readonly coordinate: Coordinate; readonly accuracyMeters: number; readonly observedAt: string },
): PlaceStartCommand {
  return {
    ...commandBase(document, "rider", "Start from current location"),
    type: "start.set",
    point: {
      id: document.intent.start?.id ?? newPointId(),
      kind: "start",
      coordinate: { lon: fix.coordinate.lon, lat: fix.coordinate.lat },
      provenance: {
        type: "gps",
        accuracyMeters: fix.accuracyMeters,
        observedAt: fix.observedAt,
      },
    },
  };
}

/** A `start.set` command: narrowed so a caller can read the point it built. */
export type PlaceStartCommand = Extract<RideCommand, { type: "start.set" }>;

/** A `finish.set` command. */
export type PlaceFinishCommand = Extract<RideCommand, { type: "finish.set" }>;

/** An `stop.insert` command. */
export type InsertStopCommand = Extract<RideCommand, { type: "stop.insert" }>;

type MoveStartCommand = Extract<RideCommand, { type: "start.set" }>;
type MoveFinishCommand = Extract<RideCommand, { type: "finish.set" }>;
type MoveStopCommand = Extract<RideCommand, { type: "stop.move" }>;
type MoveShapeCommand = Extract<RideCommand, { type: "shape.move" }>;
type ReorderStopCommand = Extract<RideCommand, { type: "stop.reorder" }>;
type RemoveStopCommand = Extract<RideCommand, { type: "stop.remove" }>;
type RemoveStartCommand = Extract<RideCommand, { type: "start.clear" }>;
type RemoveFinishCommand = Extract<RideCommand, { type: "finish.clear" }>;
type ClearRideCommand = Extract<RideCommand, { type: "ride.clear" }>;
type RemoveShapeCommand = Extract<RideCommand, { type: "shape.remove" }>;
type ConvertPointCommand = Extract<RideCommand, { type: "point.convert" }>;
type SetArrivalIntentCommand = Extract<RideCommand, { type: "stop.arrivalIntent.set" }>;

/**
 * Builds `start.set` for a coordinate chosen on the map. A helper for surfaces:
 * the command is still the mutation, and it is still the reducer that decides.
 */
export function placeStartCommand(
  document: RideDocument,
  coordinate: Coordinate,
  now: () => string = defaultNow,
): PlaceStartCommand {
  return {
    ...commandBase(document, "map", "Set start"),
    type: "start.set",
    point: mapPoint("start", coordinate, now),
  };
}

/** Builds `finish.set` for a coordinate chosen on the map. */
export function placeFinishCommand(
  document: RideDocument,
  coordinate: Coordinate,
  now: () => string = defaultNow,
): PlaceFinishCommand {
  return {
    ...commandBase(document, "map", "Set destination"),
    type: "finish.set",
    point: mapPoint("finish", coordinate, now),
  };
}

/**
 * Builds `start.set` that **moves** the existing start (04 §15 "replace place",
 * numeric edit, drag). The point's identity survives; only its position is
 * re-authored.
 */
export function moveStartCommand(
  document: RideDocument,
  coordinate: Coordinate,
  now: () => string = defaultNow,
): MoveStartCommand | null {
  const current = document.intent.start;
  if (current === null) return null;
  return {
    ...commandBase(document, "map", "Move start"),
    type: "start.set",
    point: movedEndpoint(current, coordinate, now),
  };
}

/** Builds `finish.set` that **moves** the existing destination. */
export function moveFinishCommand(
  document: RideDocument,
  coordinate: Coordinate,
  now: () => string = defaultNow,
): MoveFinishCommand | null {
  const current = document.intent.finish;
  if (current === null) return null;
  return {
    ...commandBase(document, "map", "Move destination"),
    type: "finish.set",
    point: movedEndpoint(current, coordinate, now),
  };
}

/**
 * Builds `stop.insert` for a coordinate chosen on the map. `beforeStopId` is the
 * insert-before anchor the ordering rule produced
 * (`application/planner/stop-insertion.ts`); `undefined` appends.
 */
export function insertStopCommand(
  document: RideDocument,
  coordinate: Coordinate,
  beforeStopId: StopId | undefined,
  now: () => string = defaultNow,
): InsertStopCommand {
  const stop: StopPoint = {
    id: newStopId(),
    kind: "stop",
    coordinate: { lon: coordinate.lon, lat: coordinate.lat },
    provenance: mapProvenance(now),
  };
  return {
    ...commandBase(document, "map", "Add stop"),
    type: "stop.insert",
    stop,
    ...(beforeStopId === undefined ? {} : { beforeStopId }),
  };
}

/** Builds `stop.move`: the stop keeps its identity, label and arrival intent. */
export function moveStopCommand(
  document: RideDocument,
  stopId: StopId,
  coordinate: Coordinate,
  now: () => string = defaultNow,
): MoveStopCommand {
  return {
    ...commandBase(document, "map", "Move stop"),
    type: "stop.move",
    stopId,
    endpoint: {
      coordinate: { lon: coordinate.lon, lat: coordinate.lat },
      provenance: mapProvenance(now),
    },
  };
}

/** Builds `shape.move` for a dragged or numerically edited anchor. */
export function moveShapeCommand(
  document: RideDocument,
  shapeId: ShapingId,
  coordinate: Coordinate,
): MoveShapeCommand {
  return {
    ...commandBase(document, "map", "Move shaping point"),
    type: "shape.move",
    shapeId,
    coordinate: { lon: coordinate.lon, lat: coordinate.lat },
  };
}

/** Builds `stop.reorder` with the neighbour the ordering rule chose. */
export function reorderStopCommand(
  document: RideDocument,
  stopId: StopId,
  beforeStopId: StopId | undefined,
): ReorderStopCommand {
  return {
    ...commandBase(document, "rider", "Reorder stops"),
    type: "stop.reorder",
    stopId,
    ...(beforeStopId === undefined ? {} : { beforeStopId }),
  };
}

/** Builds `stop.remove`. */
export function removeStopCommand(
  document: RideDocument,
  stopId: StopId,
): RemoveStopCommand {
  return {
    ...commandBase(document, "rider", "Remove stop"),
    type: "stop.remove",
    stopId,
  };
}

/** Builds `start.clear`. */
export function removeStartCommand(document: RideDocument): RemoveStartCommand {
  return { ...commandBase(document, "rider", "Remove start"), type: "start.clear" };
}

/** Builds `finish.clear`. */
export function removeFinishCommand(document: RideDocument): RemoveFinishCommand {
  return {
    ...commandBase(document, "rider", "Remove destination"),
    type: "finish.clear",
  };
}

/** The history label of a whole-route clear; the sheet offers its undo in peek. */
export const CLEAR_RIDE_LABEL = "Clear route";

/**
 * Builds `ride.clear`: every authored point goes (start, destination, stops,
 * shaping); preferences, avoid areas and road spans stay. One undo restores it.
 */
export function clearRideCommand(document: RideDocument): ClearRideCommand {
  return { ...commandBase(document, "rider", CLEAR_RIDE_LABEL), type: "ride.clear" };
}

/** Builds `shape.remove`. */
export function removeShapeCommand(
  document: RideDocument,
  shapeId: ShapingId,
): RemoveShapeCommand {
  return {
    ...commandBase(document, "rider", "Remove shaping point"),
    type: "shape.remove",
    shapeId,
  };
}

/** Builds `point.convert` — the direction is decided by the identity it holds. */
export function convertPointCommand(
  document: RideDocument,
  pointId: StopId | ShapingId,
): ConvertPointCommand {
  const isStop = document.intent.stops.some((stop) => stop.id === pointId);
  return {
    ...commandBase(
      document,
      "rider",
      isStop ? "Convert to shaping point" : "Convert to stop",
    ),
    type: "point.convert",
    pointId,
  };
}

/** Builds `stop.arrivalIntent.set`; `null` clears the intent. */
export function setArrivalIntentCommand(
  document: RideDocument,
  stopId: StopId,
  arrivalIntent: StopArrivalIntent | null,
): SetArrivalIntentCommand {
  return {
    ...commandBase(document, "rider", "Change arrival intent"),
    type: "stop.arrivalIntent.set",
    stopId,
    arrivalIntent,
  };
}

/** Swap start and destination (PQ-04): one tap, one undo unit. */
export function reverseRideCommand(
  document: RideDocument,
): Extract<RideCommand, { type: "ride.reverse" }> {
  return { ...commandBase(document, "rider", "Swap start and destination"), type: "ride.reverse" };
}

/**
 * Ride style (M2): one rider choice, one typed command, one undo unit. These
 * are builders only — the reducer still decides, and a choice equal to the
 * current value is its `noop`.
 */
export function rideShapeCommand(
  document: RideDocument,
  shape: "destination" | "loop",
): Extract<RideCommand, { type: "ride.shape.set" }> {
  return {
    ...commandBase(document, "rider", shape === "loop" ? "Make it a loop" : "Ride to a destination"),
    type: "ride.shape.set",
    shape,
  };
}

export function loopTimeCommand(
  document: RideDocument,
  targetMinutes: number,
  toleranceMinutes: number,
): Extract<RideCommand, { type: "time.set" }> {
  return {
    ...commandBase(document, "rider", "Set ride time"),
    type: "time.set",
    time: { kind: "budget", targetMinutes, toleranceMinutes },
  };
}

export function arriveByCommand(
  document: RideDocument,
  arrival: ArrivalTarget | null,
): Extract<RideCommand, { type: "time.set" }> {
  return {
    ...commandBase(document, "rider", arrival === null ? "Clear arrival time" : "Arrive by"),
    type: "time.set",
    time: arrival === null ? { kind: "none" } : arriveByTime(arrival),
  };
}

export function roadCharacterCommand(
  document: RideDocument,
  roadCharacter: RideDocument["intent"]["roadCharacter"],
): Extract<RideCommand, { type: "roadCharacter.set" }> {
  return {
    ...commandBase(document, "rider", "Set road style"),
    type: "roadCharacter.set",
    roadCharacter,
  };
}

export function noveltyPreferenceCommand(
  document: RideDocument,
  noveltyPreference: NonNullable<RideDocument["intent"]["noveltyPreference"]>,
): Extract<RideCommand, { type: "noveltyPreference.set" }> {
  return {
    ...commandBase(document, "rider", "Set road familiarity"),
    type: "noveltyPreference.set",
    noveltyPreference,
  };
}

/** Changes only the preference; the rest of the surface envelope is kept. */
export function surfacePreferenceCommand(
  document: RideDocument,
  preference: RideDocument["intent"]["surface"]["preference"],
): Extract<RideCommand, { type: "surface.set" }> {
  return {
    ...commandBase(document, "rider", "Set surface"),
    type: "surface.set",
    surface: { ...document.intent.surface, preference },
  };
}

export function highwayPolicyCommand(
  document: RideDocument,
  avoid: boolean,
): Extract<RideCommand, { type: "highwayPolicy.set" }> {
  return {
    ...commandBase(document, "rider", avoid ? "Avoid highways" : "Allow highways"),
    type: "highwayPolicy.set",
    avoid,
  };
}

export function tollPolicyCommand(
  document: RideDocument,
  avoid: boolean,
): Extract<RideCommand, { type: "tollPolicy.set" }> {
  return {
    ...commandBase(document, "rider", avoid ? "Avoid tolls" : "Allow tolls"),
    type: "tollPolicy.set",
    tollPolicy: avoid ? "avoid" : "allow-with-warning",
  };
}

/** When the ride leaves (M4, OGV-D-266): read by the route briefing's weather window. */
export function departureCommand(
  document: RideDocument,
  departure: RideDocument["intent"]["departure"],
): Extract<RideCommand, { type: "departure.set" }> {
  return {
    ...commandBase(document, "rider", departure.kind === "now" ? "Leave now" : "Set departure time"),
    type: "departure.set",
    departure,
  };
}

/** A bike switch is one typed, undoable change to this ride's snapshot. */
export function bikeCommand(
  document: RideDocument,
  bike: BikeConstraintSnapshot,
): Extract<RideCommand, { type: "bike.set" }> {
  return {
    ...commandBase(document, "rider", "Change bike"),
    type: "bike.set",
    bike,
  };
}
