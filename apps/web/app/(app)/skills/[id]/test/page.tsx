import {
  getAllSettings,
  getCustomProviders,
  getDecryptedApiKey,
  getSkillBySlug,
  listFiles,
} from "@uberskills/db";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import type { TestSkillData } from "@/components/test/test-config-panel";
import { TestPageClient } from "./test-page-client";

// Always re-fetch on every request so the test page reflects the latest skill content.
export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

interface TestPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skill Testing page (Server Component).
 *
 * Fetches the skill by its slug (the `[id]` segment), reads the default model
 * and API key availability from settings, and renders the client-side
 * two-panel test interface.
 */
export default async function SkillTestPage({ params }: TestPageProps) {
  const { id: slug } = await params;

  const skill = getSkillBySlug(slug);
  if (!skill) notFound();

  // Build a lookup map from settings rows to resolve the default model.
  const settingsRows = getAllSettings();
  const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]));
  const defaultModel = settingsMap.get("defaultModel") ?? DEFAULT_MODEL;

  // Check whether any provider is configured without exposing secrets.
  // Decryption can throw if the secret is missing or corrupted, so we catch
  // and fall back to the custom-provider check rather than crashing the page.
  let hasApiKey = getCustomProviders().length > 0;
  try {
    hasApiKey = getDecryptedApiKey() !== null || hasApiKey;
  } catch {
    // Keep the custom-provider result.
  }

  // Count bundled files so the UI can inform users about file inclusion.
  const fileCount = listFiles(skill.id).length;

  // Serialise only the fields the client needs (avoids sending Date objects
  // and other Drizzle row data that cannot cross the RSC boundary).
  const skillData: TestSkillData = {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
    content: skill.content,
    fileCount,
  };

  // Suspense boundary is required because TestPageClient (or its descendants)
  // may use hooks like useSearchParams() that need a Suspense ancestor.
  return (
    <Suspense>
      <TestPageClient skill={skillData} defaultModel={defaultModel} hasApiKey={hasApiKey} />
    </Suspense>
  );
}
