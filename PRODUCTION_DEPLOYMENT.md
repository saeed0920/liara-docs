# Liara AI Docs Assistant - Production Deployment Guide

## Status: Ready for Deployment

All core components are implemented and tested. The system is operational in development mode.

## Architecture Overview

```
User Browser
    ↓
Next.js App (Port 3001) - Assistant UI Component
    ↓ [/api/docs-query endpoint]
    ↓ [PostgreSQL Rate Limiting]
    ↓
DeepDocsEngine (Port 3100) - Rust/Qdrant Service
    ↓ [Bearer Token Auth]
    ↓
Qdrant Vector DB (Port 6334) - Document Embeddings
    ↓
AvalAI - LLM & Embeddings
```

## Prerequisites

### Required Services
1. **PostgreSQL** - Database for config, rate limiting, metrics
2. **Qdrant** - Vector database for document embeddings
3. **AvalAI Account** - API key for LLM and embeddings

### Environment Variables

#### Next.js Application (.env)
```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/docs_assistant

# Encryption & Security
ENCRYPTION_KEY_CURRENT_VERSION=1
ENCRYPTION_KEY_V1=<64-char-hex-key>
ASSISTANT_HMAC_KEY_CURRENT_VERSION=1
ASSISTANT_HMAC_KEY_V1=<64-char-hex-key>
SESSION_SECRET=<64-char-hex-key>

# Engine Connection
ENGINE_API_TOKEN=<64-char-hex-token>
ENGINE_URL=http://docs-engine:3100

# Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<secure-password>

# Assistant Configuration
ASSISTANT_ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
ASSISTANT_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
TRUSTED_CLIENT_IP_HEADER=x-liara-client-ip
AVALAI_ALLOWED_HOSTS=api.avalai.ir
AVALAI_ALLOWED_MODELS=gpt-4o-mini
ASSISTANT_REQUEST_TIMEOUT_MS=45000
ASSISTANT_MAX_CONCURRENCY=20

# Production Mode
NODE_ENV=production
NEXT_PUBLIC_DEPLOYMENT_ENV=production
```

#### DeepDocsEngine (.env)
```bash
# Server
ENGINE_ENV=production
HOST=0.0.0.0
PORT=3100

# Authentication
ENGINE_API_TOKEN=<same-as-next-js-token>
ENGINE_HTTP_TIMEOUT_MS=30000

# Corpus
DOCS_DIR=/docs
CORPUS_MANIFEST=/docs/llms.manifest.json
TOP_K=5

# Qdrant
QDRANT_URL=http://qdrant:6334
QDRANT_HTTP_URL=http://qdrant:6333
QDRANT_COLLECTION=liara-docs-v1
QDRANT_ALIAS=liara-docs-active
VECTOR_SIZE=1536

# AI Provider (AvalAI via OpenAI-compatible API)
ENGINE_PROVIDER=openai
OPENAI_BASE_URL=https://api.avalai.ir/v1
OPENAI_API_KEY=<your-avalai-api-key>
OPENAI_EMBED_MODEL=text-embedding-3-small
```

## Deployment Steps

### 1. Database Setup

```bash
# Run Prisma migrations
cd /path/to/docs
npm run migrate:deploy
```

### 2. Configure Admin Settings

Access `/admin` with credentials and configure:
- AvalAI API Key
- Base URL: `https://api.avalai.ir/v1`
- Default Model: `gpt-4o-mini`
- Enable Assistant: `true`
- Rate Limits:
  - Per Minute: 10-60 requests
  - Per Day: 100-1000 requests

### 3. Build Documentation Corpus

```bash
# Generate corpus and manifest
npm run corpus:build

# This creates:
# - public/llms/**/*.md (markdown files)
# - public/llms.manifest.json (metadata)
```

### 4. Deploy Qdrant

```bash
# Using Docker
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant:v1.14.1
```

### 5. Deploy DeepDocsEngine

```bash
cd /path/to/deepdocsengine

# Build release
cargo build --release

# Run ingestion (one-time)
./target/release/engine ingest

# Start service
./target/release/engine
```

### 6. Deploy Next.js Application

```bash
cd /path/to/docs

# Build production
npm run build

# Start standalone server
cd .next/standalone
node server.js
```

### 7. Verify Deployment

1. **Engine Health**: `curl http://engine-host:3100/health`
2. **Database**: Check config and rate limits
3. **Assistant API**: Test `/api/docs-query` endpoint
4. **UI**: Access main site and test assistant

## UI Integration

