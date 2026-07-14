---
name: verify
description: Build, launch, and drive the ATS frontend to verify changes at the browser surface.
---

# Verifying the ATS frontend

## Build & serve
```powershell
Set-Location AAPNA-ATS\frontend
npm run build          # vite build → dist/ (~12s)
npm run preview        # serves dist on http://localhost:4173 (run in background)
```
`npm run dev` (port 5173) proxies `/api` to the backend on :5000; `preview` inherits the same proxy config. The backend needs a database — without it, only unauthenticated surfaces work.

## Driving the app
No Playwright in the repo. Install it in a scratch dir and use the installed Edge (no browser download needed):
```powershell
npm install playwright   # then: chromium.launch({ channel: 'msedge', headless: true })
```

## Flows worth driving
- **Login page** (`/`) is public — good for theme/global-style checks without credentials.
- **Theme system**: mode is `localStorage['ats_theme']` = `light | dark | system` (default light). Anti-FOUC inline script in `index.html` sets `data-theme` on `<html>` pre-paint. Seed storage with `ctx.addInitScript`, emulate OS via `colorScheme` context option / `page.emulateMedia`.
- **MainLayout (header, theme toggle, sidebar) and Settings are auth-gated** — need the backend running plus credentials.

## Gotchas
- Run npm commands from `AAPNA-ATS\frontend` — running from the repo root picks up a stray SharePoint gulpfile in the user home dir.
- Bundle is one large chunk (~3 MB); the chunk-size warning is pre-existing.
