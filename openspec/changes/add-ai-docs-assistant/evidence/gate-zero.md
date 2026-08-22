# Gate Zero evidence

## AvalAI capability probe

- Timestamp (UTC): `2026-08-21T15:22:05Z`
- Base URL: `https://api.avalai.ir`
- Credential source: local ignored file `avalAIkey`; key and authorization header omitted
- Authenticated `GET /v1/models`: HTTP `200`, 385 models
- Public `GET /public/models`: HTTP `200`, 385 models
- Embedding candidates advertised included `text-embedding-3-small`
- Bounded `POST /v1/embeddings` request: model `text-embedding-3-small`, one short input
- Probe run 1: HTTP `200`, vector dimension `1536`
- Probe run 2: HTTP `200`, vector dimension `1536`

Captured output is reduced to status, model count, selected model, and vector dimension. API key, authorization header, response vectors, and provider payloads are not retained.

## Gate Zero provider boundary

AvalAI currently exposes a working OpenAI-compatible embeddings endpoint. `text-embedding-3-small` produced dimension `1536` consistently in two bounded probes, so it is the selected engine embedding model with `VECTOR_SIZE=1536`.

- Next.js completion provider/model: AvalAI `deepseek-v4-flash`
- Engine embedding provider/model: AvalAI OpenAI-compatible embeddings, `text-embedding-3-small`
- Engine credential: user-confirmed embedding deployment credential, supplied only through the engine's ignored/deployment environment
- Engine configuration: `../deepdocsengine/.env.example` and `docker-compose.yml` select `ENGINE_PROVIDER=openai`, `OPENAI_BASE_URL=https://api.avalai.ir/v1`, `OPENAI_EMBED_MODEL=text-embedding-3-small`, and `VECTOR_SIZE=1536`
- Credential boundary: completion and embedding credentials remain separate; neither is committed or exposed to browsers

A post-configuration bounded embedding probe returned HTTP `200` and dimension `1536`. Engine configuration scans passed with no embedded key. Rust tests could not download `axum-core` because crates.io timed out; this external network failure does not invalidate the live provider/configuration probe.

Gate Zero is approved with this boundary. Phase B remains blocked if provider, model, dimension, credential separation, or full-reindex policy becomes implicit or changes without a new Gate Zero decision.

Changing embedding model or dimension requires a newly versioned Qdrant collection and full reindex; active collection must not be modified in place.
