# Zeko bearer token without n8n: test plan, test cases, results

Plan: [PLAN.md](PLAN.md). Results are appended as runs happen; nothing is deleted.

## Test environment

| Item | Value |
|---|---|
| App (local) | Frontend `http://localhost:5173` (Vite), backend `http://localhost:5000` (`node src/server.js`) |
| Database | Staging `recruitmentautomationdb` (local dev points at it). Never production |
| Zeko credentials | Staging `ZEKO_CLIENT_ID` and `ZEKO_API_KEY`, injected into the backend process only (local `.env` files have none; see PLAN §4) |
| "n8n stopped" | Simulated by expiring the stored token (`expires_at` in the past) right before a case, so only the ATS can supply a new one |
| Test data | Journey **2899** / shortlist **3139** "Zeko Token Test" on fixture MRF 686 "FlexStage Test Role", stage `zeko_hr`, tag `FLEXSTAGE-TESTPASS-FIXTURE`. Remove with `node src/tests/helpers/flexStageFixture.js teardown` |
| Zeko job | A published HR job from the staging catalog (`rpa_zeko_jobs.status = 'published'`) |
| Mail/SMS safety | Non-prod: Zeko gets the internal test inbox instead of the candidate email and `ZEKO_TEST_PHONE` instead of the phone; ATS mail goes to the test inbox |
| Browser tool | Playwright MCP |
| Scripts | Live token checks: `zeko-token-live-check.mjs` (session scratchpad, not committed). It asserts `current_database() = recruitmentautomationdb` and never prints a token |

## A. Static and regression

| # | Case | Expected |
|---|---|---|
| A1 | `node --check` on `zeko.service.js`, `screening.service.js`, `zekoScheduler.js` | All parse |
| A2 | Unit suite `node --test "src/tests/unit/*.test.js"` | All pass, no regression |
| A3 | No code outside `zeko.service.js` reads `rpa_zeko_auth_token` | grep finds none |

## B. Token behaviour, live against staging and Zeko's `/auth/token`

