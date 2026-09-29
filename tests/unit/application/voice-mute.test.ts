import { describe, expect, it, vi } from "vitest";

import { isVoiceMuted, mutableSpeech, setVoiceMuted } from "@/application/ride-session/voice-mute";
import type { SpeechCue } from "@/application/ride-session/speech";

const CUE = { instructionId: "i1", kind: "turn", maneuver: "left", roadName: "1st Avenue", distanceMeters: 200, targetStopId: null } as unknown as SpeechCue;

describe("voice mute", () => {
  it("says nothing while muted and speaks again when unmuted", () => {
    const speak = vi.fn();
    const speech = mutableSpeech({ speak });
    setVoiceMuted(true);
    expect(isVoiceMuted()).toBe(true);
    void speech.speak(CUE);
    expect(speak).not.toHaveBeenCalled();
    setVoiceMuted(false);
    void speech.speak(CUE);
    expect(speak).toHaveBeenCalledWith(CUE);
  });
});
