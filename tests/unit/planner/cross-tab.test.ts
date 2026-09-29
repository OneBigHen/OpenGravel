import { describe, expect, it, vi } from "vitest";

import { createRideDocument } from "@/domain/ride/create";
import {
  detectCrossTabConflict,
  forkRideDocument,
} from "@/application/planner/cross-tab";

describe("cross-tab revision guard", () => {
  it("reports a newer revision written by another tab", () => {
    expect(
      detectCrossTabConflict({
        storedRevision: 3,
        storedWriterToken: "tab-b",
        ourBaseRevision: 1,
        ourRevision: 2,
        writerToken: "tab-a",
      }),
    ).toEqual({ storedRevision: 3, ourRevision: 2 });
  });

  it("does not report our own write or a revision at our base", () => {
    expect(
      detectCrossTabConflict({
        storedRevision: 3,
        storedWriterToken: "tab-a",
        ourBaseRevision: 2,
        ourRevision: 3,
        writerToken: "tab-a",
      }),
    ).toBeNull();
    expect(
      detectCrossTabConflict({
        storedRevision: 2,
        storedWriterToken: "tab-b",
        ourBaseRevision: 2,
        ourRevision: 3,
        writerToken: "tab-a",
      }),
    ).toBeNull();
  });

  it("forks the rider copy with a fresh identity and derived provenance", () => {
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const randomUUID = vi.spyOn(crypto, "randomUUID");
    randomUUID.mockReturnValue("fork-id");

    const fork = forkRideDocument(document, "2026-09-17T12:05:00.000Z");

    expect(fork.rideId).toBe("ride_fork-id");
    expect(fork.rideId).not.toBe(document.rideId);
    expect(fork.provenance).toEqual({ type: "derived", sourceId: document.rideId });
    expect(fork.intent).toEqual(document.intent);
  });
});
