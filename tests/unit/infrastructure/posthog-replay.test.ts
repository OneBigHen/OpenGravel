import { describe, expect, it } from "vitest";
import type { CaptureResult } from "posthog-js";
import { sanitizePostHogEvent } from "@/infrastructure/telemetry/posthog-policy";
describe("replay transport", () => {
  it("retains masked replay data while removing navigation URLs from metadata", () => {
    const event = { uuid: "test-event", event: "$snapshot", properties: { $session_id: "session", $snapshot_bytes: 100, $snapshot_data: [{ type: 4, data: { href: "https://example.com/share/private?token=secret", width: 800 } }, { type: 2, data: "already-masked-compressed-dom" }] } } as CaptureResult;
    const result = sanitizePostHogEvent(event, { appVersion: "0", buildId: "test" });
    expect(result?.properties.$snapshot_data).toEqual([{ type: 4, data: { href: "https://opengravel.invalid/", width: 800 } }, { type: 2, data: "already-masked-compressed-dom" }]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
