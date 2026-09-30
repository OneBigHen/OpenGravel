import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SHA = "a".repeat(40);
function aggregate(report: unknown, attestation = true, maestro?: string, physical = true, appium?: unknown) {
  const scratch = mkdtempSync(join(tmpdir(), "og-acceptance-"));
  const reportPath = join(scratch, "playwright.json");
  writeFileSync(reportPath, JSON.stringify(report));
  const maestroPath = join(scratch, "maestro.xml");
  if (maestro) writeFileSync(maestroPath, maestro);
  const appiumPath = join(scratch, "appium.json");
  if (appium) writeFileSync(appiumPath, JSON.stringify(appium));
  const preflight = join(scratch, "preflight.json");
  writeFileSync(preflight, JSON.stringify({ reports: { [reportPath]: { sha: SHA }, [appiumPath]: { sha: SHA, executor: "iphone", session: { kind: "physical", id: "test-appium" } }, [maestroPath]: { sha: SHA, executor: "iphone", session: { kind: physical ? "physical" : "simulator", id: "test-session" } } } }));
  try {
    const result = spawnSync(process.execPath, [resolve("scripts/qa/aggregate.mjs"), "--playwright", reportPath,
      "--sha", SHA, "--out", scratch, ...(attestation ? ["--preflight", preflight] : []), ...(maestro ? ["--maestro", maestroPath] : []), ...(appium ? ["--appium", appiumPath] : [])], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return { ...JSON.parse(readFileSync(join(scratch, "M01.result.json"), "utf8")), mobile: JSON.parse(readFileSync(join(scratch, "M11.result.json"), "utf8")) };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
function report(results: { projectName: string; status: string }[]) {
  return { config: { projects: [{ name: "critical-chromium" }, { name: "critical-webkit" }] }, suites: [{ specs: [{
    file: "tests/e2e/critical/first-route.spec.ts", ok: true,
    tests: results.map(({ projectName, status }) => ({ projectName, expectedStatus: "passed", results: [{ status }] })),
  }] }] };
}
describe("acceptance campaign evidence", () => {
  it("does not turn an unexpected pass of a known-failing test into mission success", () => {
    const input = report([{ projectName: "critical-chromium", status: "passed" }]);
    input.suites[0]!.specs[0]!.tests[0]!.expectedStatus = "failed";
    expect(aggregate(input).executors.chromium.status).toBe("fail");
  });
  it("never replaces a Maestro failure with an Appium pass", () => {
    const xml = '<testsuite><testcase name="M11-first"><failure/></testcase></testsuite>';
    const result = aggregate(report([]), true, xml, true, { results: [{ mission: "M11", executor: "iphone", status: "pass" }] });
    expect(result.mobile.executors.iphone.status).toBe("fail");
  });
  it("never treats a desktop Appium result as an iPhone run", () => {
    const result = aggregate(report([]), true, undefined, true, { results: [{ mission: "M11", executor: "desktop", status: "pass" }] });
    expect(result.mobile.executors.iphone.status).toBe("not_run");
  });
  it("reads the Maestro mission property rather than requiring an id in the title", () => {
    const xml = '<testsuite><testcase name="plan and start"><properties><property name="missionId" value="M11"/></properties></testcase></testsuite>';
    expect(aggregate(report([]), true, xml).mobile.executors.iphone.status).toBe("pass");
  });
  it("does not discard a failed Maestro case after a passing case for the same mission", () => {
    const xml = '<testsuite><testcase name="M11-first"/><testcase name="M11-second"><failure/></testcase></testsuite>';
    expect(aggregate(report([]), true, xml).mobile.executors.iphone.status).toBe("fail");
  });
  it("keeps simulator evidence separate from a physical iPhone pass", () => {
    const xml = '<testsuite><testcase name="M11-first"/></testsuite>';
    expect(aggregate(report([]), true, xml, false).mobile.executors.iphone.status).toBe("blocked");
  });
  it("keeps Chromium and WebKit outcomes separate in a combined report", () => {
    const result = aggregate(report([{ projectName: "critical-chromium", status: "passed" }, { projectName: "critical-webkit", status: "failed" }]));
    expect(result.executors.chromium.status).toBe("pass");
    expect(result.executors.webkit.status).toBe("fail");
  });
  it("never labels a skipped test as passed", () => {
    expect(aggregate(report([{ projectName: "critical-chromium", status: "skipped" }])).executors.chromium.status).toBe("not_run");
  });
  it("blocks passing evidence without a matching SHA attestation", () => {
    expect(aggregate(report([{ projectName: "critical-chromium", status: "passed" }]), false).executors.chromium.status).toBe("blocked");
  });
});
