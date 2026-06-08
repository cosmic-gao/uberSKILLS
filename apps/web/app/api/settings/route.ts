import {
  getAllSettings,
  getCustomProviders,
  getDecryptedApiKey,
  getOpenrouterBaseUrl,
  setCustomProviders,
  setSetting,
} from "@uberskills/db";
import type {
  AppSettings,
  CustomProvider,
  CustomProviderModel,
  CustomProviderPublic,
  Theme,
} from "@uberskills/types";
import { type NextRequest, NextResponse } from "next/server";

import { routeLogger } from "@/lib/logger";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";
const DEFAULT_THEME: Theme = "system";
const VALID_THEMES: Theme[] = ["light", "dark", "system"];

/** Strips the raw API key from a provider for safe transport to the client. */
function toPublicProvider(p: CustomProvider): CustomProviderPublic {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    models: p.models,
    apiKeySet: p.apiKey.length > 0,
  };
}

/** Returns true if the value parses as an absolute URL. */
function isValidUrl(value: string): boolean {
  try {
    return new URL(value).protocol !== "";
  } catch {
    return false;
  }
}

/** Derives a stable kebab-case slug from a provider name. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type ProviderValidation = { ok: true; providers: CustomProvider[] } | { ok: false; error: string };

/**
 * Validates and normalizes an incoming `customProviders` payload.
 *
 * Empty/omitted API keys are backfilled from the stored provider with the same
 * id, so editing a provider in the UI (where keys are masked) never wipes the
 * existing key. A truly empty key is allowed for keyless providers (e.g. Ollama).
 */
function validateProviders(input: unknown, existing: CustomProvider[]): ProviderValidation {
  if (!Array.isArray(input)) {
    return { ok: false, error: "customProviders must be an array" };
  }

  const existingById = new Map(existing.map((p) => [p.id, p]));
  const out: CustomProvider[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "each custom provider must be an object" };
    }
    const p = raw as Record<string, unknown>;

    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!name) return { ok: false, error: "each custom provider needs a name" };

    const baseUrl = typeof p.baseUrl === "string" ? p.baseUrl.trim() : "";
    if (!baseUrl) return { ok: false, error: "each custom provider needs a baseUrl" };

    const id = (typeof p.id === "string" && p.id.trim()) || slugify(name);
    if (!id) return { ok: false, error: "could not derive a provider id from the name" };

    if (p.apiKey !== undefined && typeof p.apiKey !== "string") {
      return { ok: false, error: "provider apiKey must be a string" };
    }
    const providedKey = typeof p.apiKey === "string" ? p.apiKey : "";
    const apiKey = providedKey !== "" ? providedKey : (existingById.get(id)?.apiKey ?? "");

    if (!Array.isArray(p.models)) {
      return { ok: false, error: "provider models must be an array" };
    }
    const models: CustomProviderModel[] = [];
    for (const rawModel of p.models) {
      if (!rawModel || typeof rawModel !== "object" || Array.isArray(rawModel)) {
        return { ok: false, error: "each model must be an object" };
      }
      const m = rawModel as Record<string, unknown>;
      const modelId = typeof m.id === "string" ? m.id.trim() : "";
      if (!modelId) return { ok: false, error: "each model needs an id" };
      const modelName = typeof m.name === "string" && m.name.trim() ? m.name.trim() : modelId;
      models.push({ id: modelId, name: modelName });
    }

    out.push({ id, name, baseUrl, apiKey, models });
  }

  return { ok: true, providers: out };
}

/**
 * Masks an API key for safe display: shows only the last 4 characters.
 * Returns null if the key is null or too short to partially reveal.
 */
function maskApiKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 4) return "....";
  return ".".repeat(key.length - 4) + key.slice(-4);
}

/**
 * Builds an AppSettings object from the raw settings rows.
 * Falls back to defaults for missing keys.
 */
function buildAppSettings(
  rows: ReturnType<typeof getAllSettings>,
  decryptedApiKey: string | null,
  customProviders: CustomProvider[],
  openrouterBaseUrl: string,
): AppSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));

  return {
    openrouterApiKey: maskApiKey(decryptedApiKey),
    openrouterBaseUrl,
    customProviders: customProviders.map(toPublicProvider),
    defaultModel: map.get("defaultModel") ?? DEFAULT_MODEL,
    theme: (map.get("theme") as Theme) ?? DEFAULT_THEME,
  };
}

