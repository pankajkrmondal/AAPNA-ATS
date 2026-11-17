-- ============================================================================
-- ROLLBACK for 2026-11-10-zeko-link-token.sql (U08 Zeko phone page + reminder).
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-11-10-zeko-link-token.rollback.sql
--
-- First deploy the previous backend build: this build reads link_token to build
-- every Zeko email link and the public /api/z route, and the reminder job reads
-- and writes reminded_at.
--
-- Data lost: the per-booking link tokens (links already emailed stop working;
-- they answer "link unavailable"), which bookings were reminded, and when a
-- candidate added a phone on the Zeko page. The phone numbers themselves are on
-- rpa_cv and are kept.
-- ============================================================================

DROP INDEX IF EXISTS rpa_zeko_candidate_pipeline_link_token_key;

ALTER TABLE rpa_zeko_candidate_pipeline DROP COLUMN IF EXISTS link_token;
ALTER TABLE rpa_zeko_candidate_pipeline DROP COLUMN IF EXISTS reminded_at;
ALTER TABLE rpa_zeko_candidate_pipeline DROP COLUMN IF EXISTS phone_captured_at;
