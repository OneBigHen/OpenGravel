import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRideDocument } from "@/domain/ride/create";
import type { RideDocument } from "@/domain/ride/types";
import {
  createRideDocumentStore,
  placeFinishCommand,
  placeStartCommand,
} from "@/ui/stores/ride-document-store";
import type {
  RideRepositoryPort,
  SaveResult,
} from "@/infrastructure/storage/ride-repository";
import {
  BOOTSTRAP_POINTER_KEY,
  createLocalStorageBootstrapPointer,
} from "@/infrastructure/storage/bootstrap-pointer";

const NOW = "2026-09-17T12:00:00.000Z";
const START = { lon: -75.2, lat: 39.95 };
const FINISH = { lon: -74.8, lat: 40.2 };

function repository(overrides: Partial<RideRepositoryPort> = {}): RideRepositoryPort {
  return {
    saveRide: vi.fn().mockResolvedValue({ ok: true }),
    loadRide: vi.fn().mockResolvedValue(null),
    loadDraftPointer: vi.fn().mockResolvedValue(null),
    deleteRide: vi.fn().mockResolvedValue(undefined),
    readRideRevision: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  // The lifecycle listener and the localStorage hint are process-wide: reset
  // both so one test cannot decide another test's durability or restore path.
  Object.defineProperty(window.document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  localStorage.clear();
});

describe("ride document persistence wiring", () => {
  it("debounces a burst of successful commands into one latest-document checkpoint", async () => {
    vi.useFakeTimers();
    const saveRide = vi.fn().mockResolvedValue({ ok: true });
    const rideRepository = repository({ saveRide });
    const store = createRideDocumentStore({
      repository: rideRepository,
      now: (): string => NOW,
      document: createRideDocument({ now: NOW }),
    });

    act(() => {
      const first = store.getState().document;
      store.getState().dispatch(placeStartCommand(first, START, (): string => NOW));
      const second = store.getState().document;
      store.getState().dispatch(placeFinishCommand(second, FINISH, (): string => NOW));
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(saveRide).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(saveRide).toHaveBeenCalledTimes(1);
    expect(saveRide.mock.calls[0]?.[0].revision).toBe(2);
  });

  it("hydrates the active draft without restoring a planning result", async () => {
    const document = createRideDocument({ now: NOW });
    const loadRide = vi.fn().mockResolvedValue({ ok: true, document });
    const rideRepository = repository({
      loadDraftPointer: vi.fn().mockResolvedValue({
        id: "active",
        rideId: document.rideId,
        updatedAt: document.updatedAt,
      }),
      loadRide,
    });

    const store = createRideDocumentStore({ repository: rideRepository, now: (): string => NOW });

    await waitFor(() => {
      expect(store.getState().document.rideId).toBe(document.rideId);
    });
    expect(store.getState().restoreStatus).toEqual({
      state: "restored",
      message: "Restored your draft",
    });
    expect(store.getState().planningRestored).toBe(false);
    expect(loadRide).toHaveBeenCalledWith(document.rideId);
  });

  it("does not fabricate or checkpoint an active draft when the pointer is absent", async () => {
    vi.useFakeTimers();
    const saveRide = vi.fn().mockResolvedValue({ ok: true });
    const rideRepository = repository({ saveRide });

    createRideDocumentStore({ repository: rideRepository, now: (): string => NOW });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(250);

    expect(saveRide).not.toHaveBeenCalled();
  });

  it("checkpoints a successfully loaded draft without restoring planning state", async () => {
    vi.useFakeTimers();
    const document = createRideDocument({ now: NOW });
    const saveRide = vi.fn().mockResolvedValue({ ok: true });
    const rideRepository = repository({
      saveRide,
      loadDraftPointer: vi.fn().mockResolvedValue({
        id: "active",
        rideId: document.rideId,
        updatedAt: document.updatedAt,
      }),
      loadRide: vi.fn().mockResolvedValue({ ok: true, document }),
    });

    createRideDocumentStore({ repository: rideRepository, now: (): string => NOW });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(250);

    expect(saveRide).toHaveBeenCalledTimes(1);
    expect(saveRide.mock.calls[0]?.[0]).toEqual(document);
    expect(saveRide.mock.calls[0]?.[1]).toEqual({
      writerToken: expect.any(String),
      baseRevision: document.revision,
    });
  });

  it("blocks a debounced save when another tab advanced the stored ride", async () => {
    vi.useFakeTimers();
    const document = createRideDocument({ now: NOW });
    const saveRide = vi.fn().mockResolvedValue({ ok: true });
    const rideRepository = repository({
      saveRide,
      readRideRevision: vi.fn().mockResolvedValue({
        revision: 2,
        writerToken: "other-tab",
      }),
    });
    const store = createRideDocumentStore({
      repository: rideRepository,
      now: (): string => NOW,
      document,
    });

    act(() => {
      store.getState().dispatch(placeStartCommand(document, START, (): string => NOW));
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(saveRide).not.toHaveBeenCalled();
    expect(store.getState().conflict).toEqual({ storedRevision: 2, ourRevision: 1 });
    expect(store.getState().saveStatus.state).toBe("conflict");
  });

  it("forks and checkpoints the local copy after Keep my copy", async () => {
    vi.useFakeTimers();
    const document = createRideDocument({ now: NOW });
    const saveRide = vi.fn().mockResolvedValue({ ok: true });
    const readRideRevision = vi.fn().mockImplementation(async (rideId: string) =>
      rideId === document.rideId
        ? { revision: 2, writerToken: "other-tab" }
        : null,
    );
    const rideRepository = repository({ saveRide, readRideRevision });
    const store = createRideDocumentStore({
      repository: rideRepository,
      now: (): string => NOW,
      document,
    });

    act(() => {
      store.getState().dispatch(placeStartCommand(document, START, (): string => NOW));
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(store.getState().conflict).not.toBeNull();

    await act(async () => {
      await store.getState().keepMyCopy();
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(store.getState().conflict).toBeNull();
    expect(store.getState().document.rideId).not.toBe(document.rideId);
    expect(store.getState().document.provenance.type).toBe("derived");
    expect(saveRide).toHaveBeenCalledWith(
      store.getState().document,
      expect.objectContaining({ writerToken: expect.any(String) }),
    );
  });

  it("checkpoints undo and redo states instead of leaving the prior timer authoritative", async () => {
    vi.useFakeTimers();
    const saveRide = vi.fn().mockResolvedValue({ ok: true });
    const document = createRideDocument({ now: NOW });
    const store = createRideDocumentStore({
      repository: repository({ saveRide }),
      now: (): string => NOW,
      document,
    });

    act(() => {
      const withStart = store.getState().dispatch(
        placeStartCommand(document, START, (): string => NOW),
      );
      if (withStart.outcome !== "applied") throw new Error("start was not applied");
      store.getState().dispatch(
        placeFinishCommand(withStart.document, FINISH, (): string => NOW),
      );
      store.getState().undo();
    });

    await vi.advanceTimersByTimeAsync(250);
    expect(saveRide).toHaveBeenCalledTimes(1);
    expect(saveRide.mock.calls[0]?.[0].revision).toBe(3);
    expect(saveRide.mock.calls[0]?.[0].intent.finish).toBeNull();

    act(() => {
      store.getState().redo();
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(saveRide).toHaveBeenCalledTimes(2);
    expect(saveRide.mock.calls[1]?.[0].revision).toBe(4);
    expect(saveRide.mock.calls[1]?.[0].intent.finish?.coordinate).toEqual(FINISH);
  });

  it("flushes the latest document immediately on hidden and pagehide lifecycle events", async () => {
    vi.useFakeTimers();
    const saveRide = vi.fn().mockResolvedValue({ ok: true });
    const document = createRideDocument({ now: NOW });
    const store = createRideDocumentStore({
      repository: repository({ saveRide, readRideRevision: undefined }),
      now: (): string => NOW,
      document,
    });

    act(() => {
      store.getState().dispatch(placeStartCommand(document, START, (): string => NOW));
    });
    Object.defineProperty(window.document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    window.document.dispatchEvent(new Event("visibilitychange"));

    expect(saveRide).toHaveBeenCalledTimes(1);
    expect(saveRide.mock.calls[0]?.[0].intent.start?.coordinate).toEqual(START);
    await Promise.resolve();
    await Promise.resolve();

    const next = store.getState().document;
    act(() => {
      store.getState().dispatch(placeFinishCommand(next, FINISH, (): string => NOW));
    });
    window.dispatchEvent(new Event("pagehide"));

    expect(saveRide).toHaveBeenCalledTimes(2);
    expect(saveRide.mock.calls[1]?.[0].intent.finish?.coordinate).toEqual(FINISH);
  });

  it("flushes a continuously edited burst at the hard durability bound", async () => {
    vi.useFakeTimers();
    interface BurstSave {
      readonly at: number;
      readonly revision: number;
      readonly latestAtSave: number;
    }
    const saves: BurstSave[] = [];
    const document = createRideDocument({ now: NOW });
    // Tracked outside the mock so the assertion can compare the revision the
    // store had authored when the write started with the revision it wrote.
    const latest = { revision: document.revision };
    const saveRide = vi.fn(async (saved: RideDocument): Promise<SaveResult> => {
      saves.push({
        at: Date.now(),
        revision: saved.revision,
        latestAtSave: latest.revision,
      });
      return { ok: true };
    });
    const store = createRideDocumentStore({
      repository: repository({ saveRide, readRideRevision: undefined }),
      now: (): string => NOW,
      document,
    });

    // Editing must continue *past* the 1.5 s bound: while edits keep arriving the
    // 250 ms debounce is re-armed every time, so a plain debounce (no burst timer)
    // would never write anything at all. That is the defect this test pins.
    // The clock starts at the *first* edit: a bound measured from container
    // construction would pass even if the burst timer were armed at construction.
    let startedAt = Date.now();
    let current = document;
    for (let index = 0; index < 21; index += 1) {
      const coordinate = { lon: START.lon + index * 0.01, lat: START.lat + index * 0.01 };
      if (index === 0) startedAt = Date.now();
      act(() => {
        store.getState().dispatch(placeStartCommand(current, coordinate, (): string => NOW));
      });
      current = store.getState().document;
      latest.revision = current.revision;
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(current.revision).toBe(21);
    expect(saves).not.toHaveLength(0);
    const atBound = saves[0] as BurstSave;
    // Durability arrived *by* the bound, not after the rider stopped typing...
    expect(atBound.at - startedAt).toBeLessThanOrEqual(1_500);
    // ...and it carried the revision that was latest at that moment.
    expect(atBound.revision).toBe(atBound.latestAtSave);
  });

  it("flushes the newest snapshot independently while an older checkpoint is still in flight", async () => {
    vi.useFakeTimers();
    // Record-only: the mock never decides durability or ordering, it defers every
    // settlement to this test. That the *store* never issues the older write after
    // the newer one is a property of the repository, and it is covered by
    // `tests/integration/ride-repository.test.ts` against real IndexedDB.
    const settles: Array<() => void> = [];
    const issued: number[] = [];
    const saveRide = vi.fn((saved: RideDocument): Promise<SaveResult> => {
      issued.push(saved.revision);
      return new Promise<SaveResult>((resolve) => {
        settles.push(() => resolve({ ok: true }));
      });
    });
    const document = createRideDocument({ now: NOW });
    const store = createRideDocumentStore({
      repository: repository({ saveRide, readRideRevision: undefined }),
      now: (): string => NOW,
      document,
    });

    act(() => {
      store.getState().dispatch(placeStartCommand(document, START, (): string => NOW));
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(issued).toEqual([1]);
    expect(settles).toHaveLength(1);

    const withStart = store.getState().document;
    act(() => {
      store.getState().dispatch(placeFinishCommand(withStart, FINISH, (): string => NOW));
    });

    // The page is going away. Queueing behind the checkpoint that is still pending
    // means the final edit may never be written, because unload need not let that
    // promise settle: the flush must start the newest snapshot on its own.
    window.dispatchEvent(new Event("pagehide"));

    // (a) The flush write was issued while the older checkpoint was still unsettled:
    // a second call exists and no settlement has happened yet.
    expect(settles).toHaveLength(2);
    expect(store.getState().saveStatus.state).not.toBe("saved");
    // (b) ...and it carries the latest authored revision.
    expect(issued).toEqual([1, 2]);
    expect(saveRide.mock.calls[1]?.[0].intent.finish?.coordinate).toEqual(FINISH);

    settles[1]?.();
    await vi.advanceTimersByTimeAsync(0);
    settles[0]?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getState().saveStatus.state).toBe("saved");
    expect(store.getState().conflict).toBeNull();
  });

  it("discards a superseded checkpoint's conflict result instead of moving the UI", async () => {
    vi.useFakeTimers();
    const settleFirst: Array<() => void> = [];
    const saveRide = vi
      .fn()
      .mockImplementationOnce(
        (): Promise<SaveResult> =>
          new Promise<SaveResult>((resolve) => {
            settleFirst.push(() =>
              resolve({
                ok: false,
                reason: "conflict",
                conflict: { storedRevision: 3, ourRevision: 1 },
              }),
            );
          }),
      )
      .mockResolvedValue({ ok: true });
    const document = createRideDocument({ now: NOW });
    const store = createRideDocumentStore({
      repository: repository({ saveRide, readRideRevision: undefined }),
      now: (): string => NOW,
      document,
    });

    act(() => {
      store.getState().dispatch(placeStartCommand(document, START, (): string => NOW));
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(saveRide).toHaveBeenCalledTimes(1);

    const withStart = store.getState().document;
    act(() => {
      store.getState().dispatch(placeFinishCommand(withStart, FINISH, (): string => NOW));
    });
    window.dispatchEvent(new Event("pagehide"));
    expect(saveRide).toHaveBeenCalledTimes(2);

    // The superseded drain now reports a conflict. It is stale news: a newer snapshot
    // already reached durable storage, so surfacing it would move the UI backwards
    // ("conflict") after a successful flush.
    settleFirst[0]?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getState().conflict).toBeNull();
    expect(store.getState().saveStatus.state).toBe("saved");
  });

  it("does not re-write or bump the revision when two pagehide flushes race", async () => {
    vi.useFakeTimers();
    const saveRide = vi.fn().mockResolvedValue({ ok: true });
    const document = createRideDocument({ now: NOW });
    const store = createRideDocumentStore({
      repository: repository({ saveRide, readRideRevision: undefined }),
      now: (): string => NOW,
      document,
    });

    act(() => {
      store.getState().dispatch(placeStartCommand(document, START, (): string => NOW));
    });
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));

    expect(saveRide.mock.calls.length).toBeGreaterThanOrEqual(1);
    // A flush is a durability deadline, not an authoring event: the same snapshot may
    // be written twice, but it must never be written at a new revision.
    for (const [saved] of saveRide.mock.calls) expect(saved.revision).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().saveStatus.state).toBe("saved");
    expect(store.getState().conflict).toBeNull();
  });

  it("retires the burst deadline when a lifecycle flush supersedes it", async () => {
    vi.useFakeTimers();
    const settles: Array<() => void> = [];
    const issued: number[] = [];
    const saveRide = vi.fn((saved: RideDocument): Promise<SaveResult> => {
      issued.push(saved.revision);
      return new Promise<SaveResult>((resolve) => {
        settles.push(() => resolve({ ok: true }));
      });
    });
    const document = createRideDocument({ now: NOW });
    const store = createRideDocumentStore({
      repository: repository({ saveRide, readRideRevision: undefined }),
      now: (): string => NOW,
      document,
    });

    act(() => {
      store.getState().dispatch(placeStartCommand(document, START, (): string => NOW));
    });
    // Mid-burst: the debounce is armed and the hard durability bound is armed too.
    await vi.advanceTimersByTimeAsync(100);
    expect(issued).toEqual([]);

    window.dispatchEvent(new Event("pagehide"));
    expect(issued).toEqual([1]);

    // Let the burst deadline pass while the flush write is still in flight: a leaked
    // burst timer would fire another flush and write the same snapshot a second time.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(issued).toEqual([1]);

    settles[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().saveStatus.state).toBe("saved");
  });

  it("reports a failed lifecycle flush instead of leaving the indicator saving", async () => {
    vi.useFakeTimers();
    const saveRide = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk gone"))
      .mockResolvedValue({ ok: true });
    const document = createRideDocument({ now: NOW });
    const store = createRideDocumentStore({
      repository: repository({ saveRide, readRideRevision: undefined }),
      now: (): string => NOW,
      document,
    });

    act(() => {
      store.getState().dispatch(placeStartCommand(document, START, (): string => NOW));
    });
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getState().saveStatus.state).toBe("failed");

    act(() => {
      store.getState().retrySave();
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().saveStatus.state).toBe("saved");
  });

  it("serializes checkpoint writes so a delayed older save cannot race a newer one", async () => {
    vi.useFakeTimers();
    let releaseFirst!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let storedRevision = 0;
    const saveRide = vi.fn().mockImplementation(async (saved: { revision: number }) => {
      if (saved.revision === 1) await firstSave;
      storedRevision = saved.revision;
      return { ok: true };
    });
    const document = createRideDocument({ now: NOW });
    const store = createRideDocumentStore({
      repository: repository({ saveRide, readRideRevision: undefined }),
      now: (): string => NOW,
      document,
    });

    act(() => {
      store.getState().dispatch(placeStartCommand(document, START, (): string => NOW));
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(saveRide).toHaveBeenCalledTimes(1);

    const current = store.getState().document;
    act(() => {
      store.getState().dispatch(placeFinishCommand(current, FINISH, (): string => NOW));
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(saveRide).toHaveBeenCalledTimes(1);

    releaseFirst();
    await vi.runAllTimersAsync();
    expect(saveRide).toHaveBeenCalledTimes(2);
    expect(storedRevision).toBe(2);
  });

  it("offers a working retry after a quota failure", async () => {
    vi.useFakeTimers();
    const saveRide = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "quota", preservedRevision: null })
      .mockResolvedValueOnce({ ok: true });
    const document = createRideDocument({ now: NOW });
    const store = createRideDocumentStore({
      repository: repository({ saveRide, readRideRevision: undefined }),
      now: (): string => NOW,
      document,
    });

    act(() => {
      store.getState().dispatch(placeStartCommand(document, START, (): string => NOW));
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(store.getState().saveStatus.state).toBe("quota");

    act(() => {
      store.getState().retrySave();
    });
    expect(saveRide).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(store.getState().saveStatus.state).toBe("saved");
  });

  it("restores from the IndexedDB pointer when the localStorage hint is stale", async () => {
    const fresh = createRideDocument({ now: NOW });
    const stale = createRideDocument({ now: "2026-09-16T12:00:00.000Z" });
    const bootstrapPointer = createLocalStorageBootstrapPointer();
    bootstrapPointer.write({ rideId: stale.rideId, updatedAt: stale.updatedAt });
    const store = createRideDocumentStore({
      repository: repository({
        loadDraftPointer: vi.fn().mockResolvedValue({
          id: "active",
          rideId: fresh.rideId,
          updatedAt: fresh.updatedAt,
        }),
        loadRide: vi.fn().mockResolvedValue({ ok: true, document: fresh }),
      }),
      bootstrapPointer,
      now: (): string => NOW,
    });

    await waitFor(() => expect(store.getState().document.rideId).toBe(fresh.rideId));
    expect(store.getState().restoreStatus.state).toBe("restored");
    expect(bootstrapPointer.read()).toMatchObject({
      status: "found",
      hint: { rideId: fresh.rideId },
    });
  });

  it("recovers the ride named by the localStorage hint when the IndexedDB pointer is gone", async () => {
    const hinted = createRideDocument({ now: "2026-09-16T12:00:00.000Z" });
    const bootstrapPointer = createLocalStorageBootstrapPointer();
    bootstrapPointer.write({ rideId: hinted.rideId, updatedAt: hinted.updatedAt });
    const saveRide = vi.fn().mockResolvedValue({ ok: true });
    const loadRide = vi.fn().mockResolvedValue({ ok: true, document: hinted });
    const store = createRideDocumentStore({
      repository: repository({ saveRide, loadRide }),
      bootstrapPointer,
      now: (): string => NOW,
    });

    // The pointer is not authoritative, but it is the only remaining lead to a
    // durable ride: the store must try it before declaring the hint dead.
    await waitFor(() => expect(loadRide).toHaveBeenCalledWith(hinted.rideId));
    await waitFor(() => expect(store.getState().document.rideId).toBe(hinted.rideId));
    expect(store.getState().restoreStatus.state).toBe("restored");
    expect(bootstrapPointer.read()).toMatchObject({
      status: "found",
      hint: { rideId: hinted.rideId },
    });

    // Rewriting the durable pointer is what stops the next boot from depending on
    // the hint at all.
    await waitFor(() => expect(saveRide).toHaveBeenCalled());
    expect(saveRide.mock.calls[0]?.[0].rideId).toBe(hinted.rideId);
    expect(saveRide.mock.calls[0]?.[1]).toMatchObject({ baseRevision: hinted.revision });
  });

  it("invalidates the localStorage hint when the ride it names no longer exists", async () => {
    const missing = createRideDocument({ now: "2026-09-16T12:00:00.000Z" });
    const bootstrapPointer = createLocalStorageBootstrapPointer();
    bootstrapPointer.write({ rideId: missing.rideId, updatedAt: missing.updatedAt });
    const loadRide = vi.fn().mockResolvedValue(null);
    const store = createRideDocumentStore({
      repository: repository({ loadRide }),
      bootstrapPointer,
      now: (): string => NOW,
    });

    await waitFor(() => expect(loadRide).toHaveBeenCalledWith(missing.rideId));
    await waitFor(() => expect(bootstrapPointer.read()).toEqual({ status: "absent" }));
    expect(store.getState().restoreStatus).toEqual({ state: "idle", message: null });
    expect(store.getState().document.rideId).not.toBe(missing.rideId);
  });

  it("does not let a corrupt localStorage hint break an IndexedDB restore", async () => {
    const fresh = createRideDocument({ now: NOW });
    const bootstrapPointer = createLocalStorageBootstrapPointer();
    localStorage.setItem("opengravel.vnext.bootstrap", "not-json");
    const store = createRideDocumentStore({
      repository: repository({
        loadDraftPointer: vi.fn().mockResolvedValue({
          id: "active",
          rideId: fresh.rideId,
          updatedAt: fresh.updatedAt,
        }),
        loadRide: vi.fn().mockResolvedValue({ ok: true, document: fresh }),
      }),
      bootstrapPointer,
      now: (): string => NOW,
    });

    await waitFor(() => expect(store.getState().document.rideId).toBe(fresh.rideId));
    expect(store.getState().restoreStatus.state).toBe("restored");
  });

  it("invalidates a corrupt hint instead of treating it as a hint that is merely absent", async () => {
    const loadRide = vi.fn().mockResolvedValue(null);
    const bootstrapPointer = createLocalStorageBootstrapPointer();
    localStorage.setItem(BOOTSTRAP_POINTER_KEY, "not-json");
    const store = createRideDocumentStore({
      repository: repository({ loadRide }),
      bootstrapPointer,
      now: (): string => NOW,
    });

    // A cache that cannot be parsed holds no lead: it must be dropped rather than
    // kept as a permanently unreadable "recovery" entry.
    await waitFor(() => expect(bootstrapPointer.read()).toEqual({ status: "absent" }));
    expect(localStorage.getItem(BOOTSTRAP_POINTER_KEY)).toBeNull();
    expect(store.getState().restoreStatus).toEqual({ state: "idle", message: null });
    expect(loadRide).not.toHaveBeenCalled();
  });

  it("keeps an unreadable hint instead of destroying it, so the next boot can try again", async () => {
    const hinted = createRideDocument({ now: "2026-09-16T12:00:00.000Z" });
    const loadRide = vi.fn().mockResolvedValue({ ok: true, document: hinted });
    const invalidate = vi.fn();
    const write = vi.fn();
    // A read that failed says nothing about the hint's value. The port reports that
    // state as `unreadable`; only a parse failure is evidence the cache is dead.
    const bootstrapPointer = {
      read: vi.fn().mockReturnValue({ status: "unreadable" as const }),
      write,
      invalidate,
    };
    const store = createRideDocumentStore({
      repository: repository({ loadRide }),
      bootstrapPointer,
      now: (): string => NOW,
    });

    await waitFor(() => expect(bootstrapPointer.read).toHaveBeenCalled());
    await Promise.resolve();

    expect(loadRide).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(store.getState().restoreStatus).toEqual({ state: "idle", message: null });
    expect(store.getState().document.rideId).not.toBe(hinted.rideId);
  });
});
