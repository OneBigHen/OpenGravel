import { describe, expect, it, vi } from "vitest";

import { spokenManeuver } from "@/application/ride-session/ride-focus-view-model";
import type { SessionInstruction } from "@/domain/ride-session/types";
import { createBrowserSpeech } from "@/infrastructure/ride/browser-speech";

function instruction(overrides: Partial<SessionInstruction> = {}): SessionInstruction {
  return { instructionId: "ins_1" as SessionInstruction["instructionId"], kind: "turn", maneuver: "left", roadName: "1st Avenue", distanceMeters: 250, targetStopId: null, ...overrides };
}

describe("spokenManeuver", () => {
  it("speaks the banner's words as one sentence with units spelled out", () => {
    expect(spokenManeuver(instruction())).toBe("In 800 feet, turn left onto 1st Avenue.");
    expect(spokenManeuver(instruction({ maneuver: "slight-right", roadName: "PA-23", distanceMeters: 804.672 }))).toBe("In 0.5 miles, bear right onto PA-23.");
    expect(spokenManeuver(instruction({ distanceMeters: 1609.344 }))).toBe("In 1 mile, turn left onto 1st Avenue.");
    expect(spokenManeuver(instruction({ kind: "continue", maneuver: null, roadName: "Valley Forge Road", distanceMeters: 3218.7 }))).toBe("In 2 miles, continue on Valley Forge Road.");
    expect(spokenManeuver(instruction({ kind: "arrive", maneuver: null, roadName: null, distanceMeters: 5 }))).toBe("Arrive at your destination now.");
  });
});

class FakeUtterance {
  text: string; lang = ""; volume = 1;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) { this.text = text; }
}

function scope() {
  const spoken: FakeUtterance[] = [];
  const listeners = new Map<string, () => void>();
  const synth = { speak: vi.fn((u: FakeUtterance) => { spoken.push(u); }), cancel: vi.fn() };
  const document = {
    addEventListener: vi.fn((type: string, fn: () => void) => { listeners.set(type, fn); }),
    removeEventListener: vi.fn((type: string) => { listeners.delete(type); }),
  };
  return { spoken, synth, listeners, scope: { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance, document } as never };
}

describe("createBrowserSpeech", () => {
  it("is absent without the Web Speech API", () => {
    expect(createBrowserSpeech({})).toBeUndefined();
  });

  it("speaks each cue, replacing any stale direction, and resolves when it ends", async () => {
    const s = scope();
    const speech = createBrowserSpeech(s.scope);
    if (speech === undefined) throw new Error("expected speech");
    const done = speech.speak(instruction());
    expect(s.synth.cancel).toHaveBeenCalledOnce();
    expect(s.spoken.at(-1)?.text).toBe("In 800 feet, turn left onto 1st Avenue.");
    expect(s.spoken.at(-1)?.lang).toBe("en-US");
    s.spoken.at(-1)?.onend?.();
    await expect(done).resolves.toBeUndefined();
  });

  it("treats an interrupted cue as spoken and a real engine error as a failure", async () => {
    const s = scope();
    const speech = createBrowserSpeech(s.scope);
    if (speech === undefined) throw new Error("expected speech");
    const interrupted = speech.speak(instruction());
    s.spoken.at(-1)?.onerror?.({ error: "interrupted" });
    await expect(interrupted).resolves.toBeUndefined();
    const failed = speech.speak(instruction());
    s.spoken.at(-1)?.onerror?.({ error: "synthesis-failed" });
    await expect(failed).rejects.toThrow("synthesis-failed");
  });

  it("unlocks speech on the rider's first tap, once (iOS needs a gesture)", () => {
    const s = scope();
    createBrowserSpeech(s.scope);
    s.listeners.get("pointerdown")?.();
    expect(s.spoken[0]).toMatchObject({ text: " ", volume: 0 });
    expect(s.listeners.has("pointerdown")).toBe(false);
  });
});
