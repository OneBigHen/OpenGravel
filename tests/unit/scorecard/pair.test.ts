import { describe, expect, it } from "vitest";
import { checkPair, lower, pairRows, type RunFile } from "../../../scripts/scorecard/pair";
import type { Row, Verdict } from "../../../scripts/scorecard/types";

const row = (id: string, verdict: Verdict): Row => ({ ride: { id, label: id } as Row["ride"], verdict } as Row);
const run = (verdicts: Verdict[], over: Partial<RunFile> = {}): RunFile => ({
  headline: "Wins", set: "nj", gitHead: "abc", router: "http://127.0.0.1:8988", atlasSha256: "a",
  graph: { importDate: "2026-11-12T13:21:58Z", fingerprint: "f" },
  rows: verdicts.map((verdict, i) => row(`r${i}`, verdict)), ...over,
});
const ten = (first: Verdict): Verdict[] => [first, ...Array<Verdict>(9).fill("Tie")];

describe("two-run rule", () => {
  it("counts a row only when both runs agree, else the lower verdict", () => {
    expect(lower("Win", "Tie")).toBe("Tie");
    expect(lower("Loss", "Win")).toBe("Loss");
    const rows = pairRows(run(ten("Win")), run(ten("Tie")));
    expect(rows[0]).toMatchObject({ first: "Win", second: "Tie", counted: "Tie" });
  });

  it("refuses partial or stitched runs and runs on different maps", () => {
    expect(() => checkPair(run(ten("Win")), run(ten("Win")))).not.toThrow();
    expect(() => checkPair(run(["Win"]), run(ten("Win")))).toThrow(/not one whole run/);
    expect(() => checkPair(run(ten("Win"), { headline: undefined }), run(ten("Win")))).toThrow(/not one whole run/);
    expect(() => checkPair(run(ten("Win"), { graph: undefined }), run(ten("Win")))).toThrow(/which map/);
    expect(() => checkPair(run(ten("Win")), run(ten("Win"), { graph: { importDate: "later", fingerprint: "f" } }))).toThrow(/map/);
  });
});
