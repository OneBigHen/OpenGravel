import { describe, expect, it, vi } from "vitest";

import type { AdvisorMessage, AdvisorOutputSchema } from "@/application/advisor";
import {
  advisorCapabilityFromEnv,
  advisorErrorClassForStatus,
  advisorTransportFromEnv,
  advisorTransportSettingsFromEnv,
  createAdvisorTransport,
} from "@/infrastructure/advisor";

const SETTINGS = {
  endpoint: "https://models.example.test/v1/chat/completions",
  model: "model-a",
  apiKey: "super-secret-key",
} as const;

const MESSAGES: readonly AdvisorMessage[] = [
  { role: "user", content: "Make it twistier." },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("advisor transport adapter + server-side config (10 §14–§15)", () => {
  it("reads no settings and stays honestly disabled with zero model keys", () => {
    expect(advisorTransportSettingsFromEnv({})).toBeNull();
    expect(advisorTransportFromEnv({})).toBeNull();
    const capability = advisorCapabilityFromEnv({});
    expect(capability.status).toBe("unavailable");
  });

  it("treats a missing key as disabled even when endpoint and model are set", () => {
    const env = { ADVISOR_ENDPOINT: SETTINGS.endpoint, ADVISOR_MODEL: SETTINGS.model };
    expect(advisorTransportSettingsFromEnv(env)).toBeNull();
    expect(advisorCapabilityFromEnv(env).status).toBe("unavailable");
  });

  it("uses the OpenRouter deployment keys with endpoint and model defaults", () => {
    expect(advisorTransportSettingsFromEnv({
      OPENROUTER_API_KEY: "shared-key",
      OPENROUTER_MODEL: "router/model",
    })).toEqual({
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      model: "router/model",
      apiKey: "shared-key",
    });
    expect(advisorTransportSettingsFromEnv({
      OPENROUTER_API_KEY: "shared-key",
      ADVISOR_OPENROUTER_API_KEY: "advisor-key",
      OPENROUTER_MODEL: "router/model",
    })?.apiKey).toBe("advisor-key");
    expect(advisorTransportSettingsFromEnv({ OPENROUTER_API_KEY: "shared-key" })?.model)
      .toBe("openai/gpt-4o-mini");
  });

  it("maps documented HTTP statuses to error classes", () => {
    expect(advisorErrorClassForStatus(429)).toBe("rate-limit");
    expect(advisorErrorClassForStatus(408)).toBe("timeout");
    expect(advisorErrorClassForStatus(504)).toBe("timeout");
    expect(advisorErrorClassForStatus(400)).toBe("invalid-request");
    // An empty model account (OpenRouter "insufficient credits") is an outage.
    expect(advisorErrorClassForStatus(402)).toBe("unavailable");
    expect(advisorErrorClassForStatus(422)).toBe("invalid-request");
    expect(advisorErrorClassForStatus(404)).toBe("unsupported-action");
    expect(advisorErrorClassForStatus(405)).toBe("unsupported-action");
    expect(advisorErrorClassForStatus(401)).toBe("unavailable");
    expect(advisorErrorClassForStatus(403)).toBe("unavailable");
    expect(advisorErrorClassForStatus(500)).toBe("unavailable");
    expect(advisorErrorClassForStatus(503)).toBe("unavailable");
  });

  it("returns a typed rate-limit failure with rider-safe copy", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: { message: "slow down vendor-9000" } }, 429),
    );
    const transport = createAdvisorTransport(SETTINGS, { fetcher });
    const result = await transport.send({ messages: MESSAGES });

    expect(result).toMatchObject({ ok: false, errorClass: "rate-limit", retryable: true });
    if (result.ok) throw new Error("expected a failure");
    expect(result.message).not.toMatch(/vendor-9000|super-secret-key|example\.test/i);
  });

  it("maps a network rejection to unavailable without leaking the detail", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNREFUSED 10.0.0.1 internal-secret-host"));
    const transport = createAdvisorTransport(SETTINGS, { fetcher });
    const result = await transport.send({ messages: MESSAGES });

    expect(result).toMatchObject({ ok: false, errorClass: "unavailable" });
    if (result.ok) throw new Error("expected a failure");
    expect(result.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.1|internal-secret-host/i);
  });

  it("returns timeout when the internal deadline passes", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const transport = createAdvisorTransport(SETTINGS, { fetcher, timeoutMs: 50 });
      const pending = transport.send({ messages: MESSAGES });
      await vi.advanceTimersByTimeAsync(50);
      expect(await pending).toMatchObject({ ok: false, errorClass: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a malformed completion as unavailable", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ choices: [] }));
    const transport = createAdvisorTransport(SETTINGS, { fetcher });
    expect(await transport.send({ messages: MESSAGES })).toMatchObject({
      ok: false,
      errorClass: "unavailable",
    });
  });

  it("extracts the completion text from a documented response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "Twistier by about 12 min." } }] }),
    );
    const transport = createAdvisorTransport(SETTINGS, { fetcher });
    expect(await transport.send({ messages: MESSAGES })).toEqual({
      ok: true,
      text: "Twistier by about 12 min.",
    });
  });

  it("targets the configured endpoint and model and swaps purely by config", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const a = createAdvisorTransport(
      { endpoint: "https://a.example.test/chat", model: "model-a", apiKey: "k" },
      { fetcher },
    );
    const b = createAdvisorTransport(
      { endpoint: "https://b.example.test/chat", model: "model-b", apiKey: "k" },
      { fetcher },
    );
    await a.send({ messages: MESSAGES });
    await b.send({ messages: MESSAGES });

    const [urlA, initA] = fetcher.mock.calls[0] as [URL | string, RequestInit];
    const [urlB, initB] = fetcher.mock.calls[1] as [URL | string, RequestInit];
    expect(String(urlA)).toBe("https://a.example.test/chat");
    expect(JSON.parse(String(initA.body)).model).toBe("model-a");
    expect(String(urlB)).toBe("https://b.example.test/chat");
    expect(JSON.parse(String(initB.body)).model).toBe("model-b");
  });

  it("requests strict JSON Schema output through the model-neutral port", async () => {
    const outputSchema: AdvisorOutputSchema = {
      name: "ride_proposal",
      schema: { type: "object", additionalProperties: false, properties: {} },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "{}" } }] }),
    );
    const transport = createAdvisorTransport(SETTINGS, { fetcher });
    await transport.send({ messages: MESSAGES, outputSchema });

    const [, init] = fetcher.mock.calls[0] as [URL | string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ride_proposal",
          strict: true,
          schema: outputSchema.schema,
        },
      },
      max_tokens: 700,
    });
  });

  it("bounds OpenRouter proposal tokens and requests no reasoning tokens", async () => {
    const outputSchema: AdvisorOutputSchema = {
      name: "ride_proposal",
      schema: { type: "object", additionalProperties: false, properties: {} },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "{}" } }] }),
    );
    const transport = createAdvisorTransport({
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      model: "router/model",
      apiKey: SETTINGS.apiKey,
    }, { fetcher });
    await transport.send({ messages: MESSAGES, outputSchema });

    const [, init] = fetcher.mock.calls[0] as [URL | string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      max_completion_tokens: 1_200,
      reasoning: { effort: "none" },
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty("max_tokens");
  });

  it("uses the key server-side and never exposes it in a result", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const transport = createAdvisorTransport(SETTINGS, { fetcher });
    const result = await transport.send({ messages: MESSAGES });

    // The key authorizes the outbound server request…
    const [, init] = fetcher.mock.calls[0] as [URL | string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${SETTINGS.apiKey}`);
    // …and never reaches anything a client could read (10 §15).
    expect(JSON.stringify(result)).not.toContain(SETTINGS.apiKey);
  });
});

describe("advisor fallback model", () => {
  const ENV = {
    ADVISOR_ENDPOINT: "https://primary.example.test/v1/chat/completions",
    ADVISOR_MODEL: "primary-model",
    ADVISOR_API_KEY: "primary-key",
    ADVISOR_FALLBACK_ENDPOINT: "https://fallback.example.test/v1/chat/completions",
    ADVISOR_FALLBACK_MODEL: "fallback-model",
    ADVISOR_FALLBACK_API_KEY: "fallback-key",
  };
  const completion = (text: string) => jsonResponse({ choices: [{ message: { content: text } }] });

  it("hands a rate-limited request to the fallback model with its own key", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      String(url).startsWith("https://primary") ? jsonResponse({}, 429) : completion(`from ${JSON.parse(String(init?.body)).model}`),
    );
    const transport = advisorTransportFromEnv(ENV, { fetcher: fetcher as typeof fetch });
    const result = await transport?.send({ messages: MESSAGES });
    expect(result).toEqual({ ok: true, text: "from fallback-model" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const headers = (fetcher.mock.calls[1]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer fallback-key");
  });

  it("does not retry the rider's own bad request, or a success", async () => {
    const bad = vi.fn(async () => jsonResponse({}, 400));
    const badResult = await advisorTransportFromEnv(ENV, { fetcher: bad as typeof fetch })?.send({ messages: MESSAGES });
    expect(badResult).toMatchObject({ ok: false, errorClass: "invalid-request" });
    expect(bad).toHaveBeenCalledTimes(1);

    const good = vi.fn(async () => completion("ok"));
    await advisorTransportFromEnv(ENV, { fetcher: good as typeof fetch })?.send({ messages: MESSAGES });
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("has no fallback unless endpoint, model and key are all set", async () => {
    const fetcher = vi.fn(async () => jsonResponse({}, 503));
    const partial = { ...ENV, ADVISOR_FALLBACK_API_KEY: "" };
    await advisorTransportFromEnv(partial, { fetcher: fetcher as typeof fetch })?.send({ messages: MESSAGES });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
