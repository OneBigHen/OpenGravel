/**
 * Spoken turn guidance through the Web Speech API (08 §7). It works in Safari,
 * Chrome and the iOS app's WKWebView. The navigation engine hands over
 * structured cues; this adapter owns the words (`spokenManeuver`).
 */

import { spokenManeuver } from "@/application/ride-session/ride-focus-view-model";
import type { SpeechPort } from "@/application/ride-session/speech";

interface SpeechScope {
  readonly speechSynthesis?: SpeechSynthesis;
  readonly SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  readonly document?: Pick<Document, "addEventListener" | "removeEventListener">;
}

/** Longest a cue may hold the queue; some engines never fire `end`. */
const SPEAK_TIMEOUT_MS = 10_000;

export function createBrowserSpeech(scope: SpeechScope = globalThis as SpeechScope): SpeechPort | undefined {
  const synth = scope.speechSynthesis;
  const Utterance = scope.SpeechSynthesisUtterance;
  if (synth === undefined || Utterance === undefined) return undefined;

  // iOS only lets a page speak after a user gesture. The rider's first tap
  // (Start ride, Resume) unlocks it with a silent utterance.
  const unlock = (): void => {
    const silent = new Utterance(" ");
    silent.volume = 0;
    synth.speak(silent);
    scope.document?.removeEventListener("pointerdown", unlock);
  };
  scope.document?.addEventListener("pointerdown", unlock);

  const say = (text: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const utterance = new Utterance(text);
      utterance.lang = "en-US";
      const timer = setTimeout(resolve, SPEAK_TIMEOUT_MS);
      utterance.onend = () => { clearTimeout(timer); resolve(); };
      utterance.onerror = (event) => {
        clearTimeout(timer);
        // A newer cue interrupting this one is not a failure.
        if (event.error === "interrupted" || event.error === "canceled") resolve();
        else reject(new Error(event.error));
      };
      // The newest maneuver wins: never queue stale directions.
      synth.cancel();
      synth.speak(utterance);
    });

  return {
    speak(cue) {
      return say(spokenManeuver(cue));
    },
    speakText(text) {
      return say(text);
    },
    cancel() {
      synth.cancel();
    },
  };
}
