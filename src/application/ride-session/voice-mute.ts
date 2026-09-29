/**
 * The rider's "mute voice" choice (the ride screen's speaker button). It lives
 * outside the ride session: muting is a preference, not a ride event, so it
 * survives a reload and the next ride. Turn alerts (a tap, the Lock Screen)
 * still fire while muted; only the spoken words stop.
 */

import type { SpeechPort } from "./speech";

const KEY = "ogv.ride.voiceMuted";
const listeners = new Set<() => void>();
let muted: boolean | null = null;

export function isVoiceMuted(): boolean {
  if (muted === null) {
    try {
      muted = globalThis.localStorage?.getItem(KEY) === "1";
    } catch {
      muted = false;
    }
  }
  return muted;
}

export function setVoiceMuted(next: boolean): void {
  muted = next;
  try {
    globalThis.localStorage?.setItem(KEY, next ? "1" : "0");
  } catch {
    // Private mode: the choice lasts this page only.
  }
  for (const listener of listeners) listener();
}

export function subscribeVoiceMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A speech port that says nothing while the rider has muted the voice. */
export function mutableSpeech(port: SpeechPort): SpeechPort {
  return {
    speak(cue) {
      if (isVoiceMuted()) return;
      return port.speak(cue);
    },
    ...(port.speakText === undefined ? {} : {
      speakText(text: string) {
        if (isVoiceMuted()) return;
        return port.speakText?.(text);
      },
    }),
    ...(port.cancel === undefined ? {} : { cancel: () => port.cancel?.() }),
  };
}
