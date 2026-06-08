import {
  getCustomProviders,
  getDecryptedApiKey,
  isModelCacheEmpty,
  listModels,
} from "@uberskills/db";
import { NextResponse } from "next/server";

import { customModelId } from "@/lib/ai-provider";
import { routeLogger } from "@/lib/logger";
import { fetchAndSyncModels, isSyncError } from "@/lib/sync-models";

const log = routeLogger("GET", "/api/models");

/** Shape of a model entry returned to the client. */
interface ModelResponse {
  id: string;
  slug: string | null;
  name: string;
  provider: string;
  contextLength: number | null;
  inputPrice: string | null;
  outputPrice: string | null;
  modality: string | null;
}

/** Returns true if an OpenRouter API key is configured (decryption-safe). */
function hasOpenRouterKey(): boolean {
  try {
    return getDecryptedApiKey() !== null;
  } catch {
    return false;
  }
}

/**
 * GET /api/models -- Returns the combined model catalog from every configured
 * provider: OpenRouter (cached, auto-synced on first access) plus any custom
 * OpenAI-compatible providers. OpenRouter is optional — if no key is set, only
 * custom models are returned.
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Auto-populate the OpenRouter cache on first access, but only when a key
    // exists. A sync failure must not blank out custom providers, so it is
    // logged and swallowed rather than propagated.
    if (hasOpenRouterKey() && isModelCacheEmpty()) {
      try {
        await fetchAndSyncModels();
      } catch (err) {
        if (isSyncError(err)) {
          log.warn({ code: err.code }, `OpenRouter model sync skipped: ${err.message}`);
        } else {
          log.warn({ err }, "OpenRouter model sync failed");
        }
      }
    }

    const openRouterModels: ModelResponse[] = listModels().map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      provider: r.provider,
      contextLength: r.contextLength,
      inputPrice: r.inputPrice,
      outputPrice: r.outputPrice,
      modality: r.modality,
    }));

    // Surface custom-provider models with namespaced ids, grouped under the
    // provider's display name so the existing ModelSelector groups them.
    const customModels: ModelResponse[] = getCustomProviders().flatMap((p) =>
      p.models.map((m) => ({
        id: customModelId(p, m),
        slug: null,
        name: m.name || m.id,
        provider: p.name,
        contextLength: null,
        inputPrice: null,
        outputPrice: null,
        modality: null,
      })),
    );

    const models = [...openRouterModels, ...customModels].sort(
      (a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
    );

    log.info({ count: models.length, custom: customModels.length }, "models loaded");
    return NextResponse.json({ models });
  } catch (err) {
    log.error({ err }, "failed to load models");
    return NextResponse.json(
      { error: "Failed to load models", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
