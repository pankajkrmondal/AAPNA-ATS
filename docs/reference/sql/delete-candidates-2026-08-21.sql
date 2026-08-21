BEGIN;

CREATE TEMP TABLE _targets ON COMMIT DROP AS
SELECT id FROM rpa_cv WHERE "EmailID" IN (
  'itsabhi233@gmail.com',
  'amittornetorne8746@gmail.com',
  'darshancr58@gmal.com',
  'dhanarmsd@gmail.com',
  'dpgaikwaad88@gmail.com',
  'hkumark010@gmail.com',
  'mirzakamran888@gmail.com',
  'dhanalakshmimahendrakar@gmail.com',
  'hemkumarhk3@gmail.com'
);

DELETE FROM rpa_candidate_pipeline  WHERE cv_id        IN (SELECT id FROM _targets);
DELETE FROM rpa_cv_vectors          WHERE candidate_id IN (SELECT id FROM _targets);
DELETE FROM rpa_assessment_results  WHERE cv_id        IN (SELECT id FROM _targets);
DELETE FROM rpa_upload_jobs         WHERE cv_id        IN (SELECT id FROM _targets);
DELETE FROM rpa_cv                  WHERE id           IN (SELECT id FROM _targets);

DELETE FROM rpa_cv_tmp WHERE "EmailID" IN (
  'itsabhi233@gmail.com',
  'amittornetorne8746@gmail.com',
  'darshancr58@gmal.com',
  'dhanarmsd@gmail.com',
  'dpgaikwaad88@gmail.com',
  'hkumark010@gmail.com',
  'mirzakamran888@gmail.com',
  'dhanalakshmimahendrakar@gmail.com',
  'hemkumarhk3@gmail.com'  
);

COMMIT;


-- //////////

SELECT 'rpa_cv' AS what, count(*) FROM rpa_cv
WHERE "EmailID" IN ('itsabhi233@gmail.com','amittornetorne8746@gmail.com',
  'darshancr58@gmal.com','dhanarmsd@gmail.com','dpgaikwaad88@gmail.com',
  'hkumark010@gmail.com','mirzakamran888@gmail.com','dhanalakshmimahendrakar@gmail.com','hemkumarhk3@gmail.com'  )
UNION ALL
SELECT 'rpa_cv_tmp', count(*) FROM rpa_cv_tmp
WHERE "EmailID" IN ('itsabhi233@gmail.com','amittornetorne8746@gmail.com',
  'darshancr58@gmal.com','dhanarmsd@gmail.com','dpgaikwaad88@gmail.com',
  'hkumark010@gmail.com','mirzakamran888@gmail.com','dhanalakshmimahendrakar@gmail.com','hemkumarhk3@gmail.com'  );


-- // 


SELECT id, "Name", "EmailID", "cvFileUrl"
FROM rpa_cv
WHERE "EmailID" IN (
  'itsabhi233@gmail.com',          -- Abhishek Singh
  'amittornetorne8746@gmail.com',  -- Amit Torne
  'darshancr58@gmal.com',          -- Darshan C R      (sic: gmal.com)
  'dhanarmsd@gmail.com',           -- Dhanalakshmi Ramachandran
  'dpgaikwaad88@gmail.com',        -- Dhiraj Gaikwad
  'hkumark010@gmail.com',          -- Hemanth Kumar K
  'mirzakamran888@gmail.com',       -- Kamran Mirza
    'dhanalakshmimahendrakar@gmail.com',
  'hemkumarhk3@gmail.com' 

)
OR "Name" ILIKE ANY (ARRAY[
  '%Abhishek Singh%', '%Amit Torne%', '%Darshan%', '%Dhanalakshmi%',
  '%Dhiraj Gaikwad%', '%Hemanth Kumar%', '%Kamran Mirza%'
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


