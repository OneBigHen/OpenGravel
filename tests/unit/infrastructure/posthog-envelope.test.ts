import { expect, it } from "vitest";
import type { CaptureResult } from "posthog-js";
import { sanitizePostHogEvent } from "@/infrastructure/telemetry/posthog-policy";
it("reconstructs the whole envelope without SDK person metadata or internal URLs", () => {
 const result = sanitizePostHogEvent({ uuid: "test", event: "planner_opened", properties: {}, $set: { name: "private" }, $set_once: { home: "private" }, _url: "/share/private" } as CaptureResult, { appVersion: "0", buildId: "test" });
 expect(JSON.stringify(result)).not.toContain("private");
});
