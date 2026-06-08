# Security

## API Key Storage

- All provider API keys are **encrypted at rest** using AES-256-GCM in the `settings` table. This covers the OpenRouter key (`openrouterApiKey`) and every custom provider key, which are stored together in an encrypted `customProviders` JSON blob.
- The encryption key is derived from `ENCRYPTION_SECRET` env var, or auto-generated on first run and stored at `data/.secret`.
- Keys are **never logged**, **never included in error messages**, and **never sent to the client** — `GET /api/settings` masks the OpenRouter key and replaces custom provider keys with an `apiKeySet` boolean.
- Decryption happens only server-side in API route handlers and the provider resolver.

## Input Validation

- All user input is validated on API routes before processing.
- Drizzle ORM uses parameterized queries -- no raw SQL interpolation.
- Markdown content in skill previews is rendered with a safe renderer that strips dangerous HTML (e.g., `<script>` tags).

## Filesystem Safety

- **Deploy** only writes to `~/.claude/skills/` -- the target directory is validated and canonicalized before any write.
- **Import** only reads from user-specified directories, restricted to `.md` and known text file extensions.
- Symlinks are not followed outside the source directory during import.
- No arbitrary filesystem access is exposed via API routes.
- All paths are resolved to absolute paths and checked for traversal attempts.

## Logging

- Sensitive fields (`apiKey`, `openrouterApiKey`, `authorization`) are redacted via Pino's `redact` config.
- API key values are never passed to the logger (redact config is a safety net).
- Settings updates log only the list of updated keys, never values.
- Full system prompts are not logged (skill ID is logged instead).

## Dependencies

- Lock file (`pnpm-lock.yaml`) is committed for reproducible builds.
- No native addons required -- pure JavaScript/TypeScript stack.

## No Authentication

uberSKILLS is a single-user local development tool. There is no login, signup, or user management. If exposed to a network, use a reverse proxy with authentication.
