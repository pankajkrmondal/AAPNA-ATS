# Backend API & Worker Documentation

The backend of the AAPNA ATS is a modern, stateless REST API server and an event-driven background job worker. It is built using **Node.js**, **Express**, **Prisma ORM**, **BullMQ (Redis)**, and **Socket.io**.

---

## 🏗️ Backend System Architecture

```text
                  +----------------------------------------------+
                  |              HTTP CLIENT (React)             |
                  +----------------------------------------------+
                                |                  ^
                     API REST   |                  |  Real-time
                      Requests  |                  |  WSS updates
                                v                  |
                  +----------------------------------------------+
                  |         Express API Gateway Router           |
                  +----------------------------------------------+
                                |
                   Middleware   | (authenticate, restrictTo, checkModuleAccess)
                                v
                  +----------------------------------------------+
                  |                 Controllers                  |
                  +----------------------------------------------+
                                |
                    Business    |
                     Logic      v
                  +----------------------------------------------+
                  |                  Services                    |
                  +----------------------------------------------+
                    /           |          \                 \
        Prisma ORM /   BullMQ  /     HTTP   \   OneDrive Sync \
                  v           v              v                 v
            [PostgreSQL]   [Redis]      [Gemini AI]       [MS Graph API]
```

---

## 📂 Codebase Directory Layout

Below is the directory structure under `backend/src` with file-by-file explanations:

```text
backend/src/
├── app.js                   # Express application configuration, globals, and middleware setup
├── server.js                # App entry point; connects to DB/Redis, runs servers, handles graceful shutdown
├── config/                  # Core configurations
│   ├── database.js          # Prisma Client setup & query logging
│   ├── index.js             # Environment variable loader & validator
│   ├── logger.js            # Winston logging console & file transport streams
│   └── redis.js             # IORedis connection client and connection factory for BullMQ
├── controllers/             # Request route handlers
│   ├── admin.controller.js      # Recruiter approvals and permission toggling
│   ├── auth.controller.js       # Register, login, and session lifecycles
│   ├── candidate.controller.js  # Candidate profile listing, filters, and edits
│   ├── dashboard.controller.js  # Stat metrics aggregations for recruiters
│   ├── emailTemplate.controller.js # Template creation and listings
│   ├── hrUpload.controller.js   # Drag-and-drop manual upload and duplicate resolutions
│   ├── mrf.controller.js        # MRF form submission and approvals routing
│   ├── screening.controller.js  # SearchRole (vector/p8 scoring) and Zeko triggers
│   └── settings.controller.js   # Global key-value modifications
├── jobs/                    # node-cron recurring schedulers
│   ├── reminderScheduler.js # Daily check of rpa_email_log to send Outlook follow-ups
│   └── sessionCleanup.js    # Clean up expired tokens in rpa_sessions every 2 hours
├── middleware/              # Express request filters
│   ├── auth.js              # JWT, Session validation, and Module permission filters
│   ├── errorHandler.js      # Global central error parser
│   └── validate.js          # Request payload structure validator
├── queues/                  # BullMQ message queues definitions
│   └── resumeQueue.js       # Configures the 'resume-processing' queue and jobs adder
├── routes/                  # API endpoints mounting
│   ├── index.js             # Mounts sub-routers onto the '/api' prefix
│   └── [feature].routes.js  # Feature-specific sub-routes definitions
├── services/                # Primary core business logic
│   ├── auth.service.js      # Session writes and user Lookups
│   ├── candidate.service.js # SQL filters for rpa_cv records
│   ├── dashboard.service.js # Prisma query aggregations
│   ├── emailNotification.service.js # Welcomes, duplicates, and warning alerts
│   ├── hrUpload.service.js  # PDF/docx parsers and Google Gemini parses
│   ├── onedrive.service.js  # Client Credentials tokens and OneDrive file PUTs
│   ├── screening.service.js # Vector cosine distances and 8-Parameter scores
│   └── vectorStore.service.js # Gemini embedding generator and raw public inserts
├── socket/                  # Real-time WebSockets
│   └── index.js             # Initialises Socket.io and stores connections
├── utils/                   # Helpers
│   ├── AppError.js          # Custom extended operational Error class
│   └── catchAsync.js        # Wrapper to catch async promise errors
└── workers/                 # Queue workers
    └── resumeWorker.js      # Background resume parses worker (BullMQ instance)
```

