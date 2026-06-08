import { getCustomProviders } from "@uberskills/db";
import { NextResponse } from "next/server";

import { routeLogger } from "@/lib/logger";

const log = routeLogger("POST", "/api/settings/providers/fetch-models");

const PROVIDER_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://uberskills.dev",
  "X-Title": "uberSKILLS",
};

interface FetchModelsBody {
  baseUrl?: string;
  apiKey?: string;
  providerId?: string;
}

interface RawModelsResponse {
  data?: Array<{ id?: unknown }>;
}

/**
 * POST /api/settings/providers/fetch-models -- Lists models from an
 * OpenAI-compatible provider's `/models` endpoint.
 *
 * Accepts an explicit `{ baseUrl, apiKey }` (for a provider being created) or a
 * `{ providerId }` referencing a stored provider — so the masked key never has
 * to leave the server. Returns `{ models: [{ id, name }] }`. On any failure it
 * returns a clear error so the UI can fall back to manual entry.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: FetchModelsBody;
  try {
    body = (await request.json()) as FetchModelsBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
  }

  let baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  let apiKey = typeof body.apiKey === "string" ? body.apiKey : "";

  // Fall back to a stored provider's base URL / key when only an id is given.
  if (body.providerId) {
    const stored = getCustomProviders().find((p) => p.id === body.providerId);
    if (stored) {
      if (!baseUrl) baseUrl = stored.baseUrl;
      if (!apiKey) apiKey = stored.apiKey;
    }
  }

  if (!baseUrl) {
    return NextResponse.json(
      { error: "A base URL is required to fetch models.", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  // Reject malformed base URLs before attempting a fetch.
  if (!URL.canParse(url)) {
    return NextResponse.json(
      { error: "The base URL is not a valid URL.", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const headers: Record<string, string> = { ...PROVIDER_HEADERS };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(url, { headers });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        { error: "Invalid API key for this provider.", code: "INVALID_KEY" },
        { status: 401 },
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Provider returned status ${res.status}. Enter models manually instead.`,
          code: "UPSTREAM_ERROR",
        },
        { status: 502 },
      );
    }

    const data = (await res.json()) as RawModelsResponse;
    const models = (data.data ?? [])
      .map((m) => (typeof m.id === "string" ? m.id : ""))
      .filter((id) => id !== "")
      .map((id) => ({ id, name: id }));

    log.info({ count: models.length }, "fetched provider models");
    return NextResponse.json({ models });
  } catch (err) {
    log.error({ err }, "failed to fetch provider models");
    return NextResponse.json(
      {
        error: "Could not reach the provider. Check the base URL and your network connection.",
        code: "NETWORK_ERROR",
      },
      { status: 502 },
    );
  }
}
