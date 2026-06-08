import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai-provider", () => ({
  resolveLanguageModel: vi.fn(),
  isNoProviderError: vi.fn(),
}));

vi.mock("ai", () => ({
  streamText: vi.fn(),
  convertToModelMessages: vi.fn().mockImplementation((msgs: unknown) => Promise.resolve(msgs)),
}));

const { resolveLanguageModel, isNoProviderError } = await import("@/lib/ai-provider");
const mockedResolve = vi.mocked(resolveLanguageModel);
const mockedIsNoProvider = vi.mocked(isNoProviderError);

const { streamText } = await import("ai");
const mockedStreamText = vi.mocked(streamText);

const { POST } = await import("../route");

/** Helper to build a POST request with a JSON body. */
function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Stubs resolveLanguageModel to return a fake model. */
function stubResolved() {
  mockedResolve.mockReturnValue({ model: { id: "fake-model" } } as unknown as ReturnType<
    typeof resolveLanguageModel
  >);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsNoProvider.mockReturnValue(false);
});

describe("POST /api/chat", () => {
  it("returns 401 when no provider is configured", async () => {
    const err = Object.assign(new Error("no provider"), { code: "NO_PROVIDER" });
    mockedResolve.mockImplementation(() => {
      throw err;
    });
    mockedIsNoProvider.mockReturnValue(true);

    const response = await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        model: "anthropic/claude-sonnet-4",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.code).toBe("NO_PROVIDER");
  });

  it("returns 500 when provider resolution throws (e.g. decryption fails)", async () => {
    mockedResolve.mockImplementation(() => {
      throw new Error("decryption failed");
    });
    mockedIsNoProvider.mockReturnValue(false);

    const response = await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        model: "anthropic/claude-sonnet-4",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.code).toBe("DECRYPT_ERROR");
  });

  it("returns 400 when body is not valid JSON", async () => {
    const request = new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("INVALID_JSON");
  });

  it("returns 400 when messages is missing or empty", async () => {
    const response = await POST(makeRequest({ messages: [], model: "anthropic/claude-sonnet-4" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("INVALID_MESSAGES");
  });

  it("returns 400 when messages is not an array", async () => {
    const response = await POST(
      makeRequest({ messages: "not-array", model: "anthropic/claude-sonnet-4" }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("INVALID_MESSAGES");
  });

  it("returns 400 when model is missing", async () => {
    const response = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("INVALID_MODEL");
  });

  it("returns 400 when model is empty string", async () => {
    const response = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], model: "  " }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("INVALID_MODEL");
  });

  it("resolves the model and streams the response", async () => {
    stubResolved();

    const mockResponse = new Response("streamed data", { status: 200 });
    mockedStreamText.mockReturnValue({
      toUIMessageStreamResponse: () => mockResponse,
    } as unknown as ReturnType<typeof streamText>);

    const messages = [{ role: "user" as const, content: "Create a React component skill" }];
    const response = await POST(makeRequest({ messages, model: "anthropic/claude-sonnet-4" }));

    // The route delegates provider selection to the resolver.
    expect(mockedResolve).toHaveBeenCalledWith("anthropic/claude-sonnet-4");

    expect(mockedStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("JSON code block"),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Create a React component skill" }),
        ]),
      }),
    );

    expect(response).toBe(mockResponse);
  });

  it("returns 502 when streamText throws a generic error", async () => {
    stubResolved();
    mockedStreamText.mockImplementation(() => {
      throw new Error("Connection refused");
    });

    const response = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], model: "test/model" }),
    );
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.code).toBe("UPSTREAM_ERROR");
  });

  it("returns 401 when streamText throws an auth error", async () => {
    stubResolved();
    mockedStreamText.mockImplementation(() => {
      throw new Error("401 Unauthorized");
    });

    const response = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], model: "test/model" }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.code).toBe("INVALID_KEY");
  });

  it("returns 429 when streamText throws a rate limit error", async () => {
    stubResolved();
    mockedStreamText.mockImplementation(() => {
      throw new Error("429 rate limit exceeded");
    });

    const response = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], model: "test/model" }),
    );
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.code).toBe("RATE_LIMITED");
  });
});
