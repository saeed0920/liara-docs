# Deployment

The docs site now runs as a **Next.js standalone Node server** (not a static
export). This lets the same app host:

- The documentation pages (unchanged content).
- A chat proxy to the AvalAI API at `POST /api/chat` (streaming supported).
- Per-request metrics collection (volume, tokens, cost, latency, errors, unique users).
- A password-protected admin panel at `/admin` (Ant Design) to view metrics and rotate the AvalAI API key.

Everything is one deployable served from one origin. The chat proxy, admin
panel, and docs all share the same domain, so the (future) chatbot widget calls
`/api/chat` directly with no CORS setup.

A PostgreSQL database stores the encrypted AvalAI key, the admin user, and the
request metrics.

---

## What changed from the old static deploy

- `next.config.mjs` uses `output: "standalone"` instead of `output: "export"`.
- nginx is gone. Its entire config (`liara_nginx.conf`) was migrated into
  `next.config.mjs`: the ~440 legacy 301s live in `src/data/redirects.json`
  (served via `redirects()`), and the `/llms/*` + `.txt` inline UTF-8 handling,
  static-asset cache headers, and extensionless `.md` fallback are ported to
  `headers()` and `rewrites()`.
- The runtime is a Node server (`node server.js` from the standalone bundle),
  not nginx serving `/out`.

## Environment variables

Set these on the app (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string from your DBaaS. |
| `ENCRYPTION_SECRET` | 32-byte hex (64 chars). Encrypts the AvalAI key at rest. Generate: `openssl rand -hex 32`. |
| `SESSION_SECRET` | Secret used to sign the admin JWT session cookie. Generate: `openssl rand -hex 32`. |
| `ADMIN_USERNAME` | Admin login username. Seeded into the DB on first login attempt. |
| `ADMIN_PASSWORD` | Admin login password. Seeded (argon2-hashed) on first login attempt. |

> Changing `ENCRYPTION_SECRET` after a key is stored makes the stored key
> undecryptable — you must re-enter the AvalAI key in the admin panel afterwards.

> `ADMIN_USERNAME` / `ADMIN_PASSWORD` only seed the admin **once**. Changing them
> later does not update the existing admin row.

The build-time doc vars `MY_BASE_URL` / `MY_API_KEY` (used by the model-fetch
script) are unchanged.

## Provision the database (Liara)

1. Create a PostgreSQL database in the Liara console.
2. Copy its connection string into `DATABASE_URL`.

Migrations are applied automatically on container start
(`prisma migrate deploy` in the Dockerfile `CMD`). Create the initial migration
during development against a dev DB and commit it:

```
yarn install
yarn prisma migrate dev --name init
```

Commit the generated `prisma/migrations/` folder so `migrate deploy` has
something to apply in production.

## Deploy (Liara – Docker platform)

The root `Dockerfile` is multi-stage: it installs deps, runs `yarn build`
(sitemap + models + `prisma generate` + `next build`), then produces
a lean runtime image from the Next standalone output.

1. Create a **Docker** app on Liara (the previous static-platform image is no
   longer used).
2. Set all environment variables listed above.
3. Deploy. On boot the container runs `prisma migrate deploy` then starts the
   Next server on port 3000.
4. The docs are at `/`, the admin panel at `/admin`, the proxy at `/api/chat`.

## Configure the AvalAI key

1. Open `/admin` in a browser.
2. Log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
3. Go to **Settings**, paste the AvalAI API key, confirm the base URL
   (`https://api.avalai.ir/v1`) and default model, and save.

The key is encrypted with `ENCRYPTION_SECRET` before storage. The admin UI only
ever shows a masked value (`****` + last 4 chars); the plaintext is never
returned to the browser.

## Local development

```
cp .env.example .env      # fill in values; point DATABASE_URL at a local/dev Postgres
yarn install
yarn prisma migrate dev --name init
yarn dev               # Next dev server on :3001
```

Open `http://localhost:3001` for the docs and `http://localhost:3001/admin` for
the admin panel.

## Notes / known limitations

- **Rate limiting is in-memory** (5 requests/minute per client UUID). Works for a
  single instance only. Scaling to multiple instances requires moving the limiter
  to Redis.
- The **cost estimate** uses a small hardcoded per-model price table in
  `src/lib/pricing.js`. Update it when model pricing changes; unknown models
  record `null` cost.
- The rate limit keys on a client-supplied UUID (from the docs site's
  localStorage). Clearing localStorage yields a new UUID and a fresh quota — this
  is intended as cost smoothing, not abuse prevention.
- The chatbot widget itself is not implemented; the proxy endpoint (`/api/chat`)
  is ready for it.
