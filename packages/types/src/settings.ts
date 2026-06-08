/** UI theme preference. */
export type Theme = "light" | "dark" | "system";

/** A single model offered by a custom OpenAI-compatible provider. */
export interface CustomProviderModel {
  /** The model identifier passed to the provider, e.g. "MiniMax-Text-01". */
  id: string;
  /** Display name shown in the model selector; defaults to `id` when empty. */
  name: string;
}

/**
 * A user-configured, OpenAI-compatible model provider (MiniMax, DeepSeek,
 * Moonshot, a local Ollama, etc.). Stored inside the encrypted `customProviders`
 * settings blob — never persisted in plaintext.
 */
export interface CustomProvider {
  /** Stable kebab-case slug, e.g. "minimax". Used to namespace model ids. */
  id: string;
  /** Display name, e.g. "MiniMax". */
  name: string;
  /** OpenAI-compatible base URL, e.g. "https://api.minimaxi.com/v1". */
  baseUrl: string;
  /** API key (Bearer token). May be empty for keyless providers like Ollama. */
  apiKey: string;
  /** Models this provider exposes. */
  models: CustomProviderModel[];
}

/**
 * Client-safe view of a {@link CustomProvider}: the raw `apiKey` is replaced with
 * a boolean flag so keys never reach the browser.
 */
export interface CustomProviderPublic extends Omit<CustomProvider, "apiKey"> {
  /** Whether a non-empty API key is stored for this provider. */
  apiKeySet: boolean;
}

/** Application-wide settings stored in the database. */
export interface AppSettings {
  /** OpenRouter API key; encrypted at rest, null if not configured. Optional. */
  openrouterApiKey: string | null;
  /**
   * Base URL for the built-in OpenRouter provider. Defaults to OpenRouter's
   * public endpoint; override to point at an OpenRouter-compatible gateway that
   * extends the available models.
   */
  openrouterBaseUrl: string;
  /** Custom OpenAI-compatible providers; API keys masked as `apiKeySet`. */
  customProviders: CustomProviderPublic[];
  /** Default model identifier for testing, e.g. "anthropic/claude-sonnet-4". */
  defaultModel: string;
  theme: Theme;
}

/** A validation issue found during skill parsing or form validation. */
export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}
