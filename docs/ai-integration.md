# AI Integration

uberSKILLS reaches AI models through the [Vercel AI SDK](https://sdk.vercel.ai): the built-in [OpenRouter](https://openrouter.ai) provider via `@openrouter/ai-sdk-provider`, and custom OpenAI-compatible providers via `@ai-sdk/openai-compatible`. OpenRouter is **optional** — you can instead (or additionally) configure any number of custom providers (MiniMax, DeepSeek, Moonshot, a local Ollama, …).

## Overview

```
Client (useChat)  -->  API Route (streamText)  -->  resolveLanguageModel()  -->  Provider  -->  AI Model
                  <--  SSE stream              <--                          <--           <--
```

All AI calls are server-side. Provider API keys are decrypted from the database only in API route handlers and never exposed to the client.

## Provider resolution

A single helper, `resolveLanguageModel(modelId)` in `apps/web/lib/ai-provider.ts`, turns a model id into an AI SDK language model. It is the one place that knows about providers, so the streaming routes (`/api/chat`, `/api/test`, `/api/test/[id]/continue`) never wire providers directly.

- Model ids prefixed with `custom:<providerId>/<modelId>` resolve to a configured custom provider.
- All other ids fall back to the built-in OpenRouter provider (requires an OpenRouter API key).

Custom providers are wired as `@ai-sdk/openai-compatible` clients and managed through the AI SDK's [`createProviderRegistry`](https://ai-sdk.dev/docs/reference/ai-sdk-core/provider-registry) (keyed by provider id, separator `/`); only models the user explicitly listed are allowed. OpenRouter uses a dedicated `createOpenRouter` client (with an overridable base URL), since its `vendor/model:variant` id scheme is distinct. When nothing matches, `resolveLanguageModel` throws `NoProviderError`, which routes map to HTTP 401.

## OpenRouter

### API Key

- Stored encrypted (AES-256-GCM) in the `settings` table.
- Decrypted server-side in API route handlers.
- Never logged, never included in error messages, never sent to the client.

### Models Endpoint

```
GET https://openrouter.ai/api/v1/models
```

Used to populate model selector dropdowns. Results are cached in the database.

### Chat Completions

```
POST https://openrouter.ai/api/v1/chat/completions
```

Used for skill creation and testing. Responses are streamed via SSE. Token usage is returned in the final chunk.

### Required Headers

All requests to OpenRouter include:

```
HTTP-Referer: http://localhost:3000
X-Title: uberSKILLS
```

### Custom Base URL

The OpenRouter base URL defaults to `https://openrouter.ai/api/v1` but can be overridden in Settings (`openrouterBaseUrl`). Point it at an OpenRouter-compatible gateway to extend the available models. The override applies to model sync, the connection test, and chat/test streaming.

## Custom Providers (OpenAI-compatible)

Custom providers are stored as a single **encrypted** `customProviders` blob in the `settings` table (they contain API keys). Each provider has an `id`, `name`, `baseUrl`, `apiKey`, and a manually-entered (or fetched) list of `models`.

- Their models appear in the model picker grouped under the provider name, with ids namespaced as `custom:<providerId>/<modelId>`.
- `GET /api/settings` returns providers with keys masked (`apiKeySet: boolean`); raw keys never reach the client.
- `POST /api/settings/providers/fetch-models` proxies the provider's `GET {baseUrl}/models` so users can auto-populate the model list (manual entry is the fallback for endpoints that don't expose `/models`).
- `GET /api/settings/test?provider=<id>` performs a best-effort connectivity check against `{baseUrl}/models`.
- Keyless endpoints (e.g. a local Ollama) are supported: an empty key is passed through as a string so the provider never falls back to an environment variable.

## Vercel AI SDK

### Server-Side -- `streamText()`

Used in `/api/chat` and `/api/test` route handlers, with provider selection delegated to the resolver:

```typescript
import { streamText } from "ai";
import { resolveLanguageModel, isNoProviderError } from "@/lib/ai-provider";

export async function POST(req: Request) {
  const { messages, model } = await req.json();

  let resolved;
  try {
    resolved = resolveLanguageModel(model);
  } catch (err) {
    if (isNoProviderError(err)) return noProviderResponse(); // 401
    throw err;
  }

  const result = streamText({
    model: resolved.model,
    system: systemPrompt,
    messages,
  });

  return result.toDataStreamResponse();
}
```

### Client-Side -- `useChat()`

Used in React components for chat and testing interfaces:

```typescript
import { useChat } from "ai/react";

const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
  api: "/api/chat",
  body: { model: selectedModel },
});
```

### Key Features Used

| Feature | Usage |
|---|---|
| `streamText()` | Server-side streaming in API routes |
| `useChat()` | Client-side chat hook with automatic streaming |
| `toDataStreamResponse()` | Convert stream to Next.js-compatible Response |
| `onFinish` callback | Capture token usage and save to `test_runs` |

## System Prompts

### Skill Creation

When using AI-assisted creation, the system prompt instructs the model to generate valid SKILL.md output with:

- YAML frontmatter containing `name`, `description`, and `trigger` fields
- Clear, actionable markdown instructions
- Example trigger scenarios

### Skill Testing

The resolved skill content itself serves as the system prompt. Any `$ARGUMENTS` or `$VARIABLE_NAME` placeholders are substituted with user-provided values before sending.
