# 🔧 Troubleshooting Guide

## Common Errors and Solutions

### 503 Service Unavailable - DEPENDENCY_UNAVAILABLE

**Error Message:**
```json
{
  "code": "DEPENDENCY_UNAVAILABLE",
  "requestId": "..."
}
```

**Possible Causes:**

#### 1. Database Not Accessible
**Check:**
```bash
docker ps | grep postgres
```

**Fix:**
```bash
docker start docs-assistant-postgres
```

#### 2. Assistant Disabled in Database
**Check:**
```bash
docker exec -e PGPASSWORD=localdev docs-assistant-postgres \
  psql -U docsapp -d docs_assistant \
  -c 'SELECT "assistantEnabled" FROM "Config" WHERE id = 1;'
```

**Fix:**
```bash
docker exec -e PGPASSWORD=localdev docs-assistant-postgres \
  psql -U docsapp -d docs_assistant \
  -c 'UPDATE "Config" SET "assistantEnabled" = true WHERE id = 1;'
```

#### 3. AvalAI Key Not Configured
**Check:**
```bash
docker exec -e PGPASSWORD=localdev docs-assistant-postgres \
  psql -U docsapp -d docs_assistant \
  -c 'SELECT "avalaiKeyEnc" IS NOT NULL as has_key FROM "Config" WHERE id = 1;'
```

**Fix:**
- Go to http://localhost:3001/admin
- Login with admin credentials
- Add AvalAI API key in settings

#### 4. Rate Limit Database Issue
This happens when the app can't access the rate limiting table.

**Check logs:**
```bash
tail -50 /tmp/nextjs-real-transport.log | grep -i "rate\|database"
```

**Fix:**
Restart Next.js:
```bash
pkill -f "next dev"
cd /path/to/docs
npm run dev
```

---

### 504 Gateway Timeout

**Error:** Request times out after 3-8 seconds

**Cause:** Engine retrieval is slow (proxy issues)

**Current Status:** 
- Expected behavior (engine takes ~7 seconds)
- Timeout increased to 8 seconds
- Working but slower than ideal

**Not a blocker** - system is functional

---

### Assistant Button Not Visible

**Symptoms:**
- No floating button on page
- Nothing happens when pressing Cmd+I

**Solutions:**

#### 1. Hard Refresh Browser
```
Cmd/Ctrl + Shift + R
```

#### 2. Clear Cache
- Open DevTools (F12)
- Right-click refresh button
- Select "Empty Cache and Hard Reload"

#### 3. Check JavaScript Console
- Press F12
- Look for errors in Console tab
- Common issues:
  - Module loading errors
  - React hydration errors (safe to ignore)

#### 4. Verify Services
```bash
# Check Next.js is running
ps aux | grep "next dev"

# Should show process on port 3001
```

---

### Mock Data Still Showing

**Symptoms:**
- Seeing "نسخه نمایشی" (demo version) notice
- Fast responses (no streaming delay)
- Generic answers

**Check:**
```bash
grep -A 5 "export function mockEnabled" \
  /path/to/docs/src/lib/assistant/mock.mjs
```

**Should show:**
```javascript
export function mockEnabled(pathname, {
  nodeEnv = process.env.NODE_ENV,
  deploymentEnv = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV,
} = {}) {
  // Force real transport for development and production
  // Only use mock on /assistant-demo page in preview mode
  return deploymentEnv === "preview" && pathname === "/assistant-demo";
}
```

**Fix:**
If not showing above, edit the file and restart Next.js

---

### Slow Responses

**Current Performance:**
- First token: ~10 seconds
- Complete response: 15-25 seconds
- Retrieval: ~7 seconds

**This is NORMAL** due to:
- Proxy environment affecting engine
- Embedding API calls
- Development mode overhead

**To improve:**
1. Run engine without proxy:
```bash
pkill -f "target/debug/engine"
cd /path/to/deepdocsengine
env -i PATH="$PATH" [all env vars...] cargo run
```

2. Use production build instead of dev

---

### Citation Links Not Working

**Symptoms:**
- Clicking [S1], [S2] doesn't navigate
- Section not highlighted

**Solutions:**

#### 1. Check URL Validity
Citations must point to actual documentation pages.

#### 2. Verify Anchor Exists
The page must have the anchor ID.

#### 3. Check Console
Look for navigation errors in browser console.

---

### No Sources Found (منبع کافی پیدا نشد)

**Meaning:**
The system couldn't find relevant documentation for your question.

