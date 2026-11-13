/**
 * What the guided ride Menu says about recording (OG-18).
 *
 * The Menu used to say "Not recording. The track was discarded" next to a row
 * promising "Keep recording", and the press that throws the track away looked
 * like every other row. One state, said once: the Recording row reads the state
 * it is in, turning it off asks once in red (it deletes the track), and turning
 * it on is the green row. "Stop following this route" only promises recording
 * while there is a recording to keep.
 */

export interface RecordingRowInput {
  /** A recording is running. */
  readonly recording: boolean;
  /** A start or stop is in flight. */
  readonly busy: boolean;
  /** Turning it off failed and must be retried. */
  readonly cleanupPending: boolean;
  /** The rider pressed once to turn it off and the row is asking to be sure. */
  readonly asking: boolean;
}

export type RecordingRowTone = "plain" | "primary" | "danger";

export interface RecordingRowCopy {
  readonly label: string;
  readonly hint: string;
  readonly tone: RecordingRowTone;
}

/** How long the "Delete the track?" question waits for its second press. */
export const RECORDING_STOP_ASK_MS = 5_000;

/** The guided Menu's Recording row: its words and how it looks. */
export function recordingRowCopy(input: RecordingRowInput): RecordingRowCopy {
  if (input.busy) return { label: "Recording", hint: "Working…", tone: "plain" };
  if (input.cleanupPending) return { label: "Stop recording", hint: "Didn't stop, try again", tone: "danger" };
  if (!input.recording) return { label: "Start recording", hint: "Recording is off", tone: "primary" };
  if (input.asking) return { label: "Stop and delete the track?", hint: "Tap again", tone: "danger" };
  return { label: "Recording", hint: "On", tone: "plain" };
}

/** The hint under "Stop following this route": what keeps going after the press. */
export function stopFollowingHint(recording: boolean): string {
  return recording ? "Keep riding and recording" : "Keep riding";
}

/** The one line the Menu shows after recording was turned off. */
export const RECORDING_OFF_NOTICE = "Recording is off. The track so far was deleted; your ride numbers are kept.";
