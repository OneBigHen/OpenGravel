/** Structured speech port and no-spam coordinator (08 §7). */

import type { StopId } from "@/domain/ride/ids";
import type { SessionInstructionId } from "@/domain/ride-session/ids";
import type { SessionInstruction } from "@/domain/ride-session/types";

/**
 * The distance bands (metres) one maneuver is announced in, farthest first: two
 * miles (3 218 m), half a mile (805 m) and hundred metres. A rider hears the
 * turn on the first measurement inside each band — so a turn that only becomes
 * next inside a band is still announced once, at the distance it really is — and
 * hears nothing after passing it. Announcements come from the *live* distance,
 * so the words always match where the rider actually is.
 */
export const SPEECH_STAGES_METERS: readonly number[] = [3_218, 805, 100];

/**
 * Structured guidance only. A browser/native adapter owns localization and
 * spoken copy; the navigation engine never fabricates a provider instruction.
 * `distanceMeters` is the distance measured on the frame that offered the cue,
 * not the distance the instruction was issued at.
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
  /**
   * Offers one maneuver measurement to the coordinator. True only when this
   * call actually spoke: the first measurement inside a band, or the first one
   * inside a nearer band than anything already spoken for this instruction.
   * A repeated call in the same band is silent, and a new instruction identity
   * starts the bands over.
   */
  announce(cue: SpeechCue): Promise<boolean>;
  reset(): Promise<void>;
}

export function createSpeechCoordinator(port: SpeechPort | null): SpeechCoordinator {
  // Per maneuver, the bands already announced. Keyed by identity so the next
  // turn is announced even at a distance the previous one already covered.
  let bands: { instructionId: SessionInstructionId; spoken: Set<number> } | null = null;
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
      if (bands === null || bands.instructionId !== cue.instructionId) {
        bands = { instructionId: cue.instructionId, spoken: new Set() };
      }
      const current = bands;
      const crossed = SPEECH_STAGES_METERS.filter(
        (threshold) => cue.distanceMeters <= threshold,
      );
      if (crossed.every((threshold) => current.spoken.has(threshold))) return false;
      // Fence every crossed band before awaiting: two fixes cannot race the same
      // band into the speech queue, a jump across several bands speaks once, and
      // a failing adapter cannot retry-spam every second.
      for (const threshold of crossed) current.spoken.add(threshold);
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
      bands = null;
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
