# Group 2 — browser-only checks: results

**Run:** 20 Aug 2026, ~16:50–17:00 IST · **Against:** `localhost:5173` (Vite dev, current working tree — *not* staging)
**Driven by:** Claude in Chrome, logged in as `admin` (user id 2)
**Journey used:** pipeline **27** — SAHIL SARMA (cv 31), Dot Net / mrf 63, `documents` stage. Real journey, not the fixture — same one DOC-03 used.

> ⚠️ **Build note.** These ran against the local dev server, so they include the 409 UX fix and D3 fix. They do **not** tell you how staging behaves. Re-run DOC-04/05 on staging if the build matters for your sign-off.

---

## Results table

| | Case | Verdict | Observed |
|---|---|---|---|
| ☑ | **DOC-05** | ⚠️ **FAIL — two defects** | `.exe` rejected but with **500**; extension-only check bypassed by rename → **200** |
| ☑ | **DOC-04** | ⚠️ **PARTIAL** | Not silent, but the server's precise reason is discarded for a generic retry prompt |
| ☑ | **VEND-14/15** | ✅ **PASS** | `2 + 1 + 0 + 14 = 17` — reconciles exactly, `untracked` bucket present |
| ⊘ | **O7** | **Defect confirmed in code; not reproducible here** | No assessment invite exists in this DB to open |
| ⊘ | **SCHED-18 (UI)** | **Not runnable** | No interview report exists on any journey |

**New defects found: 3.** D6 (alert-email amplification), D7 (extension-only file validation), D8 (server error text discarded by the upload page).

---

## ☑ DOC-05 — POST a `.exe` and a >10 MB file straight to the endpoint

Endpoint: `POST /api/documents/{token}/upload`. Multipart field name is **`document`** (not `file` — `file` returns `400 Unexpected file field.`).

| Payload | Status | Body message |
|---|---|---|
| `totally_safe.exe`, MZ header, `application/x-msdownload` | **500** | `File type .exe is not allowed. Accepted: .pdf, .docx, .doc, .jpg, .jpeg, .png.` |
| `huge.pdf`, 11 MB, `application/pdf` | **413** | `File too large. Please upload a smaller file.` — `error.isOperational: true` |
| `malware.pdf`, **MZ executable bytes**, `application/pdf` | **200** | `Document uploaded` |

Multer rejects both of the things the case asked about — so the headline expectation holds. But the *manner* of rejection is wrong, and the third row shows the filter is weaker than it looks.

### D7 — file validation is extension-only *(High)*

The third row is the finding. A Windows executable (`4D 5A 90 00` — `MZ`) renamed to `.pdf` uploaded successfully: **200 `Document uploaded`**, row written, file pushed to OneDrive. The filter reads the filename suffix; it checks neither the declared MIME type nor the magic bytes.

The upload path is **public and unauthenticated** — anyone holding a document token can put an arbitrary binary into your OneDrive tenant under a candidate's folder. Renaming is the entire attack.

### D6 — a rejected upload emails the team *(High — noise, and remotely triggerable)*

`fileFilter` at `backend/src/routes/document.routes.js:35` throws a **plain `Error`**. It carries no `statusCode` and no `isOperational` flag, so the global handler classifies a candidate picking the wrong file type as a server fault:

- status **500** instead of 400
- **and a "Backend Error Alert" email to the team** (confirmed received by `pkmondal@` and `hmopuri@` during this run — my five probes generated five alerts)

Contrast the size limit, which is modelled correctly: **413**, `isOperational: true`, no alert.

So an unauthenticated candidate holding a public upload token can page your team by email on demand, simply by selecting a `.txt`. During the demo, one fumbled upload sends mail. The fix is one line — throw an operational 400 from `fileFilter` instead of a bare `Error` — and it fixes the status code and the alert storm together.

---

## ☑ DOC-04 — `.exe` on the public upload page (finding O3)

**Setup:** opened `/documents/{token}` unauthenticated, injected `payroll_tool.exe` into the *Permanent address proof* input.

**O3 confirmed at the client.** The file was accepted with no complaint: card flipped to badge **"Ready to submit"**, footer button became **"Submit 1 document"**. The hidden `<input type="file">` carries **`accept=""`** — empty — so the OS picker doesn't filter either. The page's own footer says *"Accepted formats: PDF, DOC/DOCX, JPG or PNG — up to 10 MB each"*, but nothing enforces it until submit.

**It does not fail silently** — correcting my own first reading. My initial observation was "nothing happened", taken from a screenshot 3 s after clicking submit. That was wrong: antd's default toast duration is 3 s, so it had already gone. A MutationObserver caught it:

> **"1 of 1 could not be sent. Please try those again."**

Verified twice, and captured visually.

### D8 — the upload page discards the server's reason *(Medium)*

The server said exactly what was wrong and how to fix it:

```
File type .exe is not allowed. Accepted: .pdf, .docx, .doc, .jpg, .jpeg, .png.
```

The candidate is told:

```
1 of 1 could not be sent. Please try those again.
```

The advice is actively wrong — retrying is the one thing that cannot work. A candidate with a `.txt` payslip will loop, and each loop pages your team (see D6).

**This is N5's defect, on the candidate-facing surface.** N5 was scoped as "does the UI show the *server's* message"; it was checked on PipelineDrawer and passed. The public upload page fails the same check. Worth adding to N5's screen list rather than treating as unrelated.

---

## ✅ VEND-14/15 — vendor dashboard stage counts — **PASS**

`GET /api/vendor/dashboard` → `stats.byStage`:

