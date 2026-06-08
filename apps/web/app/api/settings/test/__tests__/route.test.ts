import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@uberskills/db", () => ({
  getDecryptedApiKey: vi.fn(),
  getCustomProviders: vi.fn(),
  getOpenrouterBaseUrl: vi.fn(),
}));

const { getDecryptedApiKey, getCustomProviders, getOpenrouterBaseUrl } = await import(
  "@uberskills/db"
);
const mockedGetDecryptedApiKey = vi.mocked(getDecryptedApiKey);
const mockedGetCustomProviders = vi.mocked(getCustomProviders);
const mockedGetOpenrouterBaseUrl = vi.mocked(getOpenrouterBaseUrl);

const { GET } = await import("../route");

/** Builds a request for the test route, with optional query string. */
function makeReq(query = ""): Request {
  return new Request(`http://localhost:3000/api/settings/test${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockedGetCustomProviders.mockReturnValue([]);
  mockedGetOpenrouterBaseUrl.mockReturnValue("https://openrouter.ai/api/v1");
});

describe("GET /api/settings/test", () => {
  it("returns 401 when no API key is configured", async () => {
    mockedGetDecryptedApiKey.mockReturnValue(null);

    const response = await GET(makeReq());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.code).toBe("NO_API_KEY");
  });

  it("returns connected status on successful OpenRouter call", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-valid-key");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    const response = await GET(makeReq());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("connected");
  });

  it("sends correct authorization headers to OpenRouter", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-test");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await GET(makeReq());

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-or-v1-test",
          "HTTP-Referer": "https://uberskills.dev",
          "X-Title": "uberSKILLS",
        }),
      }),
    );
  });

  it("returns 401 when OpenRouter returns 401", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-bad");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const response = await GET(makeReq());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.code).toBe("INVALID_KEY");
  });

  it("returns 401 when OpenRouter returns 403", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-bad");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const response = await GET(makeReq());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.code).toBe("INVALID_KEY");
  });

  it("returns 429 when rate limited", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-key");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Too Many Requests", { status: 429 }),
    );

    const response = await GET(makeReq());
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.code).toBe("RATE_LIMITED");
  });

  it("returns 502 for other OpenRouter errors", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-key");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500 }),
    );

    const response = await GET(makeReq());
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.code).toBe("UPSTREAM_ERROR");
  });

  it("returns 502 on network error", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-key");

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network failure"));

    const response = await GET(makeReq());
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.code).toBe("NETWORK_ERROR");
  });
});

describe("GET /api/settings/test?provider=", () => {
  const provider = {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: "mm-key",
    models: [{ id: "MiniMax-Text-01", name: "MiniMax One" }],
  };

  it("returns 404 when the provider is not found", async () => {
    mockedGetCustomProviders.mockReturnValue([]);

    const response = await GET(makeReq("?provider=ghost"));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.code).toBe("NOT_FOUND");
  });

  it("returns connected when the provider's /models endpoint is reachable", async () => {
    mockedGetCustomProviders.mockReturnValue([provider]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    const response = await GET(makeReq("?provider=minimax"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("connected");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.minimaxi.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer mm-key" }),
      }),
    );
  });

  it("returns 401 when the provider rejects the key", async () => {
    mockedGetCustomProviders.mockReturnValue([provider]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("nope", { status: 401 }));

    const response = await GET(makeReq("?provider=minimax"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.code).toBe("INVALID_KEY");
  });

  it("returns 502 for other provider errors", async () => {
    mockedGetCustomProviders.mockReturnValue([provider]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("boom", { status: 500 }));

    const response = await GET(makeReq("?provider=minimax"));
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.code).toBe("UPSTREAM_ERROR");
  });

  it("returns 502 on network error reaching the provider", async () => {
    mockedGetCustomProviders.mockReturnValue([provider]);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const response = await GET(makeReq("?provider=minimax"));
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.code).toBe("NETWORK_ERROR");
  });
});