/** Reads the current settings and returns them as an AppSettings response. */
function respondWithCurrentSettings(): NextResponse<AppSettings> {
  const rows = getAllSettings();
  const decryptedApiKey = getDecryptedApiKey();
  const customProviders = getCustomProviders();
  const openrouterBaseUrl = getOpenrouterBaseUrl();
  return NextResponse.json(
    buildAppSettings(rows, decryptedApiKey, customProviders, openrouterBaseUrl),
  );
}

const getLog = routeLogger("GET", "/api/settings");
const putLog = routeLogger("PUT", "/api/settings");

// GET /api/settings -- returns current application settings with masked API key
export async function GET(): Promise<NextResponse> {
  try {
    getLog.info("settings retrieved");
    return respondWithCurrentSettings();
  } catch (err) {
    getLog.error({ err }, "failed to retrieve settings");
    return NextResponse.json(
      { error: "Failed to retrieve settings", code: "SETTINGS_READ_ERROR" },
      { status: 500 },
    );
  }
}

// PUT /api/settings -- updates one or more settings fields
export async function PUT(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const { openrouterApiKey, openrouterBaseUrl, defaultModel, theme, customProviders } = body;

  // Validate individual fields when present
  if (openrouterApiKey !== undefined && typeof openrouterApiKey !== "string") {
    return NextResponse.json(
      { error: "openrouterApiKey must be a string", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  if (openrouterBaseUrl !== undefined) {
    if (typeof openrouterBaseUrl !== "string") {
      return NextResponse.json(
        { error: "openrouterBaseUrl must be a string", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    // A non-empty value must be a valid URL; empty resets to the default.
    if (openrouterBaseUrl.trim() !== "" && !isValidUrl(openrouterBaseUrl.trim())) {
      return NextResponse.json(
        { error: "openrouterBaseUrl must be a valid URL", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
  }

  if (defaultModel !== undefined && typeof defaultModel !== "string") {
    return NextResponse.json(
      { error: "defaultModel must be a string", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  if (theme !== undefined) {
    if (typeof theme !== "string" || !VALID_THEMES.includes(theme as Theme)) {
      return NextResponse.json(
        {
          error: `theme must be one of: ${VALID_THEMES.join(", ")}`,
          code: "VALIDATION_ERROR",
        },
        { status: 400 },
      );
    }
  }

  // Validate + normalize custom providers up front (keys are backfilled from
  // the stored providers when omitted).
  let normalizedProviders: CustomProvider[] | undefined;
  if (customProviders !== undefined) {
    const result = validateProviders(customProviders, getCustomProviders());
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: "VALIDATION_ERROR" }, { status: 400 });
    }
    normalizedProviders = result.providers;
  }

  try {
    if (openrouterApiKey !== undefined) {
      setSetting("openrouterApiKey", openrouterApiKey as string, true);
    }
    if (openrouterBaseUrl !== undefined) {
      setSetting("openrouterBaseUrl", (openrouterBaseUrl as string).trim());
    }
    if (defaultModel !== undefined) {
      setSetting("defaultModel", defaultModel as string);
    }
    if (theme !== undefined) {
      setSetting("theme", theme as string);
    }
    if (normalizedProviders !== undefined) {
      setCustomProviders(normalizedProviders);
    }

    const updatedKeys = [
      openrouterApiKey !== undefined && "openrouterApiKey",
      openrouterBaseUrl !== undefined && "openrouterBaseUrl",
      defaultModel !== undefined && "defaultModel",
      theme !== undefined && "theme",
      customProviders !== undefined && "customProviders",
    ].filter(Boolean);
    putLog.info({ updatedKeys }, "settings updated");
    return respondWithCurrentSettings();
  } catch (err) {
    putLog.error({ err }, "failed to update settings");
    return NextResponse.json(
      { error: "Failed to update settings", code: "SETTINGS_WRITE_ERROR" },
      { status: 500 },
    );
  }
}
