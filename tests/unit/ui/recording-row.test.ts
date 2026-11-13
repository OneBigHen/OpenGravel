import { describe, expect, it } from "vitest";

import { RECORDING_OFF_NOTICE, recordingRowCopy, stopFollowingHint } from "@/ui/ride/recording-row";

const idle = { recording: true, busy: false, cleanupPending: false, asking: false };

describe("the guided Menu's recording words (OG-18)", () => {
  it("says the state it is in, once", () => {
    expect(recordingRowCopy(idle)).toEqual({ label: "Recording", hint: "On", tone: "plain" });
    expect(recordingRowCopy({ ...idle, recording: false })).toEqual({
      label: "Start recording",
      hint: "Recording is off",
      tone: "primary",
    });
  });

  it("asks in red before turning recording off deletes the track", () => {
    expect(recordingRowCopy({ ...idle, asking: true })).toEqual({
      label: "Stop and delete the track?",
      hint: "Tap again",
      tone: "danger",
    });
    // Nothing to delete: no question.
    expect(recordingRowCopy({ ...idle, recording: false, asking: true }).tone).toBe("primary");
  });

  it("shows work in flight and a failed stop plainly", () => {
    expect(recordingRowCopy({ ...idle, busy: true }).hint).toBe("Working…");
    expect(recordingRowCopy({ ...idle, cleanupPending: true })).toMatchObject({ label: "Stop recording", tone: "danger" });
  });

  it("only promises recording on 'Stop following' while something is recording", () => {
    expect(stopFollowingHint(true)).toBe("Keep riding and recording");
    expect(stopFollowingHint(false)).toBe("Keep riding");
  });

  it("explains a stopped recording in rider words", () => {
    expect(RECORDING_OFF_NOTICE).not.toMatch(/discarded|statistics/);
    expect(RECORDING_OFF_NOTICE).toMatch(/^Recording is off\./);
  });
});
