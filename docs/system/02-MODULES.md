# 02 · Module guide

**For:** developers looking for where something lives. **Checked against the code:** 20 Oct 2026.

Each section gives the module's purpose, its screens, key files, endpoints, tables, emails and jobs. Paths are relative to `backend/src/` or `frontend/src/`. Endpoints are under `/api`. "Public" means no login: the caller holds a token from an email.

**Access in one paragraph.** Roles are `superadmin` (all companies) > `admin` (one company) > `recruiter` / `vendor` (`config/roles.js`). On top of roles, per-user **module toggles** (`rpa_module_permissions`, the Admin portal's Module Access tab) gate the recruiter screens. Backend checks: `authenticate`, `restrictTo(...)`, `checkModuleAccess(key)`, `requireAdmin`, `requireStaff` in `middleware/auth.js`. Frontend checks: `ProtectedRoute`, `AdminRoute`, `ModuleRoute` in `App.jsx`. Vendors are confined to their own pages by `MainLayout.jsx` and to their own data by `utils/vendorScope.js`. Rules in full: `docs/reference/ROLE_RULES.md`, `docs/reference/ADMIN_ACCESS_CONTROL.md`.

---

## 1. Sign-in & accounts
- **Purpose:** login (email or username + password, Turnstile captcha), sessions, forgot / reset / change password.
- **Screens:** `/login`, `/admin/login`, `/forgot-password`, `/reset-password`.
- **Files:** `routes/auth.routes.js`, `controllers/auth.controller.js`, `services/auth.service.js`, `services/turnstile.service.js`, `middleware/auth.js`, `jobs/sessionCleanup.js`; frontend `context/AuthContext.jsx`, `services/api.js`.
- **Endpoints:** `POST /auth/login|logout|change-password|forgot-password|reset-password|refresh-token`, `GET /auth/me`.
- **Tables:** `rpa_users`, `rpa_sessions` (JWT must also match a live session row), `rpa_companies`.
- **Emails:** credentials, password changed, password reset (never redirected).

## 2. Admin portal (users, access, referrals, companies, logs)
- **Purpose:** user CRUD within a company (superadmin: across companies), module toggles, the referral audit log, companies (superadmin), and Logs & errors (superadmin, N42).
- **Screens:** `/admin/dashboard` (tabs). Separate shell in `layouts/MainLayout.jsx` (`isAdminPath`).
- **Files:** `routes/admin.routes.js`, `routes/company.routes.js`, `controllers/admin.controller.js`, `controllers/company.controller.js`, `controllers/systemLogs.controller.js`, `services/referral.service.js`, `services/errorLog.service.js`, `services/logScan.service.js`; frontend `pages/AdminDashboard.jsx`, `components/admin/ReferralLogPanel.jsx`, `components/admin/SystemLogsPanel.jsx`.
- **Endpoints:** `/admin/users/*`, `/admin/modules/*`, `/admin/referral-log(/export)`, `/admin/companies/*`, `/admin/errors`, `/admin/logs?ref=`, `/admin/jobs`, `/admin/health/deep`; `POST /errors` (browser error reports, any signed-in user).
- **Tables:** `rpa_users`, `rpa_module_permissions`, `rpa_companies`, `rpa_referral_audit`, `rpa_error_log`.
- **Reference:** `docs/reference/ADMIN_PORTAL.md`.

## 3. MRF (manpower requisition) & approval
- **Purpose:** raise a requisition, parse its JD, get it approved, track openings, close / reopen it.
- **Screens:** `/mrf` (list, details drawer, export), `/mrf-submit` (public form for the hiring manager), `/mrf/:id/approve` (public approval page), `/missing-jd-upload` (public).
- **Files:** `routes/mrf.routes.js`, `controllers/mrf.controller.js`, `services/mrfApproval.service.js`, `services/mrfClosure.service.js`, `utils/mrfApprovalRules.js`, `jobs/mrfAuditRetentionSweep.js`, `exports/mrf*.export.js`; frontend `pages/MRF.jsx`, `pages/MrfSubmit.jsx`, `pages/MrfApprovalAction.jsx`, `components/mrf/`.
- **Endpoints:** `POST /mrf/submit`, `GET /mrf/public-details/:id`, `POST /mrf/:id/approve` (public, per-approver token), `GET|POST|PATCH /mrf…`, `POST /mrf/:id/close|reopen`, `GET /mrf/:id/approval-trail`, `POST /mrf/:id/approval-links/reissue`, exports.
- **Tables:** `rpa_mrf` (72 columns; JD fields, budget, openings, closure), `rpa_mrf_approval_tokens`, `rpa_mrf_approval_events` (append-only, guarded by a trigger), `rpa_mrf_jd_send`.
- **Emails:** MRF approval request (one personal link per approver), outcome to the raiser and HR, reminders.
- **Flags:** `MRF_APPROVAL_AUDIT_ENABLED`, `MRF_APPROVAL_TOKEN_DAYS`. Approver roster: `rpa_settings` `mrf_approvers`.
- **Reference:** `docs/phase3/New MRF Request - Approval Request/`.

## 4. Resume intake: HR Manual Upload, Vendor portal, mailbox
- **Purpose:** get resumes in, parse them with AI, deduplicate, archive the file, embed for search.
- **Screens:** `/hr-upload` (recruiters), `/vendor` (vendors and staff), `/vendor-dashboard`.
- **Files:** `routes/hrUpload.routes.js`, `routes/vendor.routes.js`, `controllers/hrUpload.controller.js`, `controllers/vendor.controller.js`, `services/hrUpload.service.js` (parse → dedup → save; `runBatchParsing`), `services/uploadJob.service.js`, `services/onedrive.service.js`, `services/vectorStore.service.js`, `utils/fileExtractor.js`, `utils/fileSignature.js` (content check), `utils/candidateParser.js`, `utils/experienceParser.js`, `utils/vendorLock.js` (90-day ownership), `jobs/mailboxPoller.js` → `jobs/emailResumeIntake.js` logic, `queues/resumeQueue.js` + `workers/resumeWorker.js` (only with `USE_RESUME_QUEUE=true`).
- **Endpoints:** `POST /hr-upload/upload`, `GET /hr-upload/jobs(/export)`, `POST /hr-upload/jobs/:id/reprocess`, `POST /hr-upload/duplicates/search|merge|delete`; vendor equivalents under `/vendor/*`.
- **Tables:** `rpa_cv` (the candidate master, 77 columns), `rpa_cv_tmp` (duplicates awaiting review), `rpa_cv_vectors` (pgvector embeddings), `rpa_upload_jobs`, `rpa_upload_batch_summary`, `rpa_upload_log`, `rpa_processing_log`.
- **Emails:** welcome, missing-details request, duplicate alerts (HR, same vendor, different vendor), missing-email alert, "Resume Processing Failed" alert (internal).
- **Reference:** `docs/reference/HR_MANUAL_UPLOAD.md`, `docs/reference/VENDOR_PROCESS.md`, `docs/reference/RESUME_UPLOAD_ENHANCEMENTS.md`.

## 5. Candidates (Search Candidate) & missing details
- **Purpose:** search and edit candidate records; the public missing-details form; referral flag.
- **Screens:** `/candidates`, `/candidates/:id`; public form reached from the missing-details email.
- **Files:** `routes/candidate.routes.js`, `controllers/candidate.controller.js`, `services/candidate.service.js`, `services/candidateSync.service.js` (keeps the pipeline's copy of name/email in step, N29), `services/candidateFormOptions.service.js`, `utils/missingDetails.js`, `utils/candidateFieldRules.js`, `jobs/reminderScheduler.js`; frontend `pages/Candidates.jsx`, `pages/CandidateDetail.jsx`, `components/candidates/`.
- **Endpoints:** `GET /candidates(/export|/:id)`, `PATCH /candidates/:id`, `GET /candidates/:id/emails|pipeline-scores`, referral `GET|PATCH|DELETE /candidates/:id/referral`; public `/candidates/public/roles|locations|recruiters|missing-data`.
- **Tables:** `rpa_cv`, `rpa_email_log` (reminders), `rpa_referral_audit`.
- **Reference:** `docs/reference/candidate-data-copies.md`, `docs/reference/MANUAL_CANDIDATE_CV_DELETION.md`.

## 6. Candidate Screening (Keyword & JD)
- **Purpose:** find candidates by keywords and filters, or match them against an MRF's JD; rank; AI summary; shortlist or reject with a reason.
- **Screens:** `/filtering` (two tabs).
- **Files:** `routes/screening.routes.js`, `controllers/screening.controller.js`, `services/screening.service.js` (old path), `services/screeningV2.service.js` (strict filtering, **only when `SCREENING_V2=true`**), `utils/screeningFilters.js`, `utils/jdScreeningRules.js`, `utils/screeningCacheKeys.js` (Redis cache), `utils/rejectionCooldown.js`, `utils/educationCategories.js`; frontend `pages/CandidateScreening.jsx`, `components/screening/`.
- **Endpoints:** `GET /screening/roles`, `POST /screening/roles/:id/search|export`, `GET /screening/roles/:id/jd`, `POST /screening/keyword-search|keyword-export|shortlist|reject`; Zeko actions under `/screening/analytics/*`; inbox under `/screening/outlook/*`.
- **Tables:** `rpa_cv`, `rpa_cv_vectors`, `rpa_mrf`, `rpa_shortlisted_candidates`.
- **Reference:** `docs/Screening-Rules-for-RT.md` (the current rules, for RT). `docs/reference/screening.md` describes the pre-October caps and is superseded by the rules document and `utils/screeningFilters.js`.

## 7. Candidate Pipeline (stage engine)
- **Purpose:** one journey per candidate per MRF through configurable stages; outcomes with reasons; audit; outcome emails (candidate and vendor); move history; analytics.
- **Screens:** `/pipeline` (board + drawer); admin config inside Settings (`components/pipeline/PipelineConfigPanel.jsx`).
- **Files:** `routes/pipeline.routes.js` (57 endpoints), `controllers/pipeline.controller.js`, `services/pipeline.service.js`, `services/stageNotification.service.js`, `services/stageState.service.js` + `utils/stageState.js` (flexible moves), `utils/stageSkip.js`, `utils/stageScore.js`, `utils/roundScores.js`, `config/pipelineStages.js` (stage keys), `services/vendorNotification.service.js`; frontend `pages/Pipeline.jsx`, `components/pipeline/PipelineDrawer.jsx`, `MoveStageModal.jsx`, `BoardLegend.jsx`, `constants/pipelineLabels.js`.
- **Stages (keys):** `shortlist`, `zeko_hr`, `assessment`, `zeko_fn`, `tech1`, `tech2`, `tech3`, `hr_round`, `ceo`, `client`, `documents`, `offer`. The rows (labels, order, optional flag, outcomes, reasons, email templates) live in `rpa_pipeline_stages`, `rpa_stage_outcomes`, `rpa_outcome_reasons`, `rpa_stage_email_templates`.
- **Tables:** `rpa_candidate_pipeline` (the journey), `rpa_pipeline_stage_events` (audit; event types entered / skip / outcome / note / moved), `rpa_pipeline_stage_state` (per-stage status), `rpa_shortlisted_candidates` (legacy status mirror; mind its CHECK constraint, see 03 §4).
- **Flags:** `FLEXIBLE_STAGES_ENABLED` (move to any stage not yet passed; drag and drop).
- **Reference:** `docs/phase3/pipeline/`, `docs/HR-CANDIDATE-PIPELINE-FAQ-AND-GAP-PLAN-2026-08-26.md`.

## 8. Zeko AI interviews
- **Purpose:** the HR and Functional screening rounds: assign a Zeko job, schedule or cancel, sync results and scores, link the report.
- **Files:** `services/zeko.service.js`, `jobs/zekoScheduler.js`, `utils/zekoJobType.js`, `utils/zekoReportModel.js`, `utils/zekoShareLink.js`.
- **Endpoints:** `/screening/analytics/jobs|assign|schedule|cancel|status`.
- **Tables:** `rpa_zeko_jobs`, `rpa_zeko_candidate_pipeline`, `rpa_zeko_interview_results`, `rpa_zeko_auth_token`, `rpa_zeko_auth_cookie`, `rpa_zeko_sync_log`.
- **Emails:** Zeko interview scheduled / cancelled.
- **Reference:** `docs/phase3/ZEKO-GAP-ANALYSIS.md`, `docs/PLAN-2026-08-25-zeko-report-api-score-sync.md`, the three `docs/RCA-2026-08-25-*` files.

## 9. Assessment (Evalground)
- **Purpose:** send / track a test with a deadline; import results from the Evalground CSV; optional auto-approve on the pass mark.
- **Files:** `routes/assessmentImport.routes.js` (mounted at `/pipeline/assessment-import` by `routes/pipeline.routes.js`: `preview`, `commit`, `history`, `invite`…), `controllers/assessmentImport.controller.js`, `services/assessmentImport.service.js`, `services/assessmentInvite.service.js`, `services/assessmentSettings.service.js`, `utils/evalgroundRow.js`, `utils/assessmentInviteState.js`, `jobs/assessmentDeadlineChecker.js`; frontend `components/pipeline/AssessmentImportModal.jsx`, `AssessmentInviteModal.jsx`.
- **Tables:** `rpa_assessment_invites`, `rpa_assessment_imports`, `rpa_assessment_results`, `rpa_assessment_test_mappings`.
- **Reference:** `docs/phase3/07-EVALGROUND-IMPORT-PLAN.md`, `docs/phase3/ASSESSMENT-REPORT-UPLOAD-PLAN.md`.

## 10. Interviews, scorecards & recordings
- **Purpose:** book Tech 1/2/3, HR, CEO and Client rounds (Outlook event + Teams link), reminders, "did it happen?" (Teams attendance or a confirm nudge), interviewer scorecard by link, recording discovery, archive and share links.
- **Screens:** pipeline drawer; public `/scorecard/:token`; public recording share page.
- **Files:** `services/interviewSchedule.service.js`, `services/graphCalendar.service.js`, `services/graphAttendance.service.js` (+ `.helpers.js`), `services/interviewScorecard.service.js`, `services/interviewRecording.service.js`, `services/graphRecording.service.js`, `services/recordingShare.service.js`, `services/interviewOptionalAttendees.service.js`, `services/clientRound.service.js`, `routes/scorecard.routes.js`, `routes/recordingShare.routes.js`, `jobs/interviewReminder.js`, `jobs/interviewOccurrence.js`, `jobs/interviewRecordings.js`; frontend `pages/InterviewScorecard.jsx`.
- **Endpoints:** `POST /pipeline/:id/interview(/reschedule)`, `POST /pipeline/interview/:scheduleId/cancel|occurrence|send-scorecard`, `GET /pipeline/:id/recordings…`, share links; public `/scorecard/:token…`, `/recording-share/:token(/stream)`.
- **Tables:** `rpa_interview_schedule`, `rpa_interview_scorecard`, `rpa_interview_scorecard_skill`, `rpa_interview_recording`, `rpa_recording_share_link`.
- **Flags:** `MS_CALENDAR_ENABLED`, `MS_ATTENDANCE_ENABLED`, `MS_MEETING_RECORD_AUTO`, `MS_RECORDING_FETCH_ENABLED`, `MS_RECORDING_ARCHIVE_ENABLED`, `MS_RECORDING_RETAIN_MONTHS`; Settings → interview reminder / occurrence / recording.
- **Reference:** `docs/phase3/INTERVIEWER-SCORECARD-PLAN.md`, `docs/phase3/INTERVIEW-RECORDINGS-PLAN.md`, `docs/deployment/MS-GRAPH-PRODUCTION-SETUP.md`.

## 11. Documents
- **Purpose:** request documents, candidate uploads via a no-login link, HR verifies / rejects each item (a rejection re-requests that one), automatic reminders.
- **Screens:** pipeline drawer; public `/documents/:token`.
- **Files:** `services/documentCollection.service.js`, `routes/document.routes.js`, `controllers/document.controller.js`, `jobs/documentReminder.js`; frontend `pages/DocumentUpload.jsx`.
- **Tables:** `rpa_document_requests`, `rpa_candidate_documents`, `rpa_document_checklist_items`.
- **Emails:** document request, document reminder (never to vendors).

## 12. Offer & closure
- **Purpose:** offer approval, offer shared, candidate's answer; closure statuses (Joined, Did not join, Withdrawn…); an accepted offer closes the MRF once all openings are filled, and a reversed acceptance reopens it; 90-day auto-close after joining.
- **Files:** `services/offer.service.js`, `services/mrfClosure.service.js`, `jobs/offerSweep.js`.
- **Tables:** `rpa_offers`, `rpa_candidate_pipeline` (closure columns), `rpa_mrf`.
- **Reference:** `docs/changelog/CHANGES-2026-08-26-candidate-closure-graceful-exit.md`, `CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md`.

## 13. Dashboard & Recruitment Analytics
- **Purpose:** the landing dashboard (counts, trends, upcoming interviews, recent uploads) and Analytics (funnel, per-MRF Positions tab, move history, exports).
- **Screens:** `/dashboard`, `/analytics`.
- **Files:** `routes/dashboard.routes.js`, `services/dashboard.service.js`, `utils/dashboardMetrics.js`, `services/pipelineAnalytics.helpers.js`, `exports/pipelineAnalytics.export.js`, `exports/positions.export.js`; frontend `pages/Dashboard.jsx`, `pages/Analytics.jsx`, `components/dashboard/`, `components/analytics/`.
- **Reference:** `docs/Recruitment-Analytics.md`, `docs/Recruitment-Analytics-User-Guide.md`, `scripts/check-dashboard-vs-analytics.mjs` (cross-check).

## 14. Email engine, templates & inbox
- **Purpose:** every outgoing mail (Graph shared mailbox), branded layout, DB-managed templates, open tracking, reply threading, inbound conversation sync, reminders, monitoring.
- **Screens:** `/email` (templates, monitoring); conversations in the pipeline drawer and Candidate Detail.
- **Files:** `services/emailNotification.service.js` (`sendGraphEmail` and every flow), `services/emailLayout.service.js`, `config/emailRecipients.js` (routing and redirect), `services/outlookReader.service.js`, `jobs/mailboxPoller.js`, `jobs/inboundEmailSync.js` (logic; scheduled by the poller), `routes/emailTemplate.routes.js`, `routes/tracking.routes.js` (open pixel), `services/jdAttachment.service.js`, `services/companyProfile.service.js`; frontend `pages/EmailManagement.jsx`, `components/email/`.
- **Tables:** `rpa_email_templates`, `rpa_email_log`, `rpa_email_messages`, `rpa_email_tracking`, `rpa_email_notifications`, `rpa_outlook_accounts`.
- **Reference:** `docs/reference/Email-Templates-Summary.md` describes the n8n-era emails and is kept for history; the live list is the `/email` screen and `prisma/seed-email-templates.js`.

## 15. Settings
- **Purpose:** reminder cadence, interview reminder / occurrence / recording settings, optional attendees, assessment automation, email flow recipients, company profile text, pipeline configuration.
- **Screens:** `/settings` (admin parts checked in the page).
- **Files:** `routes/settings.routes.js`, `controllers/settings.controller.js`; frontend `pages/Settings.jsx`, `components/settings/`.
- **Storage:** `rpa_settings` (key/value); see [05-CONFIGURATION.md](05-CONFIGURATION.md) §2.

## 16. Notifications & live updates
- **Purpose:** the header bell (in-app notifications) and Socket.io pushes.
- **Files:** `services/notification.service.js`, `routes/notification.routes.js`, `socket/index.js`, `socket/bridge.js` (Redis pub/sub so the worker can emit); frontend `components/common/NotificationBell.jsx`, `hooks/useLiveActivity.js`.
- **Tables:** `rpa_notifications`.

## 17. Candidate dossier (complete download)
- **Purpose:** one pack per candidate for an external interviewer (resume, Zeko/Evalground reports, scorecards, recording share links), redacted (no CTC, vendor or referral data).
- **Files:** `services/candidateDossier.service.js`, `utils/dossierModel.js`, `utils/dossierRedaction.js`, `exports/candidateDossier.export.js`, `scripts/dossier-leak-scan.mjs`; frontend `components/pipeline/DossierDownloadModal.jsx`.
- **Flags:** `DOSSIER_*` (see 05).
- **Reference:** `docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md`.

## 18. Developer logging & error tracing (N42)
- **Purpose:** a ref on every request and job run, masked logs, outside-call logging, the error store, job heartbeats and alerts, browser error capture, the Logs & errors page.
- **Files:** `middleware/requestContext.js`, `config/logger.js`, `utils/logMask.js`, `utils/externalCall.js`, `utils/jobRunner.js`, `utils/alertThrottle.js`, `services/errorLog.service.js`, `services/logScan.service.js`, `jobs/errorLogRetentionSweep.js`, `controllers/systemLogs.controller.js`; frontend `services/errorReporter.js`, `components/admin/SystemLogsPanel.jsx`.
- **How to use it:** [06-OPERATIONS-RUNBOOK.md](06-OPERATIONS-RUNBOOK.md) §1.
