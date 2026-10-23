import { describe, expect, it, vi } from "vitest";

import {
  createSpeechCoordinator,
  type SpeechCue,
} from "@/application/ride-session/speech";
import {
  createWakeLockCoordinator,
  type WakeLockPort,
} from "@/application/ride-session/wake-lock";
import { asSessionInstructionId } from "@/domain/ride-session/ids";

const CUE: SpeechCue = {
  instructionId: asSessionInstructionId("instr_route_1_0"),
  kind: "turn",
  maneuver: "left",
  roadName: "Ridge Road",
  distanceMeters: 180,
  targetStopId: null,
};

describe("speech coordinator", () => {
  it("reports an absent speech adapter instead of pretending to speak", async () => {
    const speech = createSpeechCoordinator(null);

    await expect(speech.announce(CUE)).resolves.toBe(false);
    expect(speech.snapshot().status).toBe("unsupported");
  });

  it("speaks one maneuver once per distance band, and never twice for the same band", async () => {
    const speak = vi.fn(async () => undefined);
    const speech = createSpeechCoordinator({ speak });

    expect(await speech.announce(CUE)).toBe(true);
    // Same identity, same band: the rider already heard it.
    expect(await speech.announce({ ...CUE, distanceMeters: 150 })).toBe(false);
    // The next band down is new information.
    expect(await speech.announce({ ...CUE, distanceMeters: 80 })).toBe(true);
    expect(await speech.announce({ ...CUE, distanceMeters: 70 })).toBe(false);
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speech.snapshot()).toMatchObject({ status: "ready", lastInstructionId: CUE.instructionId });
  });

  it("starts the bands over for the next maneuver", async () => {
    const speak = vi.fn(async () => undefined);
    const speech = createSpeechCoordinator({ speak });

    expect(await speech.announce(CUE)).toBe(true);
    expect(await speech.announce({ ...CUE, distanceMeters: 80 })).toBe(true);
    const next = asSessionInstructionId("instr_route_1_1");
    // A new turn is a new announcement even at a distance this one covered.
    expect(await speech.announce({ ...CUE, instructionId: next, distanceMeters: 80 })).toBe(true);
    expect(speak).toHaveBeenCalledTimes(3);
  });

  it("surfaces speech failure without throwing or retry-spamming the cue", async () => {
    const speech = createSpeechCoordinator({
      speak: vi.fn(async () => {
        throw new Error("voice unavailable");
      }),
    });

    await expect(speech.announce(CUE)).resolves.toBe(false);
    await expect(speech.announce(CUE)).resolves.toBe(false);
    expect(speech.snapshot()).toMatchObject({
      status: "failed",
      lastInstructionId: CUE.instructionId,
    });
  });
});

describe("wake-lock coordinator", () => {
  it("keeps failure as visible non-blocking state", async () => {
    const wake = createWakeLockCoordinator({
      request: vi.fn(async () => {
        throw new Error("wake lock denied");
      }),
    });

    await expect(wake.acquire()).resolves.toBe(false);
    expect(wake.snapshot().status).toBe("failed");
    await expect(wake.release()).resolves.toBeUndefined();
  });

  it("requests once and releases once across repeated lifecycle calls", async () => {
    const release = vi.fn(async () => undefined);
    const port: WakeLockPort = { request: vi.fn(async () => ({ release })) };
    const wake = createWakeLockCoordinator(port);

    expect(await wake.acquire()).toBe(true);
    expect(await wake.acquire()).toBe(true);
    await wake.release();
    await wake.release();

    expect(port.request).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(wake.snapshot().status).toBe("released");
  });
});
