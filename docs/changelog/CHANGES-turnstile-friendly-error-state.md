# Turnstile Widget — Friendly Error State

Date: 2026-07-27

Scope: hiding Cloudflare Turnstile's native "Verification failed / Troubleshoot" widget UI
(meaningless to an end user, links to Cloudflare's own docs) and replacing it with an
in-app message, on the login/auth pages that embed the shared Turnstile widget.

---

## 1. Root cause

Reported on the admin login page: when the Cloudflare Turnstile bot-check widget failed to
verify a visitor, it rendered its own "Verification failed" state with a "Troubleshoot" link
inside its cross-origin iframe (`challenges.cloudflare.com`). That link opens Cloudflare's own
help docs — not something an HR admin user can act on, and visually inconsistent with the rest
of the app. Same underlying theme as the backend fix earlier today (raw vendor/technical output
reaching the end user instead of an app-owned message), but a different mechanism: this is a
client-side widget rendering inside a cross-origin iframe, not a backend API response, so it
can't be restyled directly.

`TurnstileWidget.jsx` (`frontend/src/components/TurnstileWidget.jsx`) is shared by 3 pages:
`AdminLogin.jsx`, `Login.jsx`, `ForgotPassword.jsx` — the fix applies to all three.

## 2. Fix

`TurnstileWidget.jsx`: added a `hasError` state, set by Turnstile's existing `error-callback`
(previously only cleared the token). When `hasError` is true:
- The widget's container `div` (hosting Cloudflare's iframe) is hidden via CSS.
- An antd `Alert` (type `warning`) renders instead: "Verification check failed — This is
  usually temporary. Click retry to request a new check." with a **Retry** button.
- Retry calls Turnstile's own `reset()` API to request a fresh challenge and clears `hasError`,
  re-revealing the (now fresh) widget container.

Verified end-to-end using Cloudflare's documented test site keys (no real network trickery
needed): the "always blocks" key (`2x00000000000000000000AB`) reproduced the failure and
confirmed the fallback Alert renders with the raw Cloudflare error UI hidden, Retry re-triggers
a fresh (also-failing, as expected for that key) challenge, and no console errors. The "always
passes" key (`1x00000000000000000000AA`, already used in `.env.development`) confirmed the
normal success path (Cloudflare's own checkbox/"Success!" widget) is unaffected.

## 3. Out of scope

No change to the backend Turnstile verification logic, nor to `Login.jsx`/`ForgotPassword.jsx`
themselves — both inherit the fix automatically via the shared `TurnstileWidget` component.
