import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@uberskills/db", () => ({
  getCustomProviders: vi.fn(),
  getDecryptedApiKey: vi.fn(),
  getOpenrouterBaseUrl: vi.fn(),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(),
}));

vi.mock("ai", () => ({
  createProviderRegistry: vi.fn(),
}));

const { getCustomProviders, getDecryptedApiKey, getOpenrouterBaseUrl } = await import(
  "@uberskills/db"
);
const mockedGetCustomProviders = vi.mocked(getCustomProviders);
const mockedGetDecryptedApiKey = vi.mocked(getDecryptedApiKey);
const mockedGetOpenrouterBaseUrl = vi.mocked(getOpenrouterBaseUrl);

const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
const mockedCreateOpenAICompatible = vi.mocked(createOpenAICompatible);

const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
const mockedCreateOpenRouter = vi.mocked(createOpenRouter);

const { createProviderRegistry } = await import("ai");
const mockedCreateProviderRegistry = vi.mocked(createProviderRegistry);

const { resolveLanguageModel, isNoProviderError, customModelId, NoProviderError } = await import(
  "../ai-provider"
);

const HEADERS = { "HTTP-Referer": "https://uberskills.dev", "X-Title": "uberSKILLS" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetCustomProviders.mockReturnValue([]);
  mockedGetOpenrouterBaseUrl.mockReturnValue("https://openrouter.ai/api/v1");
});

describe("customModelId", () => {
  it("builds a namespaced, collision-proof id", () => {
    expect(customModelId({ id: "minimax" }, { id: "MiniMax-Text-01" })).toBe(
      "custom:minimax/MiniMax-Text-01",
    );
  });
});

describe("resolveLanguageModel — OpenRouter fallback", () => {
  it("resolves a plain model id via OpenRouter using the configured base URL", () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-key");
    mockedGetOpenrouterBaseUrl.mockReturnValue("https://gateway.example.com/v1");
    const modelFn = vi.fn().mockReturnValue({ id: "claude" });
    mockedCreateOpenRouter.mockReturnValue(
      modelFn as unknown as ReturnType<typeof createOpenRouter>,
    );

    const { model } = resolveLanguageModel("anthropic/claude-sonnet-4");

    expect(mockedCreateOpenRouter).toHaveBeenCalledWith({
      apiKey: "sk-or-v1-key",
      baseURL: "https://gateway.example.com/v1",
      headers: HEADERS,
    });
    expect(modelFn).toHaveBeenCalledWith("anthropic/claude-sonnet-4", undefined);
    expect(model).toEqual({ id: "claude" });
    // The custom registry must not be touched for OpenRouter ids.
    expect(mockedCreateProviderRegistry).not.toHaveBeenCalled();
  });

  it("passes web_search_options when enableWebSearch is set", () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-key");
    const modelFn = vi.fn().mockReturnValue({ id: "m" });
    mockedCreateOpenRouter.mockReturnValue(
      modelFn as unknown as ReturnType<typeof createOpenRouter>,
    );

    resolveLanguageModel("anthropic/claude-sonnet-4", { enableWebSearch: true });

    expect(modelFn).toHaveBeenCalledWith("anthropic/claude-sonnet-4", {
      web_search_options: { max_results: 5 },
    });
  });

  it("throws NoProviderError when no OpenRouter key is configured", () => {
    mockedGetDecryptedApiKey.mockReturnValue(null);

    expect(() => resolveLanguageModel("anthropic/claude-sonnet-4")).toThrow(NoProviderError);
    try {
      resolveLanguageModel("anthropic/claude-sonnet-4");
    } catch (err) {
      expect(isNoProviderError(err)).toBe(true);
    }
  });
});

describe("resolveLanguageModel — custom providers", () => {
  const provider = {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: "mm-key",
    models: [{ id: "MiniMax-Text-01", name: "MiniMax Text" }],
  };

  /** Stubs the OpenAI-compatible client + registry; returns the registry's languageModel spy. */
  function stubRegistry(model: unknown = { id: "mm" }) {
    const languageModel = vi.fn().mockReturnValue(model);
    mockedCreateProviderRegistry.mockReturnValue({
      languageModel,
    } as unknown as ReturnType<typeof createProviderRegistry>);
    mockedCreateOpenAICompatible.mockReturnValue({
      name: "minimax",
    } as unknown as ReturnType<typeof createOpenAICompatible>);
    return languageModel;
  }

  it("wires an OpenAI-compatible provider and resolves via the registry", () => {
    mockedGetCustomProviders.mockReturnValue([provider]);
    const languageModel = stubRegistry({ id: "mm" });

    const { model } = resolveLanguageModel("custom:minimax/MiniMax-Text-01");

    expect(mockedCreateOpenAICompatible).toHaveBeenCalledWith({
      name: "minimax",
      baseURL: "https://api.minimaxi.com/v1",
      apiKey: "mm-key",
      headers: HEADERS,
    });
    expect(mockedCreateProviderRegistry).toHaveBeenCalledWith(
      expect.objectContaining({ minimax: expect.anything() }),
      { separator: "/" },
    );
    expect(languageModel).toHaveBeenCalledWith("minimax/MiniMax-Text-01");
    expect(model).toEqual({ id: "mm" });
    // Custom models must not consult the OpenRouter key.
    expect(mockedGetDecryptedApiKey).not.toHaveBeenCalled();
  });

  it("passes undefined apiKey for keyless providers", () => {
    mockedGetCustomProviders.mockReturnValue([{ ...provider, apiKey: "" }]);
    stubRegistry();

    resolveLanguageModel("custom:minimax/MiniMax-Text-01");

    expect(mockedCreateOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined }),
    );
  });

  it("throws NoProviderError for a model not in the configured list", () => {
    mockedGetCustomProviders.mockReturnValue([provider]);

    expect(() => resolveLanguageModel("custom:minimax/does-not-exist")).toThrow(NoProviderError);
    // Whitelist check fails before any provider/registry is built.
    expect(mockedCreateProviderRegistry).not.toHaveBeenCalled();
  });

  it("throws NoProviderError for an unknown provider id", () => {
    mockedGetCustomProviders.mockReturnValue([provider]);

    expect(() => resolveLanguageModel("custom:ghost/whatever")).toThrow(NoProviderError);
  });
});
