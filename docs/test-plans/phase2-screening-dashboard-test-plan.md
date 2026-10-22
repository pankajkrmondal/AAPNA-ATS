# Phase 2.2–2.5 — Manual QA Test Plan: Screening Decision Modal, Rejection Cooldown, Recruiter Visibility, Search Completeness, Dashboard

**Scope:** All 25 items delivered across `CHANGES-phase2.2-screening-decision-modal-refinements.md`
through `CHANGES-phase2.5-rejected-by-and-modified-at-fix.md`.

**Date:** 2026-07-23
**Environment:** Local development (frontend `npm run dev` on :5173, backend `npm run dev` on :5000)

No automated test suite exists for this backend yet — this plan is manual-only. Each case lists
Preconditions, Steps, Expected Result, and a `Verify` SQL query where DB-level confirmation is useful.

---

## 1. Environment Setup & Prerequisites

| Component | Command | Notes |
|---|---|---|
| Backend | `npm run dev` (in `backend/`) | Express on :5000 |
| Frontend | `npm run dev` (in `frontend/`) | Vite on :5173 |

**Test data needed:**
1. At least one **approved MRF** with `required_in` set (JD tab role dropdown).
2. Candidates matching that MRF's JD tab search, and separately, candidates reachable via a **Keyword tab** search (broad enough to return >0 without a keyword too).
3. Two logged-in recruiter accounts (different `rpa_users` rows) to test "shortlisted/rejected by" attribution across users.
4. DB read/write access for `Verify` queries and for the cooldown-expiry tests (RC-03), which require backdating `modified_at`.
5. An active email template for both `shortlist` and `rejection` categories (`rpa_email_templates`).

---

## 2. Test Cases — Shortlist/Reject Decision Modal

Implementation: `frontend/src/components/screening/DecisionEmailModal.jsx`, `frontend/src/components/common/EmailBodyEditor.jsx`, `frontend/src/pages/CandidateScreening.jsx`, `backend/src/services/screening.service.js`.

### SDM-01 — WYSIWYG email body editor (Visual/HTML/Preview)
- **Steps:** Select a candidate → Shortlist. In the Email section, confirm the **Visual / HTML / Preview** toggle. On Visual, type a sentence using the toolbar (bold a word, add a bullet list). Switch to HTML — confirm the typed change appears as raw HTML matching what you typed. Switch to Preview — confirm it renders the compiled email with your edit intact.
- **Expected:** Visual tab shows a formatting toolbar (Bold/Italic/Underline/lists/link/clear) plus a `+candidate_name` chip. Edits made in Visual persist when switching to HTML and Preview.

### SDM-02 — Floating dock hidden while modal is open
- **Steps:** Select 1+ candidates (dock appears bottom-center) → click "Shortlist Selected". Observe the dock. Cancel the modal.
- **Expected:** Dock disappears the instant the modal opens; reappears after Cancel (selection preserved).

