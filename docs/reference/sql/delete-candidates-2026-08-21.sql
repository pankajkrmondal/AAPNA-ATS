BEGIN;

-- Single source of truth for this batch — add/remove emails only here.
CREATE TEMP TABLE _target_emails ON COMMIT DROP AS
SELECT unnest(ARRAY[
  'claudepankajmondal@gmail.com',
  'ragaiuserpankajmondal@gmail.com',
  'hmopuri@aapnainfotech.com'
]) AS email;

CREATE TEMP TABLE _targets ON COMMIT DROP AS
SELECT cv.id FROM rpa_cv cv
WHERE EXISTS (SELECT 1 FROM _target_emails te WHERE cv."EmailID" ILIKE '%' || te.email || '%');

CREATE TEMP TABLE _tmp_targets ON COMMIT DROP AS
SELECT t.id FROM rpa_cv_tmp t
WHERE EXISTS (SELECT 1 FROM _target_emails te WHERE t."EmailID" ILIKE '%' || te.email || '%');

-- candidate_email / candidate_email_all can also be comma-joined, so match by
-- cv_id link OR by email text — either one is enough to catch it.
CREATE TEMP TABLE _shortlist_targets ON COMMIT DROP AS
SELECT sc.id FROM rpa_shortlisted_candidates sc
WHERE sc.cv_id IN (SELECT id FROM _targets)
   OR EXISTS (
     SELECT 1 FROM _target_emails te
     WHERE sc.candidate_email ILIKE '%' || te.email || '%'
        OR sc.candidate_email_all ILIKE '%' || te.email || '%'
   );

-- 1. Journeys first. shortlist_id is SET NULL (not cascade), so a journey
--    deleted after its shortlist row would go orphaned instead of removed.
DELETE FROM rpa_candidate_pipeline WHERE cv_id IN (SELECT id FROM _targets);

-- 2. Zeko interview results — NO FK to anything in the schema, so nothing
--    else here ever cascades into it. This is the table that was leaking
--    stale "Awaiting Results" data into re-uploaded candidates.
DELETE FROM rpa_zeko_interview_results zr
WHERE EXISTS (SELECT 1 FROM _target_emails te WHERE zr.candidate_email ILIKE '%' || te.email || '%');

-- 3. Zeko pipeline rows — explicit rather than relying only on the cascade in
--    step 4, so a row is still caught even if candidate_id is stale but its
--    own candidate_email matches.
DELETE FROM rpa_zeko_candidate_pipeline zp
WHERE zp.candidate_id IN (SELECT id FROM _shortlist_targets)
   OR EXISTS (SELECT 1 FROM _target_emails te WHERE zp.candidate_email ILIKE '%' || te.email || '%');

-- 4. Shortlists. cv_id -> rpa_cv is CASCADE anyway, but explicit here (before
--    rpa_cv) keeps it auditable and reaches the email-matched orphans too.
DELETE FROM rpa_shortlisted_candidates WHERE id IN (SELECT id FROM _shortlist_targets);

DELETE FROM rpa_cv_vectors          WHERE candidate_id IN (SELECT id FROM _targets);
DELETE FROM rpa_assessment_results  WHERE cv_id        IN (SELECT id FROM _targets);
DELETE FROM rpa_upload_jobs         WHERE cv_id IN (SELECT id FROM _targets)
                                        OR cv_tmp_id IN (SELECT id FROM _tmp_targets);
DELETE FROM rpa_cv                  WHERE id IN (SELECT id FROM _targets);
DELETE FROM rpa_cv_tmp              WHERE id IN (SELECT id FROM _tmp_targets);

COMMIT;


-- //////////

SELECT 'rpa_cv' AS what, count(*) FROM rpa_cv
WHERE "EmailID" ILIKE '%claudepankajmondal@gmail.com%' OR "EmailID" ILIKE '%ragaiuserpankajmondal@gmail.com%' OR "EmailID" ILIKE '%hmopuri@aapnainfotech.com%'
UNION ALL
SELECT 'rpa_cv_tmp', count(*) FROM rpa_cv_tmp
WHERE "EmailID" ILIKE '%claudepankajmondal@gmail.com%' OR "EmailID" ILIKE '%ragaiuserpankajmondal@gmail.com%' OR "EmailID" ILIKE '%hmopuri@aapnainfotech.com%'
UNION ALL
SELECT 'rpa_shortlisted_candidates', count(*) FROM rpa_shortlisted_candidates
WHERE candidate_email ILIKE '%claudepankajmondal@gmail.com%' OR candidate_email_all ILIKE '%claudepankajmondal@gmail.com%'
   OR candidate_email ILIKE '%ragaiuserpankajmondal@gmail.com%' OR candidate_email_all ILIKE '%ragaiuserpankajmondal@gmail.com%'
   OR candidate_email ILIKE '%hmopuri@aapnainfotech.com%' OR candidate_email_all ILIKE '%hmopuri@aapnainfotech.com%'
