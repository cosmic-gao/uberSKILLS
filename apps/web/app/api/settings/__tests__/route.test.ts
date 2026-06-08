import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@uberskills/db", () => ({
  getAllSettings: vi.fn(),
  getDecryptedApiKey: vi.fn(),
  setSetting: vi.fn(),
  getCustomProviders: vi.fn(),
  setCustomProviders: vi.fn(),
  getOpenrouterBaseUrl: vi.fn(),
}));

const {
  getAllSettings,
  getDecryptedApiKey,
  setSetting,
  getCustomProviders,
  setCustomProviders,
  getOpenrouterBaseUrl,
} = await import("@uberskills/db");
const mockedGetAllSettings = vi.mocked(getAllSettings);
const mockedGetDecryptedApiKey = vi.mocked(getDecryptedApiKey);
const mockedSetSetting = vi.mocked(setSetting);
const mockedGetCustomProviders = vi.mocked(getCustomProviders);
const mockedSetCustomProviders = vi.mocked(setCustomProviders);
const mockedGetOpenrouterBaseUrl = vi.mocked(getOpenrouterBaseUrl);

const { GET, PUT } = await import("../route");

const MOCK_DATE = new Date("2026-01-01T00:00:00Z");
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/** Creates a setting row with a default updatedAt timestamp. */
function makeSettingRow(key: string, value: string, encrypted = false) {
  return { key, value, encrypted, updatedAt: MOCK_DATE };
}

/** Creates a PUT request with a JSON body. */
function makePutRequest(body: unknown): NextRequest {
  return new Request("http://localhost:3000/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetCustomProviders.mockReturnValue([]);
  mockedGetOpenrouterBaseUrl.mockReturnValue(DEFAULT_BASE_URL);
});

describe("GET /api/settings", () => {
  it("returns default settings when no settings exist", async () => {
    mockedGetAllSettings.mockReturnValue([]);
    mockedGetDecryptedApiKey.mockReturnValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      openrouterApiKey: null,
      openrouterBaseUrl: DEFAULT_BASE_URL,
      customProviders: [],
      defaultModel: "anthropic/claude-sonnet-4",
      theme: "system",
    });
  });

  it("returns custom providers with API keys masked", async () => {
    mockedGetAllSettings.mockReturnValue([]);
    mockedGetDecryptedApiKey.mockReturnValue(null);
    mockedGetCustomProviders.mockReturnValue([
      {
        id: "minimax",
        name: "MiniMax",
        baseUrl: "https://api.minimaxi.com/v1",
        apiKey: "mm-secret",
        models: [{ id: "MiniMax-Text-01", name: "MiniMax One" }],
      },
    ]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.customProviders).toHaveLength(1);
    expect(data.customProviders[0]).toEqual({
      id: "minimax",
      name: "MiniMax",
      baseUrl: "https://api.minimaxi.com/v1",
      apiKeySet: true,
      models: [{ id: "MiniMax-Text-01", name: "MiniMax One" }],
    });
    // The raw key must never be exposed.
    expect(JSON.stringify(data)).not.toContain("mm-secret");
  });

  it("reflects a configured OpenRouter base URL", async () => {
    mockedGetAllSettings.mockReturnValue([]);
    mockedGetDecryptedApiKey.mockReturnValue(null);
    mockedGetOpenrouterBaseUrl.mockReturnValue("https://gateway.example.com/v1");

    const response = await GET();
    const data = await response.json();

    expect(data.openrouterBaseUrl).toBe("https://gateway.example.com/v1");
  });

  it("returns stored settings with masked API key", async () => {
    mockedGetAllSettings.mockReturnValue([
      makeSettingRow("defaultModel", "anthropic/claude-haiku-3.5"),
      makeSettingRow("theme", "dark"),
      makeSettingRow("openrouterApiKey", "encrypted-blob", true),
    ]);
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-abcdef1234567890");

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.defaultModel).toBe("anthropic/claude-haiku-3.5");
    expect(data.theme).toBe("dark");
    expect(data.openrouterApiKey).toMatch(/^\.+7890$/);
    expect(data.openrouterApiKey).not.toContain("sk-or-v1");
  });

  it("masks short API keys with dots", async () => {
    mockedGetAllSettings.mockReturnValue([]);
    mockedGetDecryptedApiKey.mockReturnValue("abcd");

    const response = await GET();
    const data = await response.json();

    expect(data.openrouterApiKey).toBe("....");
  });

  it("returns 500 on database error", async () => {
    mockedGetAllSettings.mockImplementation(() => {
      throw new Error("DB failure");
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: "Failed to retrieve settings",
      code: "SETTINGS_READ_ERROR",
    });
  });
});