| # | Case | Expected |
|---|---|---|
| B1 | Stored token valid for >10 min | Reused; nothing minted |
| B1b | Call again right after a mint | The new token is reused |
| B2 | Stored token expired (n8n stopped) | New token minted; exactly one row left, active, `created_by = 'api_key_job'`, ~60 min life |
| B3 | 5 concurrent callers after expiry | One mint; all 5 get the same token |
| B4 | `forceRefresh: true` with a valid token | New token minted |
| B5 | Zeko answers 401 once | Re-mint, retry once with the new token, retry's response returned |
| B5b | Zeko answers 500 to the stored token (how Zeko really refuses one, issue #1) | Re-mint, retry once |
| B5c | Zeko answers 500 to a token minted for this call | No retry; the 500 is returned |
| B6 | Zeko answers 401 twice | Stops after one retry, returns the 401 (no loop) |
| B6b | Zeko answers 400 | No retry |
| B7 | No API key and no valid token | `AppError` 503 "Could not sign in to the Zeko interview platform…"; Zeko never called |
| B8 | Hourly `zekoToken` job (`runJob`) after expiry | Mints; heartbeat `job_heartbeat.<env>.zekoToken` has a fresh `lastOkAt` |

## C. End to end in the browser (Playwright)

| # | Case | Steps | Expected |
|---|---|---|---|
| C1 | Schedule with the token expired (n8n stopped) | Expire token → Candidate Pipeline → "Zeko Token Test" → Zeko HR stage → Schedule Interview → pick a published HR job + time → Schedule | Toast "Zeko interview scheduled…"; Zeko row `status = 'sent'`; new token row `api_key_job`; backend log shows `auth/token` 201 then `…/schedule` 2xx |
| C2 | Cancel | Same drawer → Cancel interview → reason → confirm | Toast "Zeko interview cancelled…"; row `status = 'cancelled'`; Zeko cancel 2xx (no "warning status" log) |
| C3 | Schedule with a stored token Zeko refuses | Overwrite the stored token with an invalid value (expiry unchanged) → Schedule | Zeko refuses (500), the ATS mints a new token and retries once → toast "Zeko interview scheduled…"; row `sent` |
| C4 | Clean-up cancel, token reused | Cancel the C3 booking | No `auth/token` call; Zeko cancel 2xx; `status = 'cancelled'`; no live booking left at Zeko |
| C5 | Mail/SMS safety | Backend log and `rpa_email_log` for C1–C4 | Zeko got the test inbox and test phone; ATS emails went to the test inbox |
| C6 | Token cannot be minted | Restart backend **without** `ZEKO_API_KEY`, expire token, try to schedule | Error toast "Could not sign in to the Zeko interview platform…"; Zeko row unchanged (not `sent`) |

## Results log

### Run 1: 29 Oct 2026

| # | Result | Notes |
|---|---|---|
| A1 | PASS | All three files parse |
| A2 | PASS | 773/773 |
| A3 | PASS | Only `zeko.service.js` touches the table |
| B1 | PASS | Stored token had 60 min left; reused |
| B1b | PASS | |
| B2 | PASS | active=1, total=1, `api_key_job`, 60 min |
| B3 | PASS | 1 distinct token, 1 row inserted |
| B4 | PASS | |
| B5 | PASS | 2 calls; retry used the new token |
| B6 | PASS | |
| B6b | PASS | |
| B7 | PASS | 503 with the recruiter message; Zeko not called |
| B8 | PASS | `job_heartbeat.development.zekoToken` `lastOkAt` = 2026-10-29T12:02:27Z |
| C1 | PASS | Token expired → `auth/token` 201 → `/interview/:id/schedule` 200. Zeko row 82 `sent`; token row `api_key_job` |
| C2 | PASS | Cancel reused token 4306 (no `auth/token` call). Zeko cancel 200; row 82 `cancelled` |
| C3 | **FAIL** | Invalid stored token: Zeko answered **500**, not 401, so no retry. Recruiter got "Unable to schedule…" (502); nothing booked. See issue #1 |
| C4–C6 | not run | Waiting on the fix for issue #1 |

### Issues found and fixed

| # | Found in | Issue | Fix | Re-test |
|---|---|---|---|---|
| 1 | C3 | Zeko `/api/v1` answers a bad bearer token with **HTTP 500** `{"message":"Internal Server Error"}`, not 401. A read-only probe showed: valid token 200, JWT with bad signature 500, edited `exp` 500, plain string 500, missing header 401. The 401/403 retry would never fire for a revoked or expired token | `withZekoToken` retries on 401/403/**500**, but only for a **stored** token. A token minted for the same call is never retried, so a real Zeko 500 is not repeated | B5b, B5c, C3: PASS (run 2) |

### Run 2: 29 Oct 2026, after the fix for issue #1

| # | Result | Notes |
|---|---|---|
| A1 | PASS | |
| A2 | PASS | 773/773 |
| B1–B8 | PASS | 12/12, including the new B5b (calls=2) and B5c (calls=1, one mint) |
| C3 | PASS | Stored token overwritten (expiry kept): schedule 500 → log "Zeko answered 500 to the stored bearer token; minting a new one and retrying once." → `auth/token` 201 → schedule 200. Toast shown; row 82 `sent` |
| C4 | PASS | Cancel reused token 4316 (no `auth/token` call). Zeko cancel 200; row 82 `cancelled`. No test booking left live at Zeko |
| C5 | PASS | Every Zeko call logged "Non-prod guard … substituted" (test inbox) and the test phone; ATS emails went to the test recipients. None reached the fixture candidate address |
| C6 | PASS | Backend without `ZEKO_API_KEY`, token expired: toast "Could not sign in to the Zeko interview platform…" (503). No Zeko schedule call. Row 82 is `pending` (the drawer's assign step runs first, as before), not `sent` |

**After the run:** staging holds a fresh valid token (id 4317, `api_key_job`). Test journey 2899 stays in place (fixture-tagged). Remove it with the fixture teardown when the FlexStage fixture is no longer needed.
