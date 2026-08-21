# AvalAI API integration

This project uses AvalAI as an OpenAI-compatible model provider. AvalAI credentials stay on the server; browser code calls this project's `/api/chat` proxy instead of calling AvalAI directly.

Source: [AvalAI quickstart](https://docs.avalai.ir/fa/quickstart)

## Current request flow

```text
Browser
  └─ POST /api/chat
       ├─ rate limit by clientUuid
       ├─ load encrypted AvalAI key from PostgreSQL
       ├─ POST https://api.avalai.ir/v1/chat/completions
       └─ return JSON or pass through the SSE stream
```

Relevant files:

- `src/pages/api/chat.js`: chat proxy and metrics recording
- `src/pages/api/config.js`: protected provider configuration API
- `src/components/admin/Settings.js`: admin settings form
- `src/lib/crypto.js`: AES-256-GCM encryption for the API key
- `src/lib/rate.js`: in-memory rate limit
- `prisma/schema.prisma`: provider configuration and request metrics
- `DEPLOY.md`: database, environment, and deployment setup

## 1. Create an AvalAI API key

1. Create an account in the AvalAI dashboard.
2. Open **API Keys** and create a key.
3. Copy the key immediately; it is shown once.
4. Never commit it, expose it through a `NEXT_PUBLIC_*` variable, or send it to browser code.

For direct command-line tests only, store it in the shell:

```bash
export AVALAI_API_KEY="sk-..."
```

Production key storage is configured through this project's admin panel, not through a public environment variable.

## 2. Discover available models

AvalAI exposes a public model list:

```bash
curl https://api.avalai.ir/public/models
```

Authenticated model metadata is available through `/v1/models`:

```bash
curl https://api.avalai.ir/v1/models \
  -H "Authorization: Bearer $AVALAI_API_KEY"
```

Do not assume a model name remains available forever. Check the model list before changing production configuration.

## 3. Verify AvalAI directly

This project currently uses **Chat Completions** because its request format matches the existing `messages`-based proxy.

```bash
curl https://api.avalai.ir/v1/chat/completions \
  -H "Authorization: Bearer $AVALAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a concise documentation assistant."},
      {"role": "user", "content": "سلام"}
    ]
  }'
```

AvalAI recommends `/v1/responses` for new applications, but this project does not proxy that endpoint yet. Adding Responses support requires a separate project endpoint and response parser.

## 4. Configure this project

Complete database and environment setup in [`DEPLOY.md`](./DEPLOY.md), then:

1. Start the application.
2. Open `/admin`.
3. Sign in with the configured admin credentials.
4. Open **Settings**.
5. Set:
   - **API key**: AvalAI key
   - **Base URL**: `https://api.avalai.ir/v1`
   - **Default model**: a model returned by the model API
6. Save.

The key is encrypted with `ENCRYPTION_SECRET` before PostgreSQL storage. The plaintext key is never returned by `/api/config`; the admin UI receives only its last four characters.

> Current limitation: `defaultModel` is stored for the UI but `/api/chat` does not inject it. Every chat request must still include `model`.

## 5. Call the project proxy

### Non-streaming request

```bash
curl http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "clientUuid": "manual-test",
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "Answer only from the supplied documentation context."},
      {"role": "user", "content": "سلام"}
    ]
  }'
```

`clientUuid` is required by this project for rate limiting and metrics. It is removed before the request reaches AvalAI.

### Streaming request

```bash
curl -N http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "clientUuid": "manual-test",
    "model": "gpt-4o-mini",
    "stream": true,
    "messages": [
      {"role": "user", "content": "در سه جمله پاسخ بده."}
    ]
  }'
```

When `stream` is `true`, the proxy adds:

```json
{
  "stream_options": { "include_usage": true }
}
```

It then passes AvalAI's SSE stream to the caller and reads the final usage data for metrics.

### Browser request

```js
const clientUuid =
  localStorage.clientUuid ||= crypto.randomUUID();

const response = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientUuid,
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "سلام" }],
  }),
});

if (!response.ok) throw new Error(await response.text());
const completion = await response.json();
console.log(completion.choices[0].message.content);
```

The future documentation assistant should call this same-origin endpoint. It must never receive the AvalAI key.

## Request contract

`POST /api/chat` accepts an OpenAI-compatible Chat Completions body plus project field `clientUuid`.

Minimum body:

```json
{
  "clientUuid": "stable-browser-uuid",
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "Question" }]
}
```

All fields except `clientUuid` are forwarded to AvalAI. This also permits documented provider-specific fields supported by the selected model.

## Responses and errors

| Status | Meaning |
| --- | --- |
| `200` | JSON completion or SSE stream |
| `400` | Missing `clientUuid` |
| `405` | Method other than `POST` |
| `429` | Local rate limit exceeded, currently 5 requests/minute per UUID |
| `503` | AvalAI key has not been configured |
| `502` | AvalAI could not be reached |
| Other upstream status | AvalAI rejected the request; status is preserved |

AvalAI asks clients to honor `Retry-After` and use bounded exponential backoff with jitter after `429`. Current proxy does not forward `Retry-After`, so header forwarding must be added before relying on automatic retries.

## Metrics and request tracking

The proxy records:

- client UUID
- model
- prompt, completion, and total tokens when available
- latency
- success, error, or rate-limited status
- estimated cost for models listed in `src/lib/pricing.js`

AvalAI returns `avalai-request-id` for provider-side request and exact-cost tracking. Current proxy does not forward or store this header. Current dashboard cost is therefore an estimate, not AvalAI's exact transaction cost.

## Security and production limits

- Keep AvalAI calls server-side.
- Rotate the key through `/admin`; never log it.
- Keep `ENCRYPTION_SECRET` stable. Changing it makes the stored key unreadable.
- Validate allowed models and request size before exposing chat publicly.
- Current rate limiting is in memory and trusts client-provided `clientUuid`; it is cost smoothing, not abuse prevention.
- Move rate limiting to Redis and include server-observed identity before running multiple replicas.
- Add timeout and abort propagation before production chatbot rollout.
- Do not log prompts, documentation context, or generated answers unless a retention policy explicitly allows it.