---

## 🔒 Security & Request Middleware

Requests hitting the Express API pass through a pipeline of global and route-specific middleware.

### 1. Global Middleware (configured in `app.js`)
* **Helmet**: Configures HTTP security headers to protect against common web attacks.
* **CORS**: Configures cross-origin resource sharing, restricting access strictly to the client URL specified in `FRONTEND_URL` and allowing credentials (JWTs).
* **Compression**: Compresses outgoing JSON and file transfer payloads using gzip/deflate.
* **Rate Limiter**: Three-tier scheme. A strict limiter on `/api/auth` counts only *failed* attempts (default 20 per 15 minutes per IP, `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW_MS`) to block brute-force login attacks. A generous global limiter covers the rest of `/api` (default 2000 requests per 15 minutes per IP, `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`, `/api/health` excluded) purely as abuse protection. A dedicated limiter on `POST /api/auth/forgot-password` counts **all** requests (hard-coded 5 per 15 minutes per IP, defined in `routes/auth.routes.js`) — needed because that endpoint returns 200 on every call (anti-enumeration), so the failed-attempts-only auth limiter would never throttle it. When deployed behind a reverse proxy, set `TRUST_PROXY=true` so limits key on the real client IP from `X-Forwarded-For` instead of the proxy's IP.
  * The defaults live in code (`config/index.js`); the `RATE_LIMIT_*` lines in the `.env.*` files are intentionally commented out — they are optional overrides for tuning a single environment without a code change, not switches that enable the feature. Rate limiting is always on. Counters are in-memory and reset on restart. Every response carries `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers, which is the easiest way to verify the limiter is active.

### 2. Guard Middleware (defined in `middleware/auth.js`)
* **`authenticate`**: 
  1. Extracts the JWT from `Authorization: Bearer <token>` or queries.
  2. Decodes the token using the secret key (`JWT_SECRET`).
  3. Verifies that a matching session row still exists in `rpa_sessions` and has not expired.
  4. Fetches the user record from `rpa_users` and checks `is_active === true`.
  5. Attaches the user record to `req.user`, the token to `req.token`, and session to `req.session`.
* **`restrictTo(...allowedRoles)`**: 
  Restricts endpoint access. Checks `req.user.role` (e.g., `'admin'`, `'recruiter'`, `'vendor'`) against the list of authorized roles. If the role is missing, returns `403 Forbidden`.
* **`checkModuleAccess(moduleName)`**: 
  Restricts endpoint access based on modules. Queries `rpa_module_permissions` for the user ID and `module_key === moduleName`. Users with roles `admin` or `superadmin` bypass this check.

---

## 🏭 Background Workers & Queue Processors

Heavy tasks are offloaded to background workers to maintain API responsiveness.

### 1. BullMQ Worker (`workers/resumeWorker.js`)
* The worker connects to Redis using `createRedisConnection` and listens on the `'resume-processing'` queue.
* It is configured with a concurrency limit of `5` (runs up to 5 parsing operations in parallel) and a rate-limiter limit of `10` jobs per second.
* **Job processing flow**:
  1. The API uploads the file to `backend/uploads/` and adds a job payload (containing filepath, batchId, vendorEmail, and mrfId) via `addResumeJob()`.
  2. The worker extracts text using the appropriate parser (`pdf-parse` for PDFs, `mammoth` for DOCX).
  3. Extracted text is sent to Google Gemini via the `parseResumeWithGemini` service to create a structured JSON payload.
  4. The structured JSON is upserted into the `rpa_cv` table.
  5. The CV text is converted to a vector embedding via `saveCandidateVector` and saved to `rpa_cv_vectors`.
  6. Socket.io emits a refresh notification to the client.

### 2. node-cron Scheduled Jobs
* **Session Cleanup (`jobs/sessionCleanup.js`)**: Runs every 2 hours (`0 */2 * * *`). Queries `rpa_sessions` and deletes all rows where `expires_at < NOW()`.
* **Outbound Reminders (`jobs/reminderScheduler.js`)**: Runs daily at 9:00 AM (`0 9 * * *`) or according to the cron expression saved in `rpa_settings`. Looks up unresponded logs in `rpa_email_log` and sends reminder templates using MS Graph API.

---

## 🔗 Express REST API Routing Map

The API routing namespace is mounted under `/api`. All routes below require the user to be authenticated unless marked as **Public**.

| Mounted Path | Route File | Controller / Middleware | Operations |
| :--- | :--- | :--- | :--- |
| **`/api/auth`** | [auth.routes.js](file:///E:/ATS-Migration/backend/src/routes/auth.routes.js) | [auth.controller.js](file:///E:/ATS-Migration/backend/src/controllers/auth.controller.js) | **Public**: Register, login, check session, and logout. |
| **`/api/dashboard`**| [dashboard.routes.js](file:///E:/ATS-Migration/backend/src/routes/dashboard.routes.js)| [dashboard.controller.js](file:///E:/ATS-Migration/backend/src/controllers/dashboard.controller.js)| Fetch aggregated pipeline metrics and list recent file uploads. |
| **`/api/candidates`**| [candidate.routes.js](file:///E:/ATS-Migration/backend/src/routes/candidate.routes.js)| [candidate.controller.js](file:///E:/ATS-Migration/backend/src/controllers/candidate.controller.js)| Search CV lists, fetch details by candidate ID, and update profiles. |
| **`/api/hr-upload`** | [hrUpload.routes.js](file:///E:/ATS-Migration/backend/src/routes/hrUpload.routes.js) | [hrUpload.controller.js](file:///E:/ATS-Migration/backend/src/controllers/hrUpload.controller.js) | Upload files (multiform), check duplicates, merge duplicates, delete duplicates, and get batch summary. |
| **`/api/screening`** | [screening.routes.js](file:///E:/ATS-Migration/backend/src/routes/screening.routes.js) | [screening.controller.js](file:///E:/ATS-Migration/backend/src/controllers/screening.controller.js) | Search candidates by MRF (vector match), keyword search, shortlist, assign Zeko jobs, schedule/cancel Zeko interviews, and view Outlook emails. |
| **`/api/mrf`** | [mrf.routes.js](file:///E:/ATS-Migration/backend/src/routes/mrf.routes.js) | [mrf.controller.js](file:///E:/ATS-Migration/backend/src/controllers/mrf.controller.js) | Submit MRF requisitions, list MRF requirements, and update approval status. |
| **`/api/vendor`** | [vendor.routes.js](file:///E:/ATS-Migration/backend/src/routes/vendor.routes.js) | [vendor.controller.js](file:///E:/ATS-Migration/backend/src/controllers/vendor.controller.js) | **Public Uploads**: Submit candidate files under a vendor name/email scope, and list submissions. |
| **`/api/admin`** | [admin.routes.js](file:///E:/ATS-Migration/backend/src/routes/admin.routes.js) | [admin.controller.js](file:///E:/ATS-Migration/backend/src/controllers/admin.controller.js) | **Admin Only**: List users, toggle approval/is_active, and update module permissions. |
| **`/api/email`** | [emailTemplate.routes.js](file:///E:/ATS-Migration/backend/src/routes/emailTemplate.routes.js)| [emailTemplate.controller.js](file:///E:/ATS-Migration/backend/src/controllers/emailTemplate.controller.js)| Create, update, list, and delete email templates. |
| **`/api/settings`** | [settings.routes.js](file:///E:/ATS-Migration/backend/src/routes/settings.routes.js) | [settings.controller.js](file:///E:/ATS-Migration/backend/src/controllers/settings.controller.js) | Retrieve and save global system key-value configurations. |
