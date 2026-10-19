# 01 · System overview

**For:** developers new to the AAPNA ATS. **Last checked against the code:** 20 Oct 2026 (branch `harish-project-staging-v27`).

The AAPNA ATS is the in-house applicant tracking system for AAPNA Infotech's recruitment team (RT). It takes a hiring request (MRF) from approval to the candidate's joining day: resumes come in, are parsed by AI and screened against the job, and shortlisted candidates move through a configurable interview pipeline to an offer.

Until June 2026 the same functions ran as **n8n workflows**. They were rebuilt as this full-stack app (Express + React) from 10 June 2026. Some names still come from the n8n era ("flow 1.1", "2.2 flow"); see [07-DEVELOPMENT-HISTORY-2026.md](07-DEVELOPMENT-HISTORY-2026.md).

---

## 1. The business flow, end to end

```
 Hiring manager            Approvers             Recruiters (RT)                     Candidate / Vendor
 ─────────────            ─────────             ───────────────                     ──────────────────
 MRF raised  ───────────▶ personal approval ──▶ MRF approved (open position)
 (public form /            links by email          │
  recruiter on behalf)     (who/when/IP logged)    ▼
                                             Resumes in:  HR Manual Upload ◀────────── Vendor portal upload
                                                          Outlook mailbox intake ◀──── CVs emailed in
                                                          │  AI parse → dedup → OneDrive → vector
                                                          ▼
                                             Candidate Screening (Keyword / JD) → Shortlist
                                                          │
                                                          ▼  one journey per candidate per MRF
                                             Candidate Pipeline (board of stages)
                                               Shortlist → Zeko HR → Assessment (Evalground)
                                               → Zeko Functional → Tech 1/2/3 → HR round → CEO
                                               → Client (if any) → Documents → Offer → Closure
                                                          │  every outcome: reason + audit + email
                                                          ▼
                                             Joined / Did not join / Withdrawn …  → MRF closes
                                             when all openings are filled
```

| Step | What happens | Where in the code |
|---|---|---|
| MRF raised | A hiring manager (public `/mrf-submit` link) or a recruiter fills the requisition: role, openings, skills, experience, budget, JD. The JD is parsed by AI into structured fields. | `mrf.controller.js`, `mrfApproval.service.js` |
| MRF approval | Each approver gets a personal, expiring link. Every decision records who, when, IP and device; the others are told. | `mrfApproval.service.js`, `utils/mrfApprovalRules.js`, tables `rpa_mrf_approval_tokens/_events` |
| Resume intake | Three doors: HR Manual Upload (PDF/DOCX/ZIP/Excel), the Vendor portal, and the Outlook mailbox poller. Each file is parsed by AI, checked for duplicates, archived to OneDrive and embedded for semantic search. | `hrUpload.service.js`, `vendor.controller.js`, `jobs/mailboxPoller.js`, `vectorStore.service.js` |
| Missing details | Candidates without key fields get a tokenised public form (`/api/candidates/public/missing-data`) and reminders. | `candidate.controller.js`, `jobs/reminderScheduler.js` |
| Screening | Keyword search and JD search (match against an MRF) with strict filters, ranking and AI summaries; shortlist or reject with a reason. | `screening.service.js`, `screeningV2.service.js` (behind `SCREENING_V2`), `utils/screeningFilters.js`, `utils/jdScreeningRules.js` |
| Pipeline | One journey per candidate per MRF through admin-configurable stages. Each Approve / Reject / Hold carries a reason, writes an event, emails the candidate (and vendor, status-only). | `pipeline.service.js`, `stageNotification.service.js`, `config/pipelineStages.js` |
| Zeko rounds | AI video interviews: assign, schedule, results synced every 5 minutes. | `zeko.service.js`, `jobs/zekoScheduler.js` |
| Assessment | Evalground tests: invite tracked with a deadline; results imported from CSV. | `assessmentImport.service.js`, `assessmentInvite.service.js` |
| Interviews | Teams/Outlook booking, reminders, "did it happen?" check, interviewer scorecard link, recording discovery and archive. | `interviewSchedule.service.js`, `graphCalendar.service.js`, `jobs/interviewOccurrence.js`, `jobs/interviewRecordings.js` |
| Documents | Candidate uploads through a no-login link; HR verifies or rejects each item; automatic chasing. | `documentCollection.service.js`, `jobs/documentReminder.js` |
| Offer & closure | Approval, offer shared, answer recorded; closure statuses; the MRF closes when all openings are filled. | `offer.service.js`, `mrfClosure.service.js`, `jobs/offerSweep.js` |
| Reporting | Dashboard, Recruitment Analytics (funnel, positions), CSV exports, the candidate dossier for external interviewers. | `dashboard.service.js`, `pipelineAnalytics.helpers.js`, `exports/`, `candidateDossier.service.js` |

---

## 2. Architecture

