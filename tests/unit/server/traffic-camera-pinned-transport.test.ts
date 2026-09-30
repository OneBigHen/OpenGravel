import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

import {
  createCameraUrlPolicy,
  fetchPinnedCameraUrl,
  type CameraDnsLookup,
} from "@/server/traffic-cameras/url-security";

const publicLookup: CameraDnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("pinned camera HTTPS transport", () => {
  it("handles Node all-address lookup callbacks and pins the vetted address", async () => {
    const requestHandle = {
      once: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };
    requestMock.mockImplementationOnce((_url: URL, options: unknown, callback: (response: Readable) => void) => {
      const requestOptions = options as {
        readonly autoSelectFamily?: boolean;
        readonly lookup: (
          hostname: string,
          options: { readonly all?: boolean },
          callback: (error: Error | null, address: string | readonly { readonly address: string; readonly family: number }[], family?: number) => void,
        ) => void;
      };
      expect(requestOptions.autoSelectFamily).toBe(false);
      requestOptions.lookup("njtpk-wink.xcmdata.org", { all: true }, (error, address) => {
        expect(error).toBeNull();
        expect(address).toEqual([{ address: "93.184.216.34", family: 4 }]);
      });

      const response = new Readable({ read() { this.push("ok"); this.push(null); } });
      Object.assign(response, {
        statusCode: 200,
        statusMessage: "OK",
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
      callback(response);
      return requestHandle;
    });

    const response = await fetchPinnedCameraUrl(
      createCameraUrlPolicy("NJ", {}, { lookup: publicLookup }),
      "https://njtpk-wink.xcmdata.org/live/main.m3u8",
      {},
      { request: requestMock as unknown as typeof import("node:https").request },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(requestHandle.once).toHaveBeenCalledWith("error", expect.any(Function));
    expect(requestHandle.end).toHaveBeenCalledOnce();
  });

  for (const status of [204, 205, 304]) {
    it(`returns a null body for bodyless upstream status ${status} across the async callback boundary`, async () => {
      const requestHandle = { once: vi.fn(), write: vi.fn(), end: vi.fn() };
      requestMock.mockImplementationOnce((_url: URL, _options: unknown, callback: (response: Readable) => void) => {
        const response = new Readable({ read() { this.push("must-not-become-a-Response-body"); this.push(null); } });
        Object.assign(response, { statusCode: status, statusMessage: "No body", headers: {} });
        setTimeout(() => callback(response), 0);
        return requestHandle;
      });

      const result = fetchPinnedCameraUrl(
        createCameraUrlPolicy("NJ", {}, { lookup: publicLookup }),
        "https://njtpk-wink.xcmdata.org/live/bodyless.m3u8",
        {},
        { request: requestMock as unknown as typeof import("node:https").request },
      );

      if (status === 304) {
        await expect(result).rejects.toMatchObject({ code: "redirect" });
      } else {
        const response = await result;
        expect(response.status).toBe(status);
        expect(response.body).toBeNull();
        expect(await response.text()).toBe("");
      }
    });
  }

  it("turns an invalid upstream status into a controlled rejection", async () => {
    const requestHandle = { once: vi.fn(), write: vi.fn(), end: vi.fn() };
    requestMock.mockImplementationOnce((_url: URL, _options: unknown, callback: (response: Readable) => void) => {
      const response = new Readable({ read() { this.push(null); } });
      Object.assign(response, { statusCode: 700, statusMessage: "Invalid", headers: {} });
      setTimeout(() => callback(response), 0);
      return requestHandle;
    });

    await expect(fetchPinnedCameraUrl(
      createCameraUrlPolicy("NJ", {}, { lookup: publicLookup }),
      "https://njtpk-wink.xcmdata.org/live/invalid-status.m3u8",
      {},
      { request: requestMock as unknown as typeof import("node:https").request },
    )).rejects.toMatchObject({ code: "upstream-response" });
  });
});