```json
{"stages":[{"stage_key":"zeko_hr","stage_label":"HR Screening (Zeko)","count":2},
           {"stage_key":"tech2","stage_label":"Technical Round 2","count":1}],
 "closed":0,"untracked":14}
```

`stats.total: 17`. **2 + 1 + 0 + 14 = 17** — reconciles exactly, nothing dropped.

Counts are keyed on `stage_key`, and candidates with no journey land in `untracked` rather than vanishing. The UI renders that bucket as **"Not in pipeline: 14"**; DETAILED STATUS independently sums to 17 as well (12 + 3 + 1 + 1). Spot-checked *Rama Krishna Bitta* — dashboard shows HR Screening (Zeko) / "Zeko HR Screening Rejected", matching the pipeline board.

One wording note, not a defect: the checklist calls the bucket `untracked`, the UI says **"Not in pipeline"**. Same thing.

---

## ⊘ O7 — NaN / negative day count — **defect confirmed in code, not reproducible in this environment**

**Cannot be observed here.** No assessment invite exists to open: 0 candidates at the `assessment` stage, and across all 23 journeys `invited` and `assessment_pending` are false everywhere. Opening the Assessment panel on a journey with no invite renders *"Invite Sent — Not sent yet"* and no day count at all, so the code path never executes.

**But the defect is real.** `PipelineDrawer.jsx:425`:

```js
daysLeft = Math.ceil((new Date(invite.deadline_at) - Date.now()) / (1e3*60*60*24))
```

No null guard. Simulated in the page:

| `deadline_at` | `daysLeft` |
|---|---|
| `null` | **-20685** |
| `undefined` | **NaN** |
| `''` | **NaN** |

Both of O7's feared strings, exactly. And critically — **`daysLeft` is used in both branches of the ternary**, not just the overdue one:

- overdue → `Deadline passed ${Math.abs(daysLeft)} day(s) ago`
- **not overdue → `deadline in ${daysLeft} day(s)`** ← the common path

So this does **not** depend on `isOverdue` being wrongly true. Any invite row with a null `deadline_at` renders *"deadline in -20685 day(s)"* on the ordinary path.

**How a null `deadline_at` could arise.** The live `AssessmentInviteModal` has **no date picker** and never sends a `deadline_at` — it only interpolates `deadlineDays` into the email body (`Please complete this within ${deadlineDays || 2} day(s)`), and sends `{ method, subject, body }`. So `deadline_at` is computed server-side from the `assessment_deadline_days` setting. That makes the null case a **configuration** question, not an exotic one: if that setting is ever absent or null when an invite is sent, every invite row gets a null deadline and every drawer shows *"deadline in -20685 day(s)"*.

Note the modal's own fallback is `deadlineDays || 2` — the email body degrades gracefully to "2 day(s)" while the drawer does not. That asymmetry is the bug in miniature.

*(A `DatePicker` with `okButtonProps: { disabled: !assessDeadline }` does exist in `CandidatePipelinePrototype.jsx` — but that's the prototype page, not the live modal. Don't let it reassure you.)*

**To close O7 properly:** check what `assessment_deadline_days` is set to, send one invite, and confirm `deadline_at` lands non-null. That is a five-minute check and worth doing before the demo.

---

## ⊘ SCHED-18 (UI) — report modal — **not runnable**

No interview report exists anywhere to render. Checked every journey at a scheduled-interview stage:

| Journey | Candidate | Round | Booking status | Report |
|---|---|---|---|---|
| 40 | Phase3 Midflow Candidate | tech1 | `scheduled` | none |
| 8 | Anupam Kher | tech2 | `no_show` | none |
| 5 | SAURABH KUMAR | hr_round | `completed` | none |

Every booking carries only `scorecard_dispatched_at` — no report, feedback, or scorecard payload. Journey 5 is the furthest along and its drawer reads *"Awaiting Results — Interview held — scorecard link sent, awaiting the interviewer's feedback"*. The drawer exposes no report/scorecard/feedback control at all in this state.

**To close SCHED-18** an interviewer has to actually submit a scorecard first. Worth moving it under a "blocked — needs a submitted scorecard" heading alongside SCHED-11, rather than leaving it in Group 2 as a quick item; it isn't quick, and it isn't a UI bug.

---

## ⚠️ Cleanup I owe you

My DOC-05 probe left a real artifact:

**`rpa_candidate_documents` id 9** — `malware.pdf`, `status='uploaded'`, journey 27 (SAHIL SARMA), checklist item 3 (Government ID), uploaded 2026-08-20T11:22:17.572Z. The file is **in OneDrive** and is **visible on the candidate portal** as *"Government ID — Uploaded — under review"*. Contents are 4 bytes of MZ header, harmless in themselves.

It did **not** advance the journey — item 2 stayed `pending`, so DOC-07's last-item auto-close never fired. Stage is still `documents` / `in_progress`.

I left it in place rather than deleting or rejecting it, since rejecting a document may email the candidate. **Tell me how you want it cleared** and I'll do it.

The staged `.exe` on the form was removed and never uploaded (the 500 means nothing was written).

---

## Suggested edits to the checklist

1. **Group 2 shrinks from 5 items to 3.** O7 and SCHED-18 can't be run here; move them to *"Cannot be run at all"* with the specific blocker (no invite row / no submitted scorecard).
2. **Add D6, D7, D8** to the defect list. D7 and D6 are demo-relevant; D6 in particular fires during a live demo if a candidate picks the wrong file.
3. **N5's screen list should include the public upload page** — D8 is the same defect class on a surface N5 didn't cover.
4. The *"Found by this manual pass so far"* line needs updating: **three** defects becomes **six**.