```
                 Browser (React 18 + Vite + antd 5)            public pages: MRF submit/approve,
                 ats.aapnainfotech.com                          missing details, scorecard, documents,
                        │  HTTPS /api (JWT)  + Socket.io        recording share (token links, no login)
                        ▼
   ┌───────────────────────────────────────────────────────────┐
   │ Express API  (backend/src/server.js → app.js)              │
   │  requestContext → helmet → CORS → morgan → rate limits     │
   │  → routes/*.routes.js → controllers → services             │
   │  node-cron jobs run in this same process (runJob)          │
   └──────┬───────────────┬──────────────────┬──────────────────┘
          │ Prisma         │ ioredis           │ fetch (tracedFetch)
          ▼                ▼                   ▼
   PostgreSQL         Redis (cache,       Microsoft Graph (mail, calendar, Teams,
   + pgvector         BullMQ queue,        OneDrive, recordings) · Zeko · Evalground (CSV)
   (rpa_* tables)     socket bridge)       · OpenRouter / Gemini (AI) · Cohere (rerank)
                           │                · Cloudflare Turnstile (login captcha)
                           ▼
                 Resume worker (src/workers/resumeWorker.js) — optional,
                 only when USE_RESUME_QUEUE=true; otherwise uploads parse in the API process
```

- **One API process per environment**, managed by PM2 (`backend/ecosystem.config.cjs`: `ats-<env>-backend` and `ats-<env>-worker`). The scheduled jobs live inside the API process, so there must be only one API process per database. Two processes would send every reminder twice.
- **Socket.io** pushes live updates (upload progress, pipeline changes, notifications) to the browser; `src/socket/`.
- **Logs** are Winston JSON files in `backend/logs/` (`combined.log`, `error.log`, 10 MB × 5 each), plus PM2's own out/error logs. Since N42, every line carries the request ref and personal data is masked; see [06-OPERATIONS-RUNBOOK.md](06-OPERATIONS-RUNBOOK.md).

## 3. Environments

| | Frontend | Backend `NODE_ENV` | Database (same host) | Mail |
|---|---|---|---|---|
| Local (developer PC) | Vite dev server, `/api` proxied to `localhost:5000` | `development` (`.env.development`) | `recruitmentautomationdb` (**the staging database**) | redirected to the test inboxes |
| Staging | built bundle on the staging server | `staging` (`/var/www/html/ats-platform-staging/backend`) | `recruitmentautomationdb` | redirected to the test inboxes |
| Production | `ats.aapnainfotech.com` | `production` (`/var/www/html/ats-platform-prod/backend`) | `recruitmentautomationdbProd` | real recipients |

Two things follow from this table:
- **A local backend works on staging data.** Its jobs run against the staging database alongside the staging server's own jobs. Run at most one local backend, and remember that a local test is a staging test.
- **Mail safety** is by redirect. Outside production every email goes to `EMAIL_STAGING_RECIPIENTS`, except internal alerts and account mail (`NEVER_REDIRECT`) and panel invites a recruiter typed in (`OPERATOR_ADDRESSED`), in `backend/src/config/emailRecipients.js`. See [05-CONFIGURATION.md](05-CONFIGURATION.md) §3.

## 4. Outside services

| Service | Used for | Auth | Where |
|---|---|---|---|
| Microsoft Graph | Sending mail (shared mailbox), reading the inbox (delta poll), calendar events + Teams meetings, attendance reports, recordings, OneDrive file storage | App registration, client credentials (`MS_CLIENT_ID/SECRET/TENANT_ID`) | `onedrive.service.js` (token), `emailNotification.service.js`, `outlookReader.service.js`, `graphCalendar/Attendance/Recording.service.js` |
| Zeko | AI video interviews (HR and Functional rounds) | API key token + dashboard cookie via OTP login (OTP mail read from the mailbox) | `zeko.service.js`, `jobs/zekoScheduler.js` |
| Evalground | Online tests | none (CSV export uploaded by HR; API is a paid add-on, not used) | `assessmentImport.service.js` |
| OpenRouter → Gemini | Resume and JD parsing, AI summaries (OpenRouter first, Gemini fallback) | API keys | `utils/geminiHelper.js`, `hrUpload.service.js` |
| Gemini embeddings | Vectors for semantic search (`rpa_cv_vectors`, pgvector) | API key | `vectorStore.service.js` |
| Cohere | Reranking screening results | API key | `vectorStore.service.js` |
| Cloudflare Turnstile | Bot check on login | secret key | `turnstile.service.js` |

Every outside call goes through `tracedFetch` / `logExternal` (`backend/src/utils/externalCall.js`), so it shows in the logs with its duration and status under the request's ref.

## 5. Where to go next

- What each module does and where its code is: [02-MODULES.md](02-MODULES.md)
- Tables: [03-DATA-MODEL.md](03-DATA-MODEL.md)
- Scheduled jobs and integrations: [04-JOBS-AND-INTEGRATIONS.md](04-JOBS-AND-INTEGRATIONS.md)
- Settings and flags: [05-CONFIGURATION.md](05-CONFIGURATION.md)
- Something is broken: [06-OPERATIONS-RUNBOOK.md](06-OPERATIONS-RUNBOOK.md)
- Set up a machine: [08-ONBOARDING.md](08-ONBOARDING.md)
