# Fix: "Too many requests from this IP, please try again later." (HTTP 429)

## Summary

Users in production intermittently receive:

> **Too many requests from this IP, please try again later.**

This is returned by the application's own `express-rate-limit` middleware (HTTP **429**), not by the browser, network, or an external service.

---

## Root Cause

| # | Cause | Detail |
|---|-------|--------|
| 1 | **Limit too low** | Rate limiter caps each IP at **100 requests / 15 min** across all `/api` routes. A single SPA page load can fire 20–50 API calls, so the cap is unrealistically low. |
| 2 | **`trust proxy` not set (primary cause)** | The app sits behind **Nginx**, but Express is not told to trust the proxy. So `req.ip` resolves to the **proxy's IP**, meaning **all users share one rate-limit bucket** and collectively trip the limit within seconds. |
| 3 | **Hardcoded values** | Window/max are hardcoded, so they cannot be tuned per environment without a code change. |

### Where it lives

- Limiter definition: `backend/src/app.js` (lines 52–62)
- Config values: `backend/src/config/index.js` (`rateLimit` block, lines 223–227)

```js
// backend/src/config/index.js (current)
rateLimit: {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // requests per window per IP
},
```

```js
// backend/src/app.js (current)
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again later.',
  },
});
app.use('/api', limiter);
```

---

## Solution

Four changes:

1. Make per-IP limiting work behind the proxy (`trust proxy`).
2. Make window/max **env-configurable** with safe defaults.
3. Raise production to a realistic limit.
4. Exclude the health check from rate limiting.

**Decisions applied:** Topology = **Nginx → app** ⇒ `TRUST_PROXY_HOPS=1`. Default `max` = **1000**.

---

### Change 1 — `backend/src/config/index.js`

Replace the `rateLimit` block (lines 223–227):

```js
rateLimit: {
  windowMs: parseInt(env('RATE_LIMIT_WINDOW_MS', String(15 * 60 * 1000)), 10),
  max: parseInt(env('RATE_LIMIT_MAX', '1000'), 10),
  // Reverse-proxy hops in front of the app (Nginx=1). 0 = trust none (dev default).
  trustProxy: parseInt(env('TRUST_PROXY_HOPS', '0'), 10),
},
```

### Change 2 — `backend/src/app.js`

Immediately after `const app = express();` (line 14):

```js
// Trust N reverse-proxy hops so req.ip reflects the real client (per-IP rate limiting).
if (config.rateLimit.trustProxy > 0) {
  app.set('trust proxy', config.rateLimit.trustProxy);
}
```

### Change 3 — `backend/src/app.js` (lines 52–62)

Add a `skip` for the health check:

```js
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health', // limiter is mounted at /api, so req.path is /health here
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again later.',
  },
});
```

### Change 4 — Environment files

**`backend/.env.production`**
```
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=1000
TRUST_PROXY_HOPS=1
```

**`backend/.env.staging`**
```
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=1000
TRUST_PROXY_HOPS=1
```

**`backend/.env.development`**
```
TRUST_PROXY_HOPS=0
```

---

## ⚠️ Deployment Prerequisite (Nginx)

For `trust proxy: 1` to work, **Nginx must forward the real client IP**. The `location` block proxying to the backend must include:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP       $remote_addr;
```

If Nginx does not send `X-Forwarded-For`, the app cannot recover the client IP and the shared-bucket problem persists regardless of the code fix.

### Why the hop count must be exact

`app.set('trust proxy', N)` means "trust exactly N proxy hops" — it is **not** a blanket "trust all":

- **Too low** → real client IP not read → everyone still shares a bucket (bug persists).
- **Too high / trust-all** → clients can spoof `X-Forwarded-For` and evade the limit (security issue). `express-rate-limit` also emits a validation error when it detects a permissive `trust proxy` setting.

| Topology | Value |
|----------|-------|
| Direct (no proxy) | `0` |
| Nginx → app | `1` |
| Cloudflare → Nginx → app | `2` |

---

## Verification

1. Loop `curl` on the health check — must **never** return 429:
   ```bash
   for i in $(seq 1 50); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/api/health; done
   ```
2. Hit a real `/api` endpoint from **two different client IPs** — each should get its own budget (check the `RateLimit-Remaining` response header).
3. Production response shows `RateLimit-Limit: 1000`.
4. Backend logs are free of `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` / permissive-trust-proxy warnings (those indicate a wrong hop count).

---

## Immediate Unblock (before deploy)

- Wait 15 minutes for the window to reset, **or**
- Restart the backend — the in-memory limiter store resets on restart.

---

## Rollback

Revert the three code hunks and remove the new env vars, then restart (the in-memory store resets). **No DB, schema, or dependency changes** — low risk.

---

## Risk Assessment

**Low.** No database, schema, or dependency changes (`express-rate-limit` is already installed). Config-only plus three small code edits, all behind env vars with backward-safe defaults (except the deliberate `max` default bump from 100 → 1000).
