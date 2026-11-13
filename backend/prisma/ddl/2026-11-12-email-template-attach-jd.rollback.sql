-- ============================================================================
-- ROLLBACK for 2026-11-12-email-template-attach-jd.sql (U02b "Attach the JD" switch).
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-11-12-email-template-attach-jd.rollback.sql
--
-- First deploy the previous backend build. This build still works without the
-- column (it reads it as NULL), but the previous build does not know
-- {{jd_link}} and would send it to candidates as raw text, so the token is
-- taken out of every body here.
--
-- Data lost: every template's "Attach the JD" choice, and where HR placed the
-- JD card. The "Evalground Assessment Invite" row is deleted only if no sent
-- email or stage mapping points at it (the previous build does not read it).
-- ============================================================================

UPDATE rpa_email_templates
SET body_html = regexp_replace(body_html, '<p[^>]*>(\s|&nbsp;|<br\s*/?>)*\{\{?\s*jd_link\s*\}\}?(\s|&nbsp;|<br\s*/?>)*</p>|\{\{?\s*jd_link\s*\}\}?', '', 'gi')
WHERE body_html ~* 'jd_link';

UPDATE rpa_email_templates t
SET placeholders = ARRAY(
  SELECT p.token FROM unnest(t.placeholders) AS p(token)
  WHERE regexp_replace(p.token, '[{}]', '', 'g') <> 'jd_link'
)
WHERE EXISTS (
  SELECT 1 FROM unnest(COALESCE(t.placeholders, '{}'::text[])) AS p(token)
  WHERE regexp_replace(p.token, '[{}]', '', 'g') = 'jd_link'
);

DELETE FROM rpa_email_templates t
WHERE t.name = 'Evalground Assessment Invite'
  AND NOT EXISTS (SELECT 1 FROM rpa_email_messages m WHERE m.template_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM rpa_stage_email_templates s WHERE s.template_id = t.id);

ALTER TABLE rpa_email_templates DROP COLUMN IF EXISTS attach_jd;