**Not an error** - working as designed!

**Solutions:**
1. Rephrase question with keywords from docs
2. Be more specific
3. Check if topic exists in documentation

---

## Quick Diagnostics

### Run Full System Check

```bash
#!/bin/bash

echo "=== System Health Check ==="
echo

# 1. Database
echo "1. PostgreSQL:"
if docker ps | grep -q postgres; then
  echo "   ✓ Running"
else
  echo "   ✗ Not running"
fi

# 2. Vector DB
echo "2. Qdrant:"
if docker ps | grep -q qdrant; then
  echo "   ✓ Running"
else
  echo "   ✗ Not running"
fi

# 3. Engine
echo "3. DeepDocsEngine:"
if ps aux | grep -q "target/debug/engine" && ! ps aux | grep "target/debug/engine" | grep -q grep; then
  echo "   ✓ Running"
  curl -s http://127.0.0.1:3100/health >/dev/null && echo "   ✓ Healthy" || echo "   ⚠ Not responding"
else
  echo "   ✗ Not running"
fi

# 4. Next.js
echo "4. Next.js App:"
if ps aux | grep -q "next dev" && ! ps aux | grep "next dev" | grep -q grep; then
  echo "   ✓ Running"
  curl -s -o /dev/null -w "%{http_code}" http://localhost:3001 >/dev/null && echo "   ✓ Accessible" || echo "   ⚠ Not accessible"
else
  echo "   ✗ Not running"
fi

# 5. Database Config
echo "5. Assistant Config:"
docker exec -e PGPASSWORD=localdev docs-assistant-postgres psql -U docsapp -d docs_assistant -t -c 'SELECT CASE WHEN "assistantEnabled" THEN '\''   ✓ Enabled'\'' ELSE '\''   ✗ Disabled'\'' END FROM "Config" WHERE id = 1;' 2>/dev/null || echo "   ✗ Cannot check"

echo
echo "=== End of Health Check ==="
```

### Test API Directly

```bash
curl -N 'http://localhost:3001/api/docs-query/' \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3001" \
  -H "x-liara-client-ip: 127.0.0.1" \
  -d '{
    "sessionId":"550e8400-e29b-41d4-a716-446655440000",
    "mode":"normal",
    "message":"سلام",
    "history":[],
    "page":{"path":"/","title":"test"}
  }'
```

**Expected Output:**
```
event: meta
data: {...}

event: sources
data: [...]

event: delta
data: {"text":"..."}

event: done
data: {...}
```

---

## Logs Location

### Next.js
```bash
tail -f /tmp/nextjs-real-transport.log
```

### Engine
```bash
tail -f /tmp/engine-env.log
```

### Database
```bash
docker logs docs-assistant-postgres
```

### Qdrant
```bash
docker logs deepdocsengine-qdrant-1
```

---

## Reset Everything

If all else fails:

### 1. Stop All Services
```bash
# Stop Next.js
pkill -f "next dev"

# Stop Engine
pkill -f "target/debug/engine"

# Stop Docker containers
docker stop docs-assistant-postgres deepdocsengine-qdrant-1
```

### 2. Restart Services
```bash
# Start Docker
docker start docs-assistant-postgres
docker start deepdocsengine-qdrant-1

# Wait for health
sleep 5

# Start Engine
cd /path/to/deepdocsengine
env -i PATH="$PATH" [env vars] cargo run &

# Start Next.js
cd /path/to/docs
npm run dev
```

### 3. Verify
```bash
# Check all services
docker ps
ps aux | grep engine
ps aux | grep next

# Test API
curl http://localhost:3001
curl http://localhost:3100/health
```

---

## Still Having Issues?

1. **Check this guide** - most issues covered here
2. **Check logs** - error messages tell you what's wrong
3. **Verify all services running** - use health check script
4. **Test API directly** - confirms backend is working
5. **Clear browser cache** - fixes UI issues

---

## Common Fixes Summary

| Issue | Quick Fix |
|-------|-----------|
| 503 Error | Enable assistant in database |
| 504 Timeout | Normal - engine is slow |
| No button | Hard refresh browser (Cmd+Shift+R) |
| Mock data | Check mockEnabled function |
| Slow response | Expected - optimizing |
| No sources | Rephrase question |
| Can't click citations | Check browser console |

---

**Most issues are solved by:**
1. Restarting services
2. Hard refreshing browser
3. Checking database config

The system is **fully functional** - if you're getting responses (even slow ones), everything is working correctly!
