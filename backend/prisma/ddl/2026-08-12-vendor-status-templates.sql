-- ----------------------------------------------------------------------------
-- Phase 3 Module 6 — Placement Vendor Completion & Hardening
-- 2026-08-12
--
-- Idempotent, additive, non-destructive. Creates no tables: everything M6 needs
-- already exists (rpa_candidate_pipeline.source / .vendor_email,
-- rpa_cv.VendorEmail / .lockForNinetyDays). The only blocker is a CHECK
-- constraint that would reject the new vendor-facing template category.
--
-- Run BEFORE `npm run seed:templates:<env>`, then `npx prisma db pull` +
-- `npx prisma generate` (no schema change here, but keep the habit).
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1) Pre-flight: extend rpa_email_templates.category for 'vendor_status'
--    Same constraint the stage-engine DDL rewrote on 2026-07-21; this re-states
--    the full allowed set with 'vendor_status' appended, so running the two in
--    either order converges on the same list.
-- ----------------------------------------------------------------------------
ALTER TABLE rpa_email_templates DROP CONSTRAINT IF EXISTS rpa_email_templates_category_check;
ALTER TABLE rpa_email_templates ADD CONSTRAINT rpa_email_templates_category_check
  CHECK (category = ANY (ARRAY[
    'general'::text, 'shortlist'::text, 'interview'::text, 'offer'::text,
    'rejection'::text, 'follow_up'::text, 'onboarding'::text,
    'stage_outcome'::text, 'vendor_status'::text
  ]));

-- ----------------------------------------------------------------------------
-- 2) Vendor-ownership lookup index
--    createPipelineJourney() now reads (VendorEmail, lockForNinetyDays) for
--    every candidate it shortlists, and the Vendor Dashboard scopes its whole
--    join on VendorEmail. Both are point lookups on a table that grows without
--    bound.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rpa_cv_vendor_lock
  ON rpa_cv ("VendorEmail", "lockForNinetyDays")
  WHERE "VendorEmail" IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) Journey-by-candidate index for the Vendor Dashboard's stage column
--    vendorPipelineByCvId() looks journeys up by cv_id, newest first.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_candidate_pipeline_cv_modified
  ON rpa_candidate_pipeline (cv_id, modified_at DESC);

-- ----------------------------------------------------------------------------
-- 4) rpa_upload_jobs.advisory — recruiter-facing context on a row that did NOT
--    fail. Currently the cooling-off notice: "this candidate was rejected in
--    March and is still inside the 6-month re-application window."
--
--    Separate from error_message on purpose. error_message means the upload
--    went wrong; advisory means it went fine and there is something the person
--    making the Merge/Cancel call should know first. Overloading error_message
--    would have made a healthy duplicate render as a failure everywhere the
--    two dashboards colour by it.
-- ----------------------------------------------------------------------------
ALTER TABLE rpa_upload_jobs ADD COLUMN IF NOT EXISTS advisory TEXT;

-- ----------------------------------------------------------------------------
-- 5) Seed the two vendor flow-key recipient rows so the admin Flow Keys screen
--    lists them from the start. Both are dynamic (resolved to the owning vendor
--    at send time), so the empty static `to` is correct, not a gap.
-- ----------------------------------------------------------------------------
INSERT INTO rpa_settings (key, value)
VALUES ('email_recipients.vendorStatus.to', ''),
       ('email_recipients.vendorStatus.cc', '')
ON CONFLICT (key) DO NOTHING;