### SDM-03 — Shortlist idempotency / undo-reject
- **Steps (undo-reject):** Reject a candidate for role A (any tab, tag role A). Re-search so the candidate reappears for role A (requires bypassing/expiring the cooldown — see RC-03, or reject then immediately search a role where they weren't excluded). Select them, tag role A again, click Shortlist.
- **Expected:** Candidate transitions to `shortlisted`; notification email sends; toast shows accurate count, not "skipped."
- **Steps (already-shortlisted skip):** Shortlist a candidate for role A. Immediately select the same candidate + role A again, click Shortlist.
- **Expected:** Toast explicitly notes they were skipped ("N already had a record for this role and were left unchanged"); no duplicate email.
- **Steps (no regression from advanced pipeline stage):** Manually set a shortlisted candidate's `pipeline_status` to `on_hold` or `hired` via the Recruitment Analytics page's status dropdown. Re-select them in Screening and click Shortlist for the same role.
- **Expected:** Skipped — `pipeline_status` must NOT revert to `shortlisted`.
- **Verify:**
  ```sql
  SELECT id, cv_id, mrf_id, pipeline_status, shortlisted_by, shortlisted_at, modified_at
  FROM rpa_shortlisted_candidates WHERE cv_id = <candidate_id> ORDER BY id DESC;
  ```

### SDM-04 — Toast reflects real server counts
- **Steps:** Bulk-select a mix of new and already-shortlisted candidates, click Shortlist.
- **Expected:** Toast's processed count and skipped count match the actual server result, not the raw selection size.

### SDM-05 — "Assign to Zeko job" routes through the same modal
- **Steps:** Keyword tab → open a not-yet-shortlisted candidate's drawer → click "Assign to Zeko job".
- **Expected:** The Shortlist modal opens requiring a role tag (no silent role-less shortlist). Repeat on JD tab: role is pre-filled automatically, no extra prompt.

### SDM-06 — Reject on Keyword tab requires a role tag
- **Steps:** Keyword tab → select candidate(s) → "Reject Selected".
- **Expected:** "Tag to Open JD *" is required; Confirm stays disabled until a role is picked; the Email section stays hidden until then (see SDM-09).

### SDM-07 — "Other" rejection reason requires free text
- **Steps:** Reject flow → Reason = "Other". Try to confirm without typing anything, then type a reason and confirm.
- **Expected:** Confirm disabled while the text box is empty; the actual typed text (not the word "Other") is what gets saved.
- **Verify:** `SELECT recruiter_notes FROM rpa_shortlisted_candidates WHERE id = <row_id>;` → matches typed text.

### SDM-08 — `{role_paragraph}` resolves to real, static text
- **Steps:** JD tab shortlist (role already known) → check Visual/HTML body immediately.
- **Expected:** Full real paragraph text with the actual role name embedded — no `{role_paragraph}` token, no `+role_paragraph` chip in the toolbar.
- **Steps (Keyword tab):** Open Shortlist on Keyword tab before tagging a role → observe body (generic fallback paragraph, no role name). Tag a role.
- **Expected:** Body updates to the role-specific paragraph immediately.

### SDM-09 — Email section hidden until a role is tagged (Keyword tab)
- **Steps:** Keyword tab, Shortlist or Reject, before picking a role.
- **Expected:** Entire Email section (checkbox, subject, editor) is replaced with "Tag a role above to preview the notification email." It appears as soon as a role is picked.

---

## 3. Test Cases — Rejection Cooldown / Search Exclusion

Implementation: `backend/src/utils/rejectionCooldown.js`, `backend/src/services/screening.service.js` (`searchRoleCandidates`, `searchKeywordCandidates`, `updateCandidateStatus`, `rejectCandidates`).

### RC-01 — JD-tab exclusion is per-role, not global
- **Steps:** Reject a candidate for role A (JD tab). Force-refresh role A's search.
- **Expected:** Candidate absent.
- **Steps continued:** Search a **different** role B that the same candidate would otherwise match.
- **Expected:** Candidate **present** — rejection is scoped per (candidate, MRF), not a global block.

### RC-02 — Keyword-tab exclusion (new — didn't exist before)
- **Steps:** Reject a candidate via Keyword tab (tag a role). Run a keyword search that would otherwise surface them.
- **Expected:** Excluded.
- **Steps (cross-tab):** Reject a candidate via JD tab for role A. Run a Keyword search that would surface them.
- **Expected:** Excluded there too (Keyword-tab exclusion isn't role-scoped — it's global across any recent rejection).
- **Steps (no-keyword path):** Repeat with the keyword box empty, using only exp/CTC/location filters.
- **Expected:** Same exclusion applies (separate code path, must be tested independently).

### RC-03 — 90-day cooldown actually expires
- **Steps:** Reject a candidate for role A. Backdate their row's `modified_at` to 91+ days ago:
  ```sql
  UPDATE rpa_shortlisted_candidates SET modified_at = NOW() - INTERVAL '91 days'
  WHERE cv_id = <candidate_id> AND mrf_id = <mrf_id>;
  ```
  Force-refresh role A's search.
- **Expected:** Candidate reappears.

### RC-04 — `modified_at` fix: Recruitment Analytics status dropdown
- **Steps:** Shortlist a candidate via Screening for role A. Go to Recruitment Analytics (Legacy) → find that candidate → set status to "Rejected" via the inline dropdown → Save. Return to Screening, force-refresh role A's JD-tab search.
- **Expected:** Candidate is excluded (their `modified_at` was bumped to now by this action, so the 90-day cooldown correctly applies from today).
- **Verify:** `modified_at` on their row should be within the last few minutes, not an old timestamp.

### RC-05 — `shortlisted_by`/`shortlisted_at` refresh on reject-after-shortlist
- **Steps:** As User A, shortlist a candidate for role A. As User B, reject that same candidate for role A.
- **Expected:** The row's `shortlisted_by`/`shortlisted_at` now reflect User B and the rejection time — not User A's original shortlist. (See SRB-02 for the UI-visible version of this check.)
- **Verify:** `SELECT shortlisted_by, shortlisted_at, pipeline_status FROM rpa_shortlisted_candidates WHERE cv_id=<id> AND mrf_id=<mrf>;` → `shortlisted_by` = User B, `pipeline_status` = `rejected`.

---

## 4. Test Cases — Shortlisted/Rejected-By Visibility

Implementation: `frontend/src/pages/CandidateScreening.jsx` (result card + drawer), backend `LEFT JOIN LATERAL` / batch-lookup additions in both search functions.

### SRB-01 — "Shortlisted by X on Y" plainly visible
- **Steps:** Shortlist a candidate. Look at their result card immediately (no page reload) and after a forced re-search. Open their drawer.
- **Expected:** Plain text line "Shortlisted by **{user}** on {date}" under the name/badge row — visible without hovering. Same info shown as two rows ("Shortlisted By" / "Shortlisted On") in the drawer's System Status card. Value matches immediately (optimistic) and after refetch (server-confirmed) — both should agree.

### SRB-02 — "Rejected by X on Y" plainly visible
- **Steps:** Using RC-03's backdating technique (or RC-04's flow), get a rejected candidate to reappear in a search. Check their card and drawer.
- **Expected:** "Rejected by **{user}** on {date}" shown the same way as SRB-01, using the *current* rejecter (per RC-05, not a stale prior shortlister).
- **Note:** A candidate currently shown as `rejected` will **not** simultaneously show "Shortlisted by" — the underlying columns are shared/overwritten per the last decision on that row, so only one of the two lines shows at a time for a given (candidate, role) row.

