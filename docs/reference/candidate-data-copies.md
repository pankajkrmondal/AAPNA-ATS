# Candidate data: every copy, who writes it, who reads it

**Item:** Candidate data sync (N29), Phase 3 "Do Now" section D. **Audited:** 16 Oct 2026, against the code.
**Rule in one line:** `rpa_cv` is the candidate record. The pipeline keeps one live copy of the name and email, which is now synced on every write. Everything else is either a match key or a log, and is left as recorded.

## Identity (name, email, phone)

| Field | Copy | Written by | Read by | Decision |
|---|---|---|---|---|
| Name, email | `rpa_cv.Name`, `EmailID` (the record) | Search Candidate edit (`candidate.service.update`), public missing-details form (`candidate.controller.submitPublicMissingData`), HR/vendor upload merge (`hrUpload.service.mergeDuplicates`), Outlook intake (`hrUpload.service`, duplicate path), new uploads | Search Candidate, interview invites (`interviewSchedule.service.liveCandidateEmail`), vendor lists | **Source of truth** |
| Name, email | `rpa_shortlisted_candidates.candidate_name`, `candidate_email` | Shortlist (`screening.service`); **since N29** every writer above, through `syncShortlistIdentity` (`services/candidateSync.service.js`) | Pipeline board and drawer, Analytics stuck list, Zeko analytics, every pipeline email (stage outcome, scheduling, offer, documents, scorecards, jobs), pipeline CSV, inbox grouping | **Live copy. Synced** on every record write; old addresses kept in `candidate_email_all` |
| Other addresses | `rpa_shortlisted_candidates.candidate_email_all` | **Since N29:** the sync, which adds any address the candidate stopped using | Drawer inbox view (`pipeline.controller.getPipelineConversations`) | Keeps old threads findable |
| Phone | `rpa_cv.ContactNumber` only | Search Candidate, public form, uploads, the drawer's Schedule dialog (`updateCandidatePhoneForPipeline`) | Everyone | No copy, nothing to sync |
| Email | `rpa_zeko_candidate_pipeline.candidate_email` | Zeko assign / schedule | Zeko result matching | **Match key. Never synced:** changing it would detach the round from its result |
| Email | `rpa_assessment_results.email_matched` | Evalground import | Import matching | **Match key. Never synced** |
| Name, email | `rpa_zeko_interview_results.candidate_name`, `candidate_email` | Zeko sync | Result matching | **External record.** Left as Zeko sent it |
| Name, email | `rpa_upload_jobs`, `rpa_referral_audit`, `rpa_notifications.description` | Upload / referral / bell at the time | Upload and audit views | **Logs.** What was true when written |
| Name | `rpa_email_notifications.candidate_name` | Nothing in `src/` (legacy n8n) | Nothing | Dead column |

## Scores

| Score | Where it lives | Written by | Shown in |
|---|---|---|---|
| Zeko HR / Functional, per round | `rpa_zeko_interview_results` (round-scoped by `rpa_zeko_candidate_pipeline`) | Zeko sync | Drawer, each Zeko round (N28); Search Candidate "Pipeline scores" (N29) |
| Evalground | `rpa_assessment_results` | Evalground import (also writes `rpa_cv.IQScore` / `TechScore`) | Drawer assessment round; Search Candidate "Pipeline scores" |
| Interview rounds (Tech 1-3, HR, CEO) | `rpa_interview_scorecard` (+ skills) | Interviewer scorecards | Drawer round (average and verdict per interviewer, N28), Scorecard report, Search Candidate "Pipeline scores" |
| Candidate-level legacy scores | `rpa_cv` `Heat`, `IQScore`, `TechScore`, `TechRoundOne/Two/Three`, `HRInterview`, `ManagerialOrCEOFeedback`, `HRQuickcomments`, Zeko ×3 | Excel uploads, Search Candidate (editable, decision 16 Oct); Zeko sync rewrites the Zeko ×3 | Search Candidate; drawer "Uploaded scores (from Excel)" card (read-only) |

**One source per score:** each pipeline score has one table, and both the drawer and Search Candidate read that table. The legacy `rpa_cv` columns are shown as the candidate record's own values, never under a round. They hold one set per candidate, with no record of which round produced them (the 25 Aug incident, `pipeline.service.js` getPipelineDetail).

## Caches cleared on a record write

| Cache | Where | Cleared by |
|---|---|---|
| Screening result lists, Redis `screening:role:*` (v1 and v2), 1 h | `screening.service`, `screeningV2.service` | `clearScreeningRoleCache()`: shortlist, reject, Search Candidate edit, public form (name/email), upload merge, Outlook intake |
| Per-MRF insight text, Redis `insight:mrf:*:cv:<id>`, 7 days | `screeningV2.service` | `clearCandidateInsightCache(id)`: Search Candidate edit |
| Search vector (`rpa_cv_vectors`) | `vectorStore.service` | `refreshCandidateVector`: Search Candidate edit, only when a searchable field changed (`EMBEDDED_CV_FIELDS`, `utils/candidateSync.js`) |
| AI profile insights (`rpa_cv.ai_profile_insights`) | `hrUpload.service.preGenerateCandidateInsights` | Regenerated after every Search Candidate edit (unchanged) |
| Browser: screening lists, pipeline board and drawer, pipeline scores | React Query | `invalidateCandidateCopies()` (`frontend/src/utils/candidateCache.js`) after a save in Search Candidate or Candidate Detail |

## Known limits
- **Zeko columns on `rpa_cv`:** one set for both rounds, rewritten by every Zeko sync, so an edit in Search Candidate lasts until the next synced result. The edit form says so. Kept by design: the drawer reads each round's own result.
- **Fixed later on 16 Oct:**
  - Missing-details links sent before an email change now find the candidate by their stored token (`cvMissingToken`).
  - Candidate Detail's timeline shows the real history instead of demo events.
