# RCA — Draft Zeko jobs appear in the "Schedule Zeko Interview" dropdown

**Date:** 2026-08-25
**Reported on:** `ats-staging.aapnainfotech.com/pipeline` → MAK PATEL → Functional Screening (Zeko) → Schedule Zeko Interview
**Status:** ✅ **Fixed** — all three changes in §7 approved and applied 2026-08-25. See §10.

---

## 1. Symptom

Typing "juni" into the Zeko Job picker offers two options:

| Shown in dropdown | Zeko state |
|---|---|
| **Junior Python QA Automation Engineer Hiring** — Role: Junior Python QA Automation Engineer | ⛔ **Draft** |
| Junior QA Python Role – Functional and coding — Role: QA Automation Engineer | ✅ Published |

Booking against the draft one produces a dead candidate link — Zeko serves
**"Unpublished Interview – Testing Mode — Kindly publish it before conducting interview."**

**This has already happened.** The draft job `Junior Python QA Automation Engineer` currently has
**2 candidate bookings** against it in `rpa_zeko_candidate_pipeline`.

---

## 2. TL;DR root cause

The publish state **is** synced, **is** current, and **is** stored correctly. The dropdown simply
never filters on it.

[screening.service.js:2296-2302](backend/src/services/screening.service.js#L2296-L2302)

```js
export async function getZekoJobs() {
  const jobs = await prisma.rpa_zeko_jobs.findMany({
    where: { is_archived: false },     // ← archived is excluded; draft is not
    orderBy: { title: 'asc' },
  });
  return jobs;
}
```

`GET /api/screening/analytics/jobs` returns **every non-archived job — 55 rows, of which 25 are
`draft`** — and the drawer renders them all.

---

## 3. The sync is not the problem — it is doing its half correctly

Worth stating plainly, because the report assumed the periodic fetch was what should have prevented
this. It already does everything it needs to:

- **It runs hourly and is enabled on staging** — `ZEKO_SYNC_ENABLED=true`, `ZEKO_JOBS_CRON=0 * * * *`
  ([zekoScheduler.js:55-63](backend/src/jobs/zekoScheduler.js#L55-L63)). Most recent `synced_at` on
  staging: **2026-08-25 08:30**.
- **It asks Zeko for all three states** — `published=true&notPublished=true&archived=true`
  ([zeko.service.js:406-412](backend/src/services/zeko.service.js#L406-L412)) — deliberately, so the
  catalog stays complete.
- **It derives and stores the state on every run**
  ([zeko.service.js:154-156](backend/src/services/zeko.service.js#L154-L156)):
  ```js
  let status = 'draft';
  if (r.isArchived) status = 'archived';
  else if (r.isPublished || r.isWorkflowPublished) status = 'published';
  ```
  and `status` **is** in the upsert's `update` clause, so a Zeko-side publish ⇄ unpublish flip is
  reflected within the hour, in both directions — exactly the behaviour you described wanting.

So no change to the sync cadence or scope is needed. The state is sitting in the column, current and
correct; the read just ignores it.

---

## 4. The trap: do **not** filter on `is_published`

The obvious-looking fix — `where: { is_published: true }` — would be **wrong**, and would hide
genuinely published jobs.

The upsert's `update` clause omits `is_workflow_pub`
([zeko.service.js:440-456](backend/src/services/zeko.service.js#L440-L456)) — it is set only on
`create`. So for any job that was first seen as a draft and later **workflow-published** on Zeko, that
column stays stale at `false` forever, even though `status` correctly flips to `published`.

Measured on staging — **8 rows** where `status = 'published'` but both boolean flags read `false`:

```
AI Engineer (Fresher)                                    status=published  is_published=false  is_workflow_pub=false
Business Development Executive – IT Services Sales        status=published  is_published=false  is_workflow_pub=false
Enterprise SaaS Sales Lead - Functional                   status=published  is_published=false  is_workflow_pub=false
IT Recruitment Executive                                  status=published  is_published=false  is_workflow_pub=false
International Sales Executive (SaaS Product) - HR Interview status=published is_published=false  is_workflow_pub=false
Microsoft Dynamics 365 Developer                          status=published  is_published=false  is_workflow_pub=false
PMO Associate  (×2)                                       status=published  is_published=false  is_workflow_pub=false
```

Filtering on `is_published` would drop all 8 of these from the dropdown — trading "shows jobs it
shouldn't" for "hides jobs it should show", which is the worse failure of the two.

**`status` is the only field kept current for both publish routes.** That is what the filter must use.

The stale column is worth repairing in the same change (add `is_workflow_pub` — and, for consistency,
the other create-only fields — to the `update` clause), but the filter must not depend on it.

---

## 5. Nothing stops a draft booking server-side either

[screening.service.js:2501-2506](backend/src/services/screening.service.js#L2501-L2506) resolves the
job for scheduling with no publish check:

```js
const job = await prisma.rpa_zeko_jobs.findFirst({ where: { zeko_id: String(zekoJobId) } });
if (!job) throw new AppError('Zeko Job details not found.', 404);
```

So the dropdown filter alone is a UI-level guard. Any stale browser tab, cached job list, or direct API
call can still book a draft job and hand the candidate the "Unpublished Interview" page. Given this has
already produced 2 real bookings, I'd recommend the server-side check as part of the same fix rather
than as a follow-up.

---

## 6. One more thing the dropdown does

[PipelineDrawer.jsx:1247-1249](frontend/src/components/pipeline/PipelineDrawer.jsx#L1247-L1249)

```js
const matchingZekoJobs = zekoJobs.filter((j) => (isHrRound ? j.interview_type === 'hr' : j.interview_type !== 'hr'));
const zekoJobOptions = matchingZekoJobs.length > 0 ? matchingZekoJobs : zekoJobs;
```

When no job matches the round's interview type, it silently falls back to offering **every** job. That
is a deliberate "better something than nothing" choice and it is not what caused this report — but it
does mean the dropdown can never be trusted to be type-correct either. Once the backend filters on
publish state the fallback at least can only offer *published* jobs, which is why I would leave the
fallback alone and fix the filter.

---

## 7. Proposed fix

**7.1 Filter the catalog endpoint on `status`** — [screening.service.js:2296](backend/src/services/screening.service.js#L2296):

```js
where: { status: 'published' }
```

`status: 'published'` already implies not-archived (the derivation is a chain: archived wins over
published), so this replaces the `is_archived: false` filter rather than adding to it. Per §4 it is
also the only field kept current for both publish routes.

**7.2 Reject a non-published job at booking time** — in `assignCandidateToZekoJob`, after the existing
`if (!job)` check:

```js
if (job.status !== 'published') {
  throw new AppError('This Zeko job is not published — publish it on Zeko before scheduling.', 400);
}
```

Closes the hole in §5 with an error the recruiter can act on, rather than a dead candidate link.

**7.3 Stop `is_workflow_pub` drifting** — add it (and the other create-only fields) to the upsert's
`update` clause, so the column stops disagreeing with `status`. Does not change dropdown behaviour;
prevents the next person from reaching for the wrong field.

### What the dropdown will show afterwards

**55 → 30 jobs.** By interview type: **hr 11 · coding 6 · functional 7 · other 6**. All 30 have a
`primary_interview_id`, so every remaining option is actually schedulable (a job without one throws
*"Primary interview ID missing"* today).

### What this does not break

Existing bookings against jobs that are now hidden — including MAK PATEL's two against the draft job —
still display correctly. The board, the Zeko pipeline view
([screening.service.js:2317](backend/src/services/screening.service.js#L2317)) and the cancel path
([screening.service.js:2686](backend/src/services/screening.service.js#L2686)) all resolve the job by
`zeko_id` without a status filter, so history stays intact. Only the *pick a job to book* list narrows.

---

## 8. Existing bookings that point at an unpublishable job

**Correction to an earlier draft of this document:** I attributed the two draft-job bookings to MAK
PATEL, inferring it from the screenshot. That was wrong — MAK PATEL's booking was never completed.
The actual rows, queried rather than inferred:

| Job status | Job | Booking | Round / state | Candidate |
|---|---|---|---|---|
| **draft** | Junior Python QA Automation Engineer Hiring | 62 | functional / `sent` | Abhishek Singh `<itsabhi233@gmail.com>` |
| **draft** | Junior Python QA Automation Engineer Hiring | 70 | functional / `sent` | PANKAJ MONDAL `<…aiuserpankajmondal@gmail.com>` |
| archived | QA Automation Engineer | 34 | functional / `completed` | SAHIL SARMA |
| archived | Demo - Vaibhav | 27 | hr / `completed` | SAHIL SARMA |

Only the two **draft** rows matter — both are `sent`, so those candidates hold a live invite that
lands on "Unpublished Interview – Testing Mode". The two archived ones are already `completed` and
need nothing. Booking 70 is PANKAJ MONDAL's functional round, booked shortly after the
[Zeko round-scoping fix](./RCA-2026-08-25-zeko-functional-round-shows-hr-score.md) restored the
Schedule Interview button — which is how this defect was found.

**I have not touched any of them.** Two ways forward, your call:

1. **Publish `Junior Python QA Automation Engineer Hiring` on Zeko** — both existing links start
   working immediately, no ATS change needed. Simplest if that job was meant to be live.
2. **Cancel and rebook** against a published equivalent. The cancel path
   ([screening.service.js:2686](backend/src/services/screening.service.js#L2686)) resolves the job
   without a status filter, so cancelling an unpublished-job booking still works after this fix.

Note that until one of those happens, both candidates keep a dead link — the fix stops *new* draft
bookings, it does not repair the two that exist.

---

## 9. Summary

| | |
|---|---|
| **Root cause** | `getZekoJobs()` filters `is_archived: false` only — draft jobs are returned and rendered. 25 of 55 non-archived jobs are drafts. |
| **Not the cause** | The hourly sync. It already fetches all states, derives `status` from both publish flags, and updates it on every run — publish ⇄ unpublish flips already propagate within the hour. |
| **Key trap** | Filtering on `is_published` would hide **8** genuinely published jobs, because `is_workflow_pub` is missing from the upsert's `update` clause and drifts. Filter on `status`. |
| **Also exposed** | Booking has no server-side publish check — a draft job can still be booked by a stale tab or a direct API call. Already produced 2 real bookings. |
| **After the fix** | Dropdown shows 30 published jobs (hr 11 · coding 6 · functional 7 · other 6), all schedulable. Existing history unaffected. |

---

## 10. What shipped

All three changes from §7, applied 2026-08-25. Backend only.

| File | Change |
|---|---|
| [screening.service.js](backend/src/services/screening.service.js) · `getZekoJobs` | `where: { status: 'published' }` replaces `is_archived: false`. |
| [screening.service.js](backend/src/services/screening.service.js) · `assignCandidateToZekoJob` | Rejects a non-published job with a 400 naming the job and its current state. |
| [zeko.service.js](backend/src/services/zeko.service.js) · `syncZekoJobs` | The upsert's `update` clause now refreshes every mutable field — `is_workflow_pub`, `is_hr_screening`, `is_coding`, `slug`, `email`, `job_ref_id` were create-only and froze. |
| [screening.routes.js](backend/src/routes/screening.routes.js) | Route comment corrected — it claimed "active jobs". |

**`created_at_zeko` and `company_name` stay create-only on purpose:** the first is immutable, the
second carries a local default (`'Aapna Infotech'`) that a sync should not stamp back over.

### Verification — by calling the real `getZekoJobs()` against staging

| Check | Result |
|---|---|
| Rows returned | **30** (was 55) |
| Non-published leaking through | **0** |
| Archived leaking through | **0** |
| Missing `primary_interview_id` (would throw on booking) | **0** |
| Drawer's HR-round options / non-HR options | **11 / 19** — both non-empty, so the §6 "offer everything" fallback never triggers |
| The 8 workflow-published jobs with stale `false` flags | **still included** — confirms §4: an `is_published` filter would have dropped them |
| `Junior Python QA Automation Engineer Hiring` **[draft, coding]** — the reported row | **gone from the dropdown** ✅ |
| `Junior Python QA Automation Engineer - HR Interview` **[published, hr]** | still offered ✅ |
| `Junior QA Python Role - Functional and coding` **[published, coding]** | still offered ✅ |

The last three are exactly the "juni" search from the report: the draft option is gone, the published
one remains.

72/72 backend unit tests pass. `getZekoJobs` has one consumer — `GET /api/screening/analytics/jobs`
— read by the drawer's picker and by a `zekoJobs` state in `CandidateScreening.jsx` that is fetched
but never rendered, so no analytics view depends on drafts being present.

### Not changed

The drawer's type-filter fallback from §6 ([PipelineDrawer.jsx:1248](frontend/src/components/pipeline/PipelineDrawer.jsx#L1248)),
which offers every job when none matches the round's interview type. With both buckets non-empty it
cannot fire today, and after this change it could only ever offer published jobs. Left alone
deliberately rather than folded into an unrelated fix.