---

## 5. Test Cases — Search Completeness

Implementation: `backend/src/services/screening.service.js` (caps removed), `backend/src/services/vectorStore.service.js` (`mapWithConcurrency`, `RERANK_MAX_CONCURRENT_BATCHES`), `backend/src/services/emailNotification.service.js` (`sendRerankApiAlert`).

### SC-01 — No candidate cap, JD tab
- **Steps:** Search a role likely to match a large candidate pool. Count results shown vs. expected true match count (cross-check with a manual count if feasible, or at least confirm the result count isn't suspiciously capped at exactly 3000).
- **Expected:** No artificial 3000-row ceiling; result size reflects genuine matches (bounded only by the score threshold).

### SC-02 — No candidate cap, both Keyword-tab paths
- **Steps:** Repeat SC-01 with a broad keyword search, then again with the keyword box empty (filters only).
- **Expected:** Same — no 3000/1000 ceiling on either path.

### SC-03 — Cohere batches run with bounded concurrency
- **Steps:** Trigger a large search (>1000 candidates, i.e. >1 Cohere batch) and watch backend logs.
- **Expected:** Log line `Sending N candidates to Cohere Rerank...`; no more than 5 batch requests in flight simultaneously (verify via timing/log ordering if instrumented, or accept as code-reviewed if not directly observable).

### SC-04 — Rate-limit-aware degraded messaging (negative test)
- **Steps:** Temporarily break Cohere access (invalid `COHERE_API_KEY` or unreachable `COHERE_BASE_URL` in `.env`), restart backend, run a search that would trigger reranking.
- **Expected:** Search still returns results (degraded, unranked, capped at 250). Recruiter sees a toast: "Candidate ranking service is temporarily unavailable — showing the top N of M matches by base relevance." Dev alert email arrives with subject "🚨 ... API Failure" (red).
- **Steps (rate-limit variant, if a way to force a 429 is available):** Same as above but specifically induce a 429 (e.g. a deliberately over-quota trial key).
- **Expected:** Toast wording says "temporarily **busy**" instead of "unavailable"; dev alert subject is "⏳ ... Rate Limit Hit" (amber), with the rate-limit-specific explanation and remediation steps in the body.
- **Cleanup:** Restore valid Cohere credentials and restart backend afterward.

---

## 6. Test Cases — Dashboard Recruiter Activity

Implementation: `backend/src/services/dashboard.service.js` (`getRecruiterBreakdown`), `frontend/src/components/dashboard/RecruiterBreakdownCard.jsx`.

### DA-01 — Widget renders as a grouped bar chart
- **Steps:** Load the Dashboard.
- **Expected:** "Recruiter Activity" card present, grouped horizontal bars (gold = Added, blue = Shortlisted) with a legend, sized to fit all rows without scrolling/clipping.

### DA-02 — Names resolved via `rpa_users`
- **Steps:** Identify a recruiter who both uploaded candidates (via HR/Vendor Upload) and shortlisted candidates (via Screening), and who has a proper `rpa_users` row with `first_name`/`last_name` set. Find their bar.
- **Expected:** Shown as "First Last", not their raw email or username.

### DA-03 — Unmatched values fall back to raw label with hover explanation
- **Steps:** Find "Unattributed" and "Self Applied" bars. Hover each.
- **Expected:** Tooltip explains what they mean (no uploader on record / candidate applied directly) — not mistaken for real recruiter names.

### DA-04 — One merged row per recruiter, not two
- **Steps:** For the recruiter identified in DA-02, confirm there is exactly **one** row/name showing both an Added bar and a Shortlisted bar — not two separate entries under different labels.
- **Expected:** Single merged row. (If their `last_action_by` email and `shortlisted_by` username don't both resolve to the same `rpa_users.id`, they will legitimately show as two separate rows — this is a known, accepted limitation, see §7.)

### DA-05 — Terminology check: "Shortlisted", not "Tagged"
- **Steps:** Inspect the widget's column/series labels and tooltip copy.
- **Expected:** No occurrence of "Tagged" anywhere — fully renamed to "Shortlisted."

---

## 7. Known Gaps / Limitations (not bugs — accepted tradeoffs)

1. **Drawer staleness during concurrent bulk actions.** `selectedCandidate` (the open drawer's data) is a point-in-time snapshot, not reactively derived from the candidate list. If a candidate's drawer is open while they're *also* shortlisted/rejected via the bulk floating-dock action in the same moment, the open drawer won't reflect the new by/on until closed and reopened.
2. **Dashboard identity mismatch.** `last_action_by` (email) and `shortlisted_by` (username) only merge into one recruiter row when *both* values independently match the same `rpa_users` account. A recruiter whose stored username/email don't match current `rpa_users` records (e.g. legacy or renamed accounts) will show as two separate, differently-labeled rows.
3. **Point 4 from the original review — deferred to Phase 3, not covered here.** A "send email" checkbox for the Recruitment Analytics page's inline Rejected/On Hold status dropdown does not exist; it always auto-sends when a template is configured.
4. **By/on reflects only the latest action per (candidate, role) row**, not a full history — there's no audit log of every prior status change, only the current state's who/when.
