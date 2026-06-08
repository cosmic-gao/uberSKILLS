import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@uberskills/db", () => ({
  isModelCacheEmpty: vi.fn(),
  listModels: vi.fn(),
  getDecryptedApiKey: vi.fn(),
  getCustomProviders: vi.fn(),
}));

vi.mock("@/lib/ai-provider", () => ({
  customModelId: (p: { id: string }, m: { id: string }) => `custom:${p.id}/${m.id}`,
}));

vi.mock("@/lib/sync-models", () => ({
  fetchAndSyncModels: vi.fn(),
  isSyncError: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  routeLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { isModelCacheEmpty, listModels, getDecryptedApiKey, getCustomProviders } = await import(
  "@uberskills/db"
);
const { fetchAndSyncModels, isSyncError } = await import("@/lib/sync-models");
const mockedIsModelCacheEmpty = vi.mocked(isModelCacheEmpty);
const mockedListModels = vi.mocked(listModels);
const mockedGetDecryptedApiKey = vi.mocked(getDecryptedApiKey);
const mockedGetCustomProviders = vi.mocked(getCustomProviders);
const mockedFetchAndSyncModels = vi.mocked(fetchAndSyncModels);
const mockedIsSyncError = vi.mocked(isSyncError);

const { GET } = await import("../route");

/** A cached OpenRouter model row. */
function orModel(id: string, name: string, provider: string) {
  return {
    id,
    slug: `${provider}-slug`,
    name,
    provider,
    contextLength: 8192,
    inputPrice: "0.01",
    outputPrice: "0.02",
    modality: "text->text",
    syncedAt: new Date(),
  };
}

const minimaxProvider = {
  id: "minimax",
  name: "MiniMax",
  baseUrl: "https://api.minimaxi.com/v1",
  apiKey: "mm-key",
  models: [{ id: "MiniMax-Text-01", name: "MiniMax One" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetCustomProviders.mockReturnValue([]);
  mockedGetDecryptedApiKey.mockReturnValue(null);
  mockedIsModelCacheEmpty.mockReturnValue(false);
  mockedListModels.mockReturnValue([]);
});

describe("GET /api/models", () => {
  it("returns custom-only models when no OpenRouter key is configured", async () => {
    mockedGetDecryptedApiKey.mockReturnValue(null);
    mockedIsModelCacheEmpty.mockReturnValue(true);
    mockedGetCustomProviders.mockReturnValue([minimaxProvider]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    // No OpenRouter key → never attempt a sync.
    expect(mockedFetchAndSyncModels).not.toHaveBeenCalled();
    expect(data.models).toHaveLength(1);
    expect(data.models[0]).toMatchObject({
      id: "custom:minimax/MiniMax-Text-01",
      name: "MiniMax One",
      provider: "MiniMax",
    });
  });

  it("returns an empty list when nothing is configured", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.models).toEqual([]);
  });

  it("returns sorted OpenRouter models", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-key");
    mockedListModels.mockReturnValue([
      orModel("openai/gpt-4", "GPT-4", "openai"),
      orModel("anthropic/claude-sonnet-4", "Claude Sonnet 4", "anthropic"),
    ]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.models).toHaveLength(2);
    expect(data.models[0].provider).toBe("anthropic");
    expect(data.models[1].provider).toBe("openai");
  });

  it("auto-syncs on first access when the cache is empty and a key exists", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-key");
    mockedIsModelCacheEmpty.mockReturnValue(true);
    mockedFetchAndSyncModels.mockResolvedValueOnce(1);
    mockedListModels.mockReturnValue([orModel("openai/gpt-4", "GPT-4", "openai")]);

    const response = await GET();
    const data = await response.json();

    expect(mockedFetchAndSyncModels).toHaveBeenCalledOnce();
    expect(data.models).toHaveLength(1);
  });

  it("does not sync when no key is configured even if the cache is empty", async () => {
    mockedGetDecryptedApiKey.mockReturnValue(null);
    mockedIsModelCacheEmpty.mockReturnValue(true);

    await GET();

    expect(mockedFetchAndSyncModels).not.toHaveBeenCalled();
  });

  it("skips sync when the cache is populated", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-key");
    mockedIsModelCacheEmpty.mockReturnValue(false);

    await GET();

    expect(mockedFetchAndSyncModels).not.toHaveBeenCalled();
  });

  it("swallows a sync failure and still returns custom models", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-bad");
    mockedIsModelCacheEmpty.mockReturnValue(true);
    const err = Object.assign(new Error("Invalid API key"), {
      code: "INVALID_KEY",
      httpStatus: 401,
    });
    mockedFetchAndSyncModels.mockRejectedValueOnce(err);
    mockedIsSyncError.mockReturnValue(true);
    mockedGetCustomProviders.mockReturnValue([minimaxProvider]);

    const response = await GET();
    const data = await response.json();

    // Sync error is logged, not propagated — custom models still returned.
    expect(response.status).toBe(200);
    expect(data.models).toHaveLength(1);
    expect(data.models[0].id).toBe("custom:minimax/MiniMax-Text-01");
  });

  it("merges OpenRouter and custom provider models", async () => {
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-key");
    mockedListModels.mockReturnValue([orModel("openai/gpt-4", "GPT-4", "openai")]);
    mockedGetCustomProviders.mockReturnValue([minimaxProvider]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.models).toHaveLength(2);
    const ids = data.models.map((m: { id: string }) => m.id);
    expect(ids).toContain("openai/gpt-4");
    expect(ids).toContain("custom:minimax/MiniMax-Text-01");
  });
});
