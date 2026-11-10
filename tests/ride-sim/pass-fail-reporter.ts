/**
 * The pass/fail table printed by `npm run ride-sim`.
 *
 * Vitest's default reporter is still attached (it shows failure detail), but a
 * fifty-case simulation needs one readable matrix at the end: which track,
 * which scenario, and whether the rider promise held.
 */

import type { Reporter, TestCase } from "vitest/node";

interface Row {
  readonly track: string;
  readonly scenario: string;
  readonly result: "passed" | "failed" | "skipped" | "pending";
  readonly durationMs: number;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

export default class RideSimTableReporter implements Reporter {
  private readonly rows: Row[] = [];

  onTestCaseResult(testCase: TestCase): void {
    const result = testCase.result();
    const parent = testCase.parent;
    this.rows.push({
      track: parent.type === "suite" ? parent.name : "ride-sim",
      scenario: testCase.name,
      result: result.state,
      durationMs: testCase.diagnostic()?.duration ?? 0,
    });
  }

  onTestRunEnd(): void {
    if (this.rows.length === 0) return;
    const trackWidth = Math.max(5, ...this.rows.map((row) => row.track.length));
    const scenarioWidth = Math.max(8, ...this.rows.map((row) => row.scenario.length));
    const line = `+-${"-".repeat(trackWidth)}-+-${"-".repeat(scenarioWidth)}-+--------+--------+`;
    const format = (row: Row): string =>
      `| ${pad(row.track, trackWidth)} | ${pad(row.scenario, scenarioWidth)} | ` +
      `${pad(row.result.toUpperCase(), 6)} | ${pad(`${Math.round(row.durationMs)} ms`, 6)} |`;

    const passed = this.rows.filter((row) => row.result === "passed").length;
    const failed = this.rows.filter((row) => row.result === "failed").length;
    const skipped = this.rows.filter(
      (row) => row.result === "skipped" || row.result === "pending",
    ).length;
    const totalMs = this.rows.reduce((sum, row) => sum + row.durationMs, 0);

    process.stdout.write("\nRide simulation — every turn, replay by replay\n");
    process.stdout.write(`${line}\n`);
    process.stdout.write(`| ${pad("Track", trackWidth)} | ${pad("Scenario", scenarioWidth)} | Result | Time   |\n`);
    process.stdout.write(`${line}\n`);
    for (const row of this.rows) process.stdout.write(`${format(row)}\n`);
    process.stdout.write(`${line}\n`);
    process.stdout.write(
      `Summary: ${passed} passed, ${failed} failed, ${skipped} skipped ` +
        `(${this.rows.length} cases, ${(totalMs / 1_000).toFixed(1)} s of test time)\n\n`,
    );
  }
}
