import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getCustomProviders, getDecryptedApiKey, getOpenrouterBaseUrl } from "@uberskills/db";
import type { CustomProvider, CustomProviderModel } from "@uberskills/types";
import { createProviderRegistry, type LanguageModel } from "ai";

/**
 * Central AI provider resolution.
 *
 * A model id either targets a user-configured custom provider (namespaced with
 * the `custom:` prefix — MiniMax, DeepSeek, a local Ollama, ...) or falls back
 * to the built-in OpenRouter provider. This module is the single place that
 * maps a model id to an AI SDK language model, so the streaming routes never
 * wire providers directly.
 *
 * Custom providers are managed through the AI SDK's `createProviderRegistry`,
 * each wired as a first-class `@ai-sdk/openai-compatible` provider — the
 * standard way to talk to arbitrary OpenAI-compatible endpoints. OpenRouter is
 * an aggregator with its own id scheme (`vendor/model:variant`), so it stays a
 * dedicated `createOpenRouter` client rather than being squeezed into the
 * registry's `providerId<sep>modelId` convention.
 */

/** Prefix marking a model id as belonging to a custom provider. */
export const CUSTOM_PREFIX = "custom:";

/** Separator between provider id and model id within a custom model id. */
const CUSTOM_SEPARATOR = "/";

/** Headers attached to every provider request (OpenRouter attribution). */
const PROVIDER_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://uberskills.dev",
  "X-Title": "uberSKILLS",
};

/**
 * Builds the namespaced, collision-proof model id for a custom provider model,
 * e.g. `custom:minimax/MiniMax-Text-01`. OpenRouter ids are `vendor/model`
 * (and may contain `:variant`), so the `custom:` prefix guarantees no overlap.
 */
export function customModelId(
  provider: Pick<CustomProvider, "id">,
  model: Pick<CustomProviderModel, "id">,
): string {
  return `${CUSTOM_PREFIX}${provider.id}${CUSTOM_SEPARATOR}${model.id}`;
}

/**
 * Thrown when a model id resolves to no configured provider — either an unknown
 * custom model, or an OpenRouter model requested without an OpenRouter API key.
 * Routes map this to HTTP 401.
 */
export class NoProviderError extends Error {
  readonly code = "NO_PROVIDER";

  constructor(message: string) {
    super(message);
    this.name = "NoProviderError";
  }
}

/** Type guard that survives module boundaries (mirrors `isSyncError`). */
export function isNoProviderError(err: unknown): err is NoProviderError {
  return err instanceof Error && (err as { code?: unknown }).code === "NO_PROVIDER";
}

export interface ResolveModelOptions {
  /** OpenRouter-only: enable web search for this call. Ignored for custom providers. */
  enableWebSearch?: boolean;
}

export interface ResolvedModel {
  model: LanguageModel;
}

/**
 * Builds an AI SDK provider registry over the configured custom providers, each
 * wired as an OpenAI-compatible client keyed by its provider id.
 */
function buildCustomRegistry(providers: CustomProvider[]) {
  const entries = Object.fromEntries(
    providers.map((p) => [
      p.id,
      createOpenAICompatible({
        name: p.id,
        baseURL: p.baseUrl,
        // Empty key => keyless endpoint (e.g. local Ollama): pass undefined so
        // no Authorization header is sent (and no env fallback is attempted).
        apiKey: p.apiKey || undefined,
        headers: PROVIDER_HEADERS,
      }),
    ]),
  );
  return createProviderRegistry(entries, { separator: CUSTOM_SEPARATOR });
}

/** Splits a prefix-stripped custom id into provider id + model id on the first separator. */
function splitCustomId(id: string): { providerId: string; modelId: string } {
  const i = id.indexOf(CUSTOM_SEPARATOR);
  if (i < 0) return { providerId: id, modelId: "" };
  return { providerId: id.slice(0, i), modelId: id.slice(i + 1) };
}

/**
 * Resolves a model id to a configured AI SDK language model.
 *
 * @throws {NoProviderError} when no matching provider is configured, or when an
 *   OpenRouter model is requested without an OpenRouter API key.
 * @throws {Error} when API-key decryption fails (callers map this to HTTP 500).
 */
export function resolveLanguageModel(
  modelId: string,
  opts: ResolveModelOptions = {},
): ResolvedModel {
  if (modelId.startsWith(CUSTOM_PREFIX)) {
    return resolveCustomModel(modelId);
  }

  // Fall back to the built-in OpenRouter provider for non-namespaced ids
  // (e.g. "anthropic/claude-sonnet-4"), honoring a custom base URL if set.
  const apiKey = getDecryptedApiKey();
  if (!apiKey) {
    throw new NoProviderError(
      "No provider configured for this model. Add an OpenRouter API key or a custom provider in Settings.",
    );
  }

  const openrouter = createOpenRouter({
    apiKey,
    baseURL: getOpenrouterBaseUrl(),
    headers: PROVIDER_HEADERS,
  });
  return {
    model: openrouter(
      modelId,
      opts.enableWebSearch ? { web_search_options: { max_results: 5 } } : undefined,
    ),
  };
}

/** Resolves a `custom:`-prefixed model id via the custom-provider registry. */
function resolveCustomModel(modelId: string): ResolvedModel {
  const providers = getCustomProviders();
  const registryId = modelId.slice(CUSTOM_PREFIX.length);
  const { providerId, modelId: modelName } = splitCustomId(registryId);

  // Whitelist: only models the user explicitly configured may be resolved.
  const provider = providers.find((p) => p.id === providerId);
  if (!provider || !provider.models.some((m) => m.id === modelName)) {
    throw new NoProviderError(
      `Custom model "${modelId}" is not configured. Check your providers in Settings.`,
    );
  }

  const registry = buildCustomRegistry(providers);
  // Rebuild the id as a template literal so its type carries the separator,
  // satisfying the registry's `${provider}${sep}${model}` parameter type.
  return { model: registry.languageModel(`${providerId}${CUSTOM_SEPARATOR}${modelName}`) };
}