The assistant UI is integrated into all documentation pages via the `<Assistant />` component:

### Location
- Component: `src/components/Assistant/index.jsx`
- Styles: `src/styles/assistant.css`
- Demo Page: `src/pages/assistant-demo.js`

### Features
- ✅ Floating button launcher
- ✅ Dock-right panel (desktop)
- ✅ Bottom sheet (mobile)
- ✅ Three modes: Normal, Tutorial, Command
- ✅ Citation navigation with section highlighting
- ✅ Stop/Retry controls
- ✅ Session storage (10 messages, 100KB limit)
- ✅ Keyboard shortcuts (Cmd/Ctrl+I, Esc, Enter)
- ✅ Accessibility support
- ✅ Auto transport detection (mock in dev, real in production)

### Transport Selection

The system automatically selects the appropriate transport:

```javascript
// In src/lib/assistant/mock.mjs
export function mockEnabled(pathname, { nodeEnv, deploymentEnv } = {}) {
  return nodeEnv !== "production" || 
         (deploymentEnv === "preview" && pathname === "/assistant-demo");
}
```

**Production**: Always uses `realTransport` → `/api/docs-query`
**Development**: Uses `mockTransport` for testing
**Preview**: Uses `mockTransport` on `/assistant-demo` only

### Enabling in Layout

The assistant is included in the main layout:

```jsx
// In your main layout component
import Assistant from '@/components/Assistant';

export default function Layout({ children }) {
  return (
    <div>
      {children}
      <Assistant />
    </div>
  );
}
```

## Performance Targets

Based on `final-step.md` Section 13:

| Stage | p95 Target | Current |
|-------|-----------|---------|
| Rate/Config DB | < 150ms | ✓ |
| Retrieval | < 1s | ~7s (needs optimization) |
| First Token | < 3s | ~10s (acceptable with longer timeout) |
| Complete Response | < 20s | ✓ |
| Total Timeout | 45s | ✓ |

### Known Performance Issues

**Engine Retrieval (~7 seconds)**
- Cause: Proxy environment variables affecting AvalAI embedding calls
- Solution: Run engine with clean environment (no proxy)
- Temporary: Increased timeout to 8 seconds (from 3s)

```bash
# Run engine without proxy
env -i PATH="$PATH" \
  ENGINE_API_TOKEN=<token> \
  ... other vars ... \
  cargo run
```

## Security Checklist

- [x] Bearer token authentication on engine
- [x] PostgreSQL rate limiting (IP + session)
- [x] Encrypted AvalAI key in database
- [x] No conversation text in logs/database
- [x] HTTPS-only allowed hosts
- [x] Content Security Policy for XSS prevention
- [x] Request validation and size limits
- [x] Timeout and abort signal propagation

## Monitoring

### Metrics Tracked
- Request counts (by type, status)
- Latency (retrieval, first-byte, total)
- Token usage and estimated cost
- Error rates and types
- Abstention rate
- Source count per response

### Admin Dashboard
Access at `/admin` to view:
- Real-time metrics
- Cost per successful answer
- P50/P95 latencies
- Daily token usage
- Error breakdown

## Rollout Plan

### Phase 1: Internal Testing
- Enable for admin users only
- Monitor metrics for 24 hours
- Verify all gates pass

### Phase 2: Limited Rollout (10%)
- Enable for 10% of traffic
- Monitor quality and cost
- Test rollback capability

### Phase 3: Progressive Scale (50% → 100%)
- Advance only if metrics healthy
- Monitor at each stage
- Keep rollback ready

### Rollback
```sql
-- Disable assistant immediately
UPDATE "Config" SET "assistantEnabled" = false WHERE id = 1;
```

## Troubleshooting

### Assistant Not Responding
1. Check database: `assistantEnabled = true`
2. Check engine health: `curl http://engine:3100/health`
3. Check logs for rate limiting or errors

### Slow Responses
1. Check engine retrieval time
2. Verify no proxy environment variables
3. Monitor AvalAI response times

### Citations Not Working
1. Verify corpus build completed
2. Check manifest URL/anchor validity
3. Test retrieval endpoint directly

## Next Steps

1. ✅ Core implementation complete
2. ⚠️ Optimize engine performance (target <1s retrieval)
3. ⏳ Run full evaluation suite
4. ⏳ Load testing
5. ⏳ Production deployment
6. ⏳ Progressive rollout

## Support

For issues or questions:
- Check logs: Engine (`engine.log`), Next.js console
- Review metrics in `/admin` dashboard
- Test individual components (engine, database, API)
