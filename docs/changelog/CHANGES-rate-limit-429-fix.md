# Rate Limit 429 Fix — "Too many requests from this IP"

Date: 2026-07-10

Scope: eliminating the frequent `429 — Too many requests from this IP, please try
again later.` errors seen during normal use of the app, while keeping (and
improving) brute-force protection on login.

---

## 1. Root cause

The global rate limiter in `backend/src/app.js` allowed only **100 requests per
15 minutes per IP** across the entire `/api` surface:

- The React SPA fires dozens of API calls per dashboard load / page navigation,
  so a single active user exhausts 100 requests within minutes.
- All office users behind the same NAT/public IP **shared one 100-request bucket**.
- `trust proxy` was never set, so behind the reverse proxy every request was
  keyed on the proxy's IP — effectively **all users everywhere shared one bucket**.

100/15min is a brute-force-protection number that was wrongly applied as a
global API limit. This was purely a middleware issue — no database involvement
(the limiter returns 429 before any route/Prisma code runs).

## 2. Fix — two-tier rate limiting

**`backend/src/app.js`:**

- **Auth limiter (new)** on `/api/auth`: 20 attempts per 15 min per IP, with
  `skipSuccessfulRequests: true` so **only failed logins count**. Trips with
  `429 — "Too many login attempts, please try again later."` This preserves the
  original brute-force-protection intent without punishing normal users.
- **Global limiter** on `/api`: raised from 100 to **2000 requests per 15 min
  per IP** (~2.2 req/s) — generous enough for a whole office behind one NAT IP,
  still caps runaway scripts. `/api/health` is now exempt.
- `app.set('trust proxy', 1)` when `TRUST_PROXY=true`, so limits key on the real
  client IP from `X-Forwarded-For` instead of the reverse proxy's IP.

**`backend/src/config/index.js`** — all values are env-configurable (defaults in
parentheses; no env change is needed for the fix, the defaults ARE the fix):

| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_MAX` | `2000` | Global requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | Global limiter window |
| `RATE_LIMIT_AUTH_MAX` | `20` | Failed login attempts per window per IP |
| `RATE_LIMIT_AUTH_WINDOW_MS` | `900000` (15 min) | Auth limiter window |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy (nginx/IIS/Azure) |

## 3. Environment / docs updates

- `backend/.env.staging` and `backend/.env.production`: set `TRUST_PROXY=true`
  (both are served behind a reverse proxy on their HTTPS domains) and documented
  the tuning vars as comments.
- `backend/.env.development`: commented docs only — no behavior change locally.
- `docs/reference/BACKEND.md`: rate-limiter section rewritten for the two-tier scheme.

## 4. Verification performed

- `RateLimit-Limit: 2000` / `RateLimit-Policy: 2000;w=900` headers confirmed on
  normal API endpoints; no rate-limit headers on `/api/health` (exempt).
- Failed logins (HTTP 400/401) confirmed to count against the auth limiter.
- End-to-end auth-limiter proof on a throwaway instance (port 5001,
  `RATE_LIMIT_AUTH_MAX=3`): attempts 1–3 → 400, attempt 4 →
  `429 {"status":"error","message":"Too many login attempts, please try again later."}`.

## 5. Deployment note

Staging and production need a **restart** to pick up the new code and
`TRUST_PROXY=true`. In-memory limiter state is per process — fine for the
current single-process deployment; if the backend is ever clustered, add a
Redis store (`rate-limit-redis`; Redis is already configured).

## 6. Known quirk (cosmetic)

When both limiters apply to an `/api/auth` request, the global limiter's
`RateLimit-*` headers overwrite the auth limiter's in the response. Enforcement
is unaffected — each limiter counts and blocks independently.