UNION ALL
SELECT 'rpa_zeko_candidate_pipeline', count(*) FROM rpa_zeko_candidate_pipeline
WHERE candidate_email ILIKE '%claudepankajmondal@gmail.com%' OR candidate_email ILIKE '%ragaiuserpankajmondal@gmail.com%' OR candidate_email ILIKE '%hmopuri@aapnainfotech.com%'
UNION ALL
SELECT 'rpa_zeko_interview_results', count(*) FROM rpa_zeko_interview_results
WHERE candidate_email ILIKE '%claudepankajmondal@gmail.com%' OR candidate_email ILIKE '%ragaiuserpankajmondal@gmail.com%' OR candidate_email ILIKE '%hmopuri@aapnainfotech.com%';


-- // 


SELECT id, "Name", "EmailID", "cvFileUrl"
FROM rpa_cv
WHERE "EmailID" IN (
  'claudepankajmondal@gmail.com',
  'ragaiuserpankajmondal@gmail.com',
  'hmopuri@aapnainfotech.com'

)
OR "Name" ILIKE ANY (ARRAY[
  '%Nihar Ranjan%', '%Nihar%', '%Pralay%', '%pralay%'
])
ORDER BY "Name";


-- ///===================================================
-- ///===================================================
-- ///===================================================
-- ///===================================================



BEGIN;

CREATE TEMP TABLE _targets ON COMMIT DROP AS
SELECT id 
FROM rpa_cv 
WHERE "EmailID" IN (
  'avalakrishna08@gmail.com',
  'nihar.nayak.qatech@gmail.com',
  'prashant.sagar995@gmail.com',
  'Sahalms9061@gmail.com',
  'sahalms9061@gmail.com',
  'shahansha.kummetha@gmail.com',
  'PYAPILYS@gmail.com',
  'gn.varshitha@gmail.com'
);

DELETE FROM rpa_candidate_pipeline
WHERE cv_id IN (SELECT id FROM _targets);

DELETE FROM rpa_cv_vectors
WHERE candidate_id IN (SELECT id FROM _targets);

DELETE FROM rpa_assessment_results
WHERE cv_id IN (SELECT id FROM _targets);

DELETE FROM rpa_upload_jobs
WHERE cv_id IN (SELECT id FROM _targets);

DELETE FROM rpa_cv
WHERE id IN (SELECT id FROM _targets);

DELETE FROM rpa_cv_tmp
WHERE "EmailID" IN (
  'avalakrishna08@gmail.com',
  'nihar.nayak.qatech@gmail.com',
  'prashant.sagar995@gmail.com',
  'Sahalms9061@gmail.com',
  'shahansha.kummetha@gmail.com',
  'PYAPILYS@gmail.com',
  'gn.varshitha@gmail.com'
);

COMMIT;


-- =================
SELECT 'rpa_cv' AS what, count(*) 
FROM rpa_cv
WHERE "EmailID" IN (
  'avalakrishna08@gmail.com',
  'nihar.nayak.qatech@gmail.com',
  'prashant.sagar995@gmail.com',
  'Sahalms9061@gmail.com',
  'shahansha.kummetha@gmail.com',
  'PYAPILYS@gmail.com',
  'gn.varshitha@gmail.com'
)

UNION ALL

SELECT 'rpa_cv_tmp' AS what, count(*) 
FROM rpa_cv_tmp
WHERE "EmailID" IN (
  'avalakrishna08@gmail.com',
  'nihar.nayak.qatech@gmail.com',
  'prashant.sagar995@gmail.com',
  'Sahalms9061@gmail.com',
  'PYAPILYS@gmail.com',
  'gn.varshitha@gmail.com'
);

-- =====================

SELECT id, "Name", "EmailID", "cvFileUrl"
FROM rpa_cv
WHERE "EmailID" IN (
  'avalakrishna08@gmail.com',         -- Avala Krishna
  'nihar.nayak.qatech@gmail.com',     -- Nihar Ranjan
  'prashant.sagar995@gmail.com',      -- Prashant Sagar
  'Sahalms9061@gmail.com',            -- Sahal M S
  'shahansha.kummetha@gmail.com',     -- Kummetha Shahansha
  'PYAPILYS@gmail.com',               -- Sravani Pyapily
  'gn.varshitha@gmail.com'            -- Varshitha GN
)
OR "Name" ILIKE ANY (ARRAY[
  '%Avala Krishna%',
  '%Nihar Ranjan%',
  '%Prashant Sagar%',
  '%Sahal M S%',
  '%Kummetha Shahansha%',
  '%Sravani Pyapily%',
  '%Varshitha GN%'
])
ORDER BY "Name";


