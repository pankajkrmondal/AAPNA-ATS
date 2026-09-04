-- ============================================================================
-- Phase 3 — the pipeline drawer's "full screening report" link, without a login
-- Manual DDL — apply then: cd backend && npm run prisma:pull && npm run prisma:generate
-- Idempotent, additive, non-destructive. No existing column or row is touched.
--
-- WHY: rpa_zeko_interview_results.reportlink holds Zeko's RECRUITER report page —
--
--     https://app.zeko.ai/app/new-report?candidateId=…&jobId=…&tab=Overview
--
-- which is behind Zeko's own login. That is what the drawer's "View full report
-- on Zeko" opens today, so an ATS user who has no Zeko account (most of them)
-- gets a sign-in wall instead of the report. The dossier already solves this by
-- minting Zeko's own public share link (utils/zekoShareLink.js, plan §9 Phase 3);
-- these columns let the drawer reuse it.
--
-- WHY A COLUMN RATHER THAN MINTING ON EVERY CLICK: the mint is a call into Zeko,
-- and when the stored dashboard cookie has expired it goes through the OTP login
-- — measured at 38 SECONDS on staging (2026-09-03). Inside a recruiter's click
-- that is unacceptable more than once, so the answer is cached here: the first
-- person to open a round's report pays for it, everyone after reads a column.
--
-- NULL IS EXPECTED AND SUPPORTED, and there is deliberately no backfill. Minting
-- for every row would create a permanent, PUBLIC url for every candidate ever
-- screened, including the ones nobody will ever open — and unlike our own
-- recording links (plan §6.5) these are Zeko's to expire, not ours. So the link
-- is created lazily, only for a round someone actually asks to read, exactly as
-- 2026-09-02-onedrive-item-ids.sql backfills drive-item ids on first use.
--
-- See docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §9 Phase 3.
-- ============================================================================

ALTER TABLE rpa_zeko_interview_results
  ADD COLUMN IF NOT EXISTS shared_report_link VARCHAR(512);

COMMENT ON COLUMN rpa_zeko_interview_results.shared_report_link IS
  'Zeko public share url (app/shared-report?linkId=…) for this round''s report, '
  'minted on first request and cached. Opens with NO login, so treat it as '
  'confidential. NULL until someone asks for it; never backfilled in bulk.';

ALTER TABLE rpa_zeko_interview_results
  ADD COLUMN IF NOT EXISTS shared_report_link_at TIMESTAMPTZ;

COMMENT ON COLUMN rpa_zeko_interview_results.shared_report_link_at IS
  'When shared_report_link was minted. Kept so a link that stops working can be '
  'aged rather than guessed at — Zeko owns its lifetime, we cannot revoke it.';
