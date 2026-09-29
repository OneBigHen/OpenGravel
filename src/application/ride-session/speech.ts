/** Structured speech port and no-spam coordinator (08 §7). */

import type { StopId } from "@/domain/ride/ids";
import type { SessionInstructionId } from "@/domain/ride-session/ids";
import type { SessionInstruction } from "@/domain/ride-session/types";

/**
 * Structured guidance only. A browser/native adapter owns localization and
 * spoken copy; the navigation engine never fabricates a provider instruction.
 */
export interface SpeechCue {
  readonly instructionId: SessionInstructionId;
  readonly kind: SessionInstruction["kind"];
  readonly maneuver: SessionInstruction["maneuver"];
  readonly roadName: string | null;
  readonly distanceMeters: number;
  readonly targetStopId: StopId | null;
}

export interface SpeechPort {
  speak(cue: SpeechCue): Promise<void> | void;
  /**
   * A sentence that is not a maneuver: a Free Ride opportunity (COPILOT §6).
   * Adapters without it simply stay silent for such copy.
   */
  speakText?(text: string): Promise<void> | void;
  cancel?(): Promise<void> | void;
}

export interface SpeechState {
  readonly status: "idle" | "speaking" | "ready" | "unsupported" | "failed";
  readonly lastInstructionId: SessionInstructionId | null;
  readonly message: string | null;
}

export interface SpeechCoordinator {
  snapshot(): SpeechState;
  /** True only when this call successfully spoke a previously unseen identity. */
  announce(cue: SpeechCue): Promise<boolean>;
  reset(): Promise<void>;
}

export function createSpeechCoordinator(port: SpeechPort | null): SpeechCoordinator {
  const attempted = new Set<SessionInstructionId>();
  let state: SpeechState = {
    status: port === null ? "unsupported" : "idle",
    lastInstructionId: null,
    message: port === null ? "Spoken guidance is not supported on this device." : null,
  };

  return {
    snapshot(): SpeechState {
      return state;
    },

    async announce(cue: SpeechCue): Promise<boolean> {
      if (port === null) return false;
      if (attempted.has(cue.instructionId)) return false;
      // Fence before awaiting: two fixes cannot race the same instruction into
      // the speech queue, and a failing adapter cannot retry-spam every second.
      attempted.add(cue.instructionId);
      state = {
        status: "speaking",
        lastInstructionId: cue.instructionId,
        message: null,
      };
      try {
        await port.speak(cue);
        state = {
          status: "ready",
          lastInstructionId: cue.instructionId,
          message: null,
        };
        return true;
      } catch {
        state = {
          status: "failed",
          lastInstructionId: cue.instructionId,
          message: "Spoken guidance is unavailable.",
        };
        return false;
      }
    },

    async reset(): Promise<void> {
      attempted.clear();
      if (port === null) return;
      try {
        await port.cancel?.();
        state = { status: "idle", lastInstructionId: null, message: null };
      } catch {
        state = {
          status: "failed",
          lastInstructionId: null,
          message: "Spoken guidance could not be stopped.",
        };
      }
    },
  };
}
