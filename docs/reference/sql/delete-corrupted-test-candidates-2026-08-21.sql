-- Cleanup of staging test candidates carrying corrupted / stuck interview data.
--
-- WHY THESE ROWS
--   1. Corrupted Zeko results — rpa_zeko_candidate_pipeline rows 47/55/56/57/59
--      were marked 'completed' carrying ANOTHER candidate's scores (a mid-edit
--      test run indexed data[0] instead of matching on email). Result rows 6-10
--      hold those mis-attributed scores.
--   2. Unexplained Zeko mismatch — row 38 (Pankaj K Mondal) holds a literal
--      'mock-pipeline-id-…' and can never resolve.
--   3. Stuck human rounds — schedules 44 (tech3) and 46 (tech1) ended with no
--      occurrence verdict and aged past the sweep's old window.
--   4. Unsubmitted scorecards — 7, 10, 14 dispatched but never filled in.
--
-- Verified before writing: no target has final_outcome set and none is closed,
-- so no real hire is being removed.
--
-- CASCADE NOTES (from information_schema, staging)
--   rpa_cv                     -> rpa_shortlisted_candidates    CASCADE
--   rpa_shortlisted_candidates -> rpa_zeko_candidate_pipeline   CASCADE
--   rpa_candidate_pipeline     -> schedule / scorecard / offers /
--                                 stage_events / documents /
--                                 assessment_invites            CASCADE
--   rpa_interview_schedule     -> rpa_interview_scorecard       CASCADE
--   rpa_interview_scorecard    -> rpa_interview_scorecard_skill CASCADE
--   rpa_candidate_pipeline.shortlist_id -> SET NULL  ← journeys must be deleted
--                                 BEFORE their shortlist rows, or they survive
--                                 as orphans with a null shortlist_id.
--   rpa_assessment_results / rpa_notifications / rpa_email_messages -> SET NULL
--     (kept deliberately: history rows that outlive the candidate)

BEGIN;

-- CV-backed targets. CV 44 is shared by two shortlists (179 + 161) and carries
-- both journeys 33 and 5 — deleting it removes all of that, as intended.
CREATE TEMP TABLE _targets ON COMMIT DROP AS
SELECT id FROM rpa_cv WHERE id IN (
   44,   -- SAURABH YADAV / KUMAR  — stuck tech3 + scorecards 7 & 14
   73,   -- AASUL PATEL            — corrupted zeko row 59
  205,   -- Senthamil Selvi        — corrupted zeko row 57
  259,   -- Sheetal Bajage         — scorecard 10 never submitted
  289,   -- HARISH MP              — corrupted zeko row 56
  290    -- SHIVAM YADAV           — corrupted zeko row 55 + stuck tech1
);

-- Journeys first: shortlist_id is SET NULL, so deleting shortlists first would
-- strand these rows instead of removing them.
DELETE FROM rpa_candidate_pipeline WHERE cv_id IN (SELECT id FROM _targets);

-- Then the shortlists, which cascade into rpa_zeko_candidate_pipeline.
DELETE FROM rpa_shortlisted_candidates WHERE cv_id IN (SELECT id FROM _targets);

DELETE FROM rpa_cv_vectors         WHERE candidate_id IN (SELECT id FROM _targets);
DELETE FROM rpa_assessment_results WHERE cv_id        IN (SELECT id FROM _targets);
DELETE FROM rpa_upload_jobs        WHERE cv_id        IN (SELECT id FROM _targets);
DELETE FROM rpa_cv                 WHERE id           IN (SELECT id FROM _targets);

-- CV-less candidates: their bad data lives only in the Zeko tables, so the
-- cascade above never reaches them.
--   105 = Akshit Kumar    (corrupted zeko row 47)
--    69 = Pankaj K Mondal (zeko row 38, mock-pipeline-id)
DELETE FROM rpa_zeko_candidate_pipeline WHERE candidate_id IN (105, 69);
DELETE FROM rpa_shortlisted_candidates  WHERE id           IN (105, 69);

-- Mis-attributed Zeko results (Kenneth Lobo / Vijay Panchal / Sekhar Yellampati
-- scores written against other candidates' interviews).
DELETE FROM rpa_zeko_interview_results WHERE id IN (6, 7, 8, 9, 10);

DELETE FROM rpa_cv_tmp WHERE "EmailID" IN (
  'saurabhkum1212@gmail.com, saurabhkum121254@gmail.com, saurabhyadav12@gmail.com',
  'aasul.patel@gmail.com',
  'senthamil29997@gmail.com',
  'shtlbjg@gmail.com',
  'aiautomationn8nuser@gmail.com',
  'shivam12654@gmail.com'
);

COMMIT;

-- ///////// verification — every count must be 0

SELECT 'rpa_cv'                        AS what, COUNT(*) FROM rpa_cv                        WHERE id IN (44,73,205,259,289,290)
UNION ALL SELECT 'rpa_candidate_pipeline',      COUNT(*) FROM rpa_candidate_pipeline        WHERE cv_id IN (44,73,205,259,289,290)
UNION ALL SELECT 'rpa_shortlisted (by cv)',     COUNT(*) FROM rpa_shortlisted_candidates    WHERE cv_id IN (44,73,205,259,289,290)
UNION ALL SELECT 'rpa_shortlisted (orphans)',   COUNT(*) FROM rpa_shortlisted_candidates    WHERE id IN (105,69)
UNION ALL SELECT 'zeko_pipeline (corrupt)',     COUNT(*) FROM rpa_zeko_candidate_pipeline   WHERE id IN (47,55,56,57,59,38)
UNION ALL SELECT 'zeko_results (misattributed)',COUNT(*) FROM rpa_zeko_interview_results    WHERE id IN (6,7,8,9,10)
UNION ALL SELECT 'schedules (stuck)',           COUNT(*) FROM rpa_interview_schedule        WHERE id IN (44,46)
UNION ALL SELECT 'scorecards (pending)',        COUNT(*) FROM rpa_interview_scorecard       WHERE id IN (7,10,14);
