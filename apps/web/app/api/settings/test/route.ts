import { getCustomProviders, getDecryptedApiKey, getOpenrouterBaseUrl } from "@uberskills/db";
import { NextResponse } from "next/server";

import { routeLogger } from "@/lib/logger";

const log = routeLogger("GET", "/api/settings/test");

const PROVIDER_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://uberskills.dev",
  "X-Title": "uberSKILLS",
};

/**
 * GET /api/settings/test -- Tests connectivity to a configured provider.
 *
 * With `?provider=<id>` it tests a custom OpenAI-compatible provider by calling
 * its `/models` endpoint. Otherwise it tests the stored OpenRouter API key.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const providerId = new URL(request.url).searchParams.get("provider");
  if (providerId) {
    return testCustomProvider(providerId);
  }

  try {
    const apiKey = getDecryptedApiKey();
    if (!apiKey) {
      log.warn("no API key configured");
      return NextResponse.json(
        { error: "No API key configured. Add one in Settings first.", code: "NO_API_KEY" },
        { status: 401 },
      );
    }

    const baseUrl = getOpenrouterBaseUrl().replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://uberskills.dev",
        "X-Title": "uberSKILLS",
      },
    });

    if (!res.ok) {
      const status = res.status;
      if (status === 401 || status === 403) {
        log.warn({ upstreamStatus: status }, "invalid API key");
        return NextResponse.json(
          { error: "Invalid API key. Check your key at openrouter.ai/keys.", code: "INVALID_KEY" },
          { status: 401 },
        );
      }
      if (status === 429) {
        log.warn("rate limited by OpenRouter");
        return NextResponse.json(
          { error: "Rate limited by OpenRouter. Try again in a moment.", code: "RATE_LIMITED" },
          { status: 429 },
        );
      }
      log.warn({ upstreamStatus: status }, "upstream error from OpenRouter");
      return NextResponse.json(
        { error: `OpenRouter returned status ${status}`, code: "UPSTREAM_ERROR" },
        { status: 502 },
      );
    }

    log.info("API key test passed");
    return NextResponse.json({ status: "connected" });
  } catch (err) {
    log.error({ err }, "failed to reach OpenRouter");
    return NextResponse.json(
      {
        error: "Could not reach OpenRouter. Check your network connection.",
        code: "NETWORK_ERROR",
      },
      { status: 502 },
    );
  }
}

/**
 * Tests a custom OpenAI-compatible provider by GETting its `/models` endpoint.
 *
 * Some providers don't expose `/models`, so this is best-effort: 2xx means
 * connected, 401/403 means a bad key, and other statuses are reported as
 * upstream errors with a hint.
 */
async function testCustomProvider(providerId: string): Promise<NextResponse> {
  const provider = getCustomProviders().find((p) => p.id === providerId);
  if (!provider) {
    log.warn({ providerId }, "custom provider not found");
    return NextResponse.json(
      { error: "Custom provider not found.", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const url = `${provider.baseUrl.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = { ...PROVIDER_HEADERS };
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  try {
    const res = await fetch(url, { headers });

    if (res.status === 401 || res.status === 403) {
      log.warn({ providerId, upstreamStatus: res.status }, "invalid custom provider key");
      return NextResponse.json(
        { error: "Invalid API key for this provider.", code: "INVALID_KEY" },
        { status: 401 },
      );
    }
    if (!res.ok) {
      log.warn({ providerId, upstreamStatus: res.status }, "custom provider returned error");
      return NextResponse.json(
        {
          error: `Provider returned status ${res.status}. The endpoint may not expose /models.`,
          code: "UPSTREAM_ERROR",
        },
        { status: 502 },
      );
    }

    log.info({ providerId }, "custom provider test passed");
    return NextResponse.json({ status: "connected" });
  } catch (err) {
    log.error({ err, providerId }, "failed to reach custom provider");
    return NextResponse.json(
      {
        error: "Could not reach the provider. Check the base URL and your network connection.",
        code: "NETWORK_ERROR",
      },
      { status: 502 },
    );
  }
}
