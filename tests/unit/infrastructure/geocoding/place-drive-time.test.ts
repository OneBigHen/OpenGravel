import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeDriveTime } from "@/infrastructure/geocoding/place-drive-time";

const provider = vi.hoisted(() => ({ beginAttempt: vi.fn(), candidates: vi.fn() }));
vi.mock("@/infrastructure/routing/api-provider", () => ({ createApiRouteProvider: () => provider }));
const from = { lat: 40.8, lon: -75.7 }, to = { lat: 40.6, lon: -75.9 };
beforeEach(() => vi.clearAllMocks());

describe("read-only place drive time", () => {
  it("asks the existing routing port for an efficient route and reads its measured time", async () => {
    provider.candidates.mockResolvedValue({ candidates: [{ durationSeconds: 123 }, { durationSeconds: 96 }] });
    const signal = new AbortController().signal;
    expect(await placeDriveTime(from, to, signal)).toBe(96);
    expect(provider.candidates).toHaveBeenCalledWith(expect.objectContaining({
      origin: from, destination: to, options: expect.objectContaining({ roadCharacter: "efficient", includeAlternatives: false }),
    }), signal);
    expect(provider.beginAttempt).toHaveBeenCalledOnce();
  });
  it("leaves drive time unknown when routing is unavailable", async () => {
    provider.candidates.mockRejectedValue(new Error("offline"));
    expect(await placeDriveTime(from, to, new AbortController().signal)).toBeNull();
  });
  it("does not start a preview after cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await placeDriveTime(from, to, controller.signal)).toBeNull();
    expect(provider.candidates).not.toHaveBeenCalled();
  });
});