describe("PUT /api/settings", () => {
  it("updates a single setting and returns updated state", async () => {
    mockedGetAllSettings.mockReturnValue([makeSettingRow("theme", "dark")]);
    mockedGetDecryptedApiKey.mockReturnValue(null);

    const response = await PUT(makePutRequest({ theme: "dark" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockedSetSetting).toHaveBeenCalledWith("theme", "dark");
    expect(data.theme).toBe("dark");
  });

  it("encrypts the API key when updating", async () => {
    mockedGetAllSettings.mockReturnValue([makeSettingRow("openrouterApiKey", "encrypted", true)]);
    mockedGetDecryptedApiKey.mockReturnValue("sk-or-v1-new-key");

    const response = await PUT(makePutRequest({ openrouterApiKey: "sk-or-v1-new-key" }));

    expect(response.status).toBe(200);
    expect(mockedSetSetting).toHaveBeenCalledWith("openrouterApiKey", "sk-or-v1-new-key", true);
  });

  it("updates multiple settings at once", async () => {
    mockedGetAllSettings.mockReturnValue([
      makeSettingRow("defaultModel", "google/gemini-pro"),
      makeSettingRow("theme", "light"),
    ]);
    mockedGetDecryptedApiKey.mockReturnValue(null);

    const response = await PUT(
      makePutRequest({ defaultModel: "google/gemini-pro", theme: "light" }),
    );

    expect(response.status).toBe(200);
    expect(mockedSetSetting).toHaveBeenCalledWith("defaultModel", "google/gemini-pro");
    expect(mockedSetSetting).toHaveBeenCalledWith("theme", "light");
  });

  it("rejects invalid JSON body", async () => {
    const request = new Request("http://localhost:3000/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    const response = await PUT(request as unknown as NextRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("INVALID_JSON");
  });

  it("rejects invalid theme value", async () => {
    const response = await PUT(makePutRequest({ theme: "midnight" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(data.error).toContain("theme must be one of");
  });

  it("rejects non-string openrouterApiKey", async () => {
    const response = await PUT(makePutRequest({ openrouterApiKey: 12345 }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(data.error).toContain("openrouterApiKey must be a string");
  });

  it("rejects non-string defaultModel", async () => {
    const response = await PUT(makePutRequest({ defaultModel: true }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("saves valid custom providers", async () => {
    mockedGetAllSettings.mockReturnValue([]);
    mockedGetDecryptedApiKey.mockReturnValue(null);

    const response = await PUT(
      makePutRequest({
        customProviders: [
          {
            id: "minimax",
            name: "MiniMax",
            baseUrl: "https://api.minimaxi.com/v1",
            apiKey: "mm-key",
            models: [{ id: "MiniMax-Text-01", name: "MiniMax One" }],
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedSetCustomProviders).toHaveBeenCalledWith([
      {
        id: "minimax",
        name: "MiniMax",
        baseUrl: "https://api.minimaxi.com/v1",
        apiKey: "mm-key",
        models: [{ id: "MiniMax-Text-01", name: "MiniMax One" }],
      },
    ]);
  });

  it("preserves an existing key when an empty apiKey is submitted", async () => {
    mockedGetAllSettings.mockReturnValue([]);
    mockedGetDecryptedApiKey.mockReturnValue(null);
    // Existing stored provider with a key (used to backfill).
    mockedGetCustomProviders.mockReturnValue([
      {
        id: "minimax",
        name: "MiniMax",
        baseUrl: "https://api.minimaxi.com/v1",
        apiKey: "stored-key",
        models: [{ id: "MiniMax-Text-01", name: "MiniMax One" }],
      },
    ]);

    const response = await PUT(
      makePutRequest({
        customProviders: [
          {
            id: "minimax",
            name: "MiniMax",
            baseUrl: "https://api.minimaxi.com/v1",
            apiKey: "",
            models: [{ id: "MiniMax-Text-01", name: "MiniMax One" }],
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedSetCustomProviders).toHaveBeenCalledWith([
      expect.objectContaining({ id: "minimax", apiKey: "stored-key" }),
    ]);
  });

  it("rejects custom providers missing a name", async () => {
    const response = await PUT(
      makePutRequest({
        customProviders: [{ baseUrl: "https://x/v1", models: [{ id: "m" }] }],
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(mockedSetCustomProviders).not.toHaveBeenCalled();
  });

  it("saves a valid OpenRouter base URL", async () => {
    mockedGetAllSettings.mockReturnValue([]);
    mockedGetDecryptedApiKey.mockReturnValue(null);

    const response = await PUT(
      makePutRequest({ openrouterBaseUrl: "https://gateway.example.com/v1" }),
    );

    expect(response.status).toBe(200);
    expect(mockedSetSetting).toHaveBeenCalledWith(
      "openrouterBaseUrl",
      "https://gateway.example.com/v1",
    );
  });

  it("rejects an invalid OpenRouter base URL", async () => {
    const response = await PUT(makePutRequest({ openrouterBaseUrl: "not a url" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 on database write error", async () => {
    mockedSetSetting.mockImplementation(() => {
      throw new Error("Write failure");
    });

    const response = await PUT(makePutRequest({ theme: "dark" }));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.code).toBe("SETTINGS_WRITE_ERROR");
  });
});
