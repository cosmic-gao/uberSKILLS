import type { CustomProvider } from "@uberskills/types";
import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { decrypt, encrypt } from "../crypto";
import { settings } from "../schema";

/** Settings key under which the encrypted custom-provider blob is stored. */
const CUSTOM_PROVIDERS_KEY = "customProviders";

/** Settings key for the built-in OpenRouter provider's base URL. */
const OPENROUTER_BASE_URL_KEY = "openrouterBaseUrl";

/** OpenRouter's public API base URL, used when no override is configured. */
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// ---------------------------------------------------------------------------
// CRUD functions
// ---------------------------------------------------------------------------

/**
 * Returns a single setting value by key, or `null` if the key does not exist.
 * Encrypted values are returned as-is (still encrypted).
 */
export function getSetting(key: string): typeof settings.$inferSelect | null {
  const db = getDb();
  return db.select().from(settings).where(eq(settings.key, key)).get() ?? null;
}

/**
 * Sets a setting value by key. Creates the row if it doesn't exist, updates it otherwise.
 *
 * When `encrypted` is `true`, the value is encrypted via AES-256-GCM before storage.
 */
export function setSetting(key: string, value: string, encrypted = false): void {
  const db = getDb();
  const storedValue = encrypted ? encrypt(value) : value;
  const now = new Date();

  db.insert(settings)
    .values({ key, value: storedValue, encrypted, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: storedValue, encrypted, updatedAt: now },
    })
    .run();
}

/**
 * Returns all settings rows. Encrypted values remain encrypted in the result.
 */
export function getAllSettings(): (typeof settings.$inferSelect)[] {
  const db = getDb();
  return db.select().from(settings).all();
}

/**
 * Retrieves and decrypts the OpenRouter API key from the settings table.
 *
 * Returns the plaintext key, or `null` if no key is stored.
 *
 * @throws {Error} If decryption fails (wrong key or tampered data).
 */
export function getDecryptedApiKey(): string | null {
  const row = getSetting("openrouterApiKey");
  if (!row) {
    return null;
  }

  // If the value was stored without encryption, return as-is
  if (!row.encrypted) {
    return row.value;
  }

  return decrypt(row.value);
}

// ---------------------------------------------------------------------------
// Custom OpenAI-compatible providers
// ---------------------------------------------------------------------------

/**
 * Returns the configured custom providers, decrypting the stored blob.
 *
 * Returns an empty array if no providers are configured, or if the stored value
 * is malformed/undecryptable (so a corrupt blob never crashes the app).
 */
export function getCustomProviders(): CustomProvider[] {
  const row = getSetting(CUSTOM_PROVIDERS_KEY);
  if (!row) {
    return [];
  }

  try {
    const json = row.encrypted ? decrypt(row.value) : row.value;
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as CustomProvider[]) : [];
  } catch {
    return [];
  }
}

/**
 * Persists the custom providers as a single encrypted JSON blob.
 *
 * The whole array is encrypted because it contains provider API keys.
 */
export function setCustomProviders(providers: CustomProvider[]): void {
  setSetting(CUSTOM_PROVIDERS_KEY, JSON.stringify(providers), true);
}

/**
 * Returns the configured OpenRouter base URL, or the public default when none
 * is set. A blank stored value resets to the default.
 */
export function getOpenrouterBaseUrl(): string {
  const row = getSetting(OPENROUTER_BASE_URL_KEY);
  const value = row?.value?.trim();
  return value && value.length > 0 ? value : DEFAULT_OPENROUTER_BASE_URL;
}
