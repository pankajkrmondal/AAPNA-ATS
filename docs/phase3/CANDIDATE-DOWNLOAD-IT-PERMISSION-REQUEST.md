# Microsoft Graph — File Read Access for "Candidate Complete Download"

**Audience:** IT / Microsoft 365 tenant administrators
**Date:** 2026-09-02 · **Revised 2026-09-02** after IT's response (Aasif Ansari, 2026-09-02 18:46)
**Companion to:** `docs/phase3/MS-GRAPH-SETUP-FOR-IT.md`
**App registrations:** **`HR_RPA`** (staging/dev) and **`HR_RPA_PROD`** (production)

---

## 0. Status — **CLOSED. No IT action needed.** Read test passed 2026-09-02

**The read test in §1 was run against staging on 2026-09-02 and passed.** Nothing further is required from
IT for the candidate dossier, and this document is now a record rather than a request.

What the test confirmed, app-only, against `HR_RPA` / `pkmondal@aapnainfotech.com`:

| Check | Result |
|---|---|
| Permissions actually on the token | `Calendars.ReadWrite`, `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `OnlineMeetingArtifact.Read.All`, `OnlineMeetingRecording.Read.All`, `OnlineMeetingTranscript.Read.All`, `OnlineMeetings.ReadWrite.All`, **`Sites.Selected`**, `User.Read.All` |
| `Files.Read.All` present? | **No** — correctly absent, as IT declined it |
| Read the drive | ✅ |
| Read the ATS folder by its stored item id (`015VOMPC…`) — "Resume_Test", 383 items | ✅ |
| Resolve a stored `cvFileUrl` to a drive item via `/shares/…` | ✅ — 18,406 bytes, correct filename |
| **Download the file content** | ✅ — 18,406 bytes returned, `content-type` `…wordprocessingml.document`, and the bytes begin `PK` (a real DOCX, not an HTML login page) |

So the existing `Sites.Selected` grant carries an effective **read** role on the ATS folders, exactly as IT
said. **Phase 2 (resumes and documents travelling inside the pack) is unblocked and needs no new grant.**

Production (`HR_RPA_PROD` / `recruitment@aapnainfotech.in`) has not been tested — the two registrations carry
identical grants, but the per-site role is granted separately per drive, so the same test should be re-run
there before Phase 2 ships to production.

---

## 0a. Original position — `Files.Read.All` withdrawn; we took IT's alternative

**IT has declined `Files.Read.All` on both app registrations**, on the grounds that it grants tenant-wide
read of every SharePoint site and every employee's OneDrive and cannot be scoped to one mailbox. **That is a
correct reading and we are not appealing it** — the permission was broader than the job needs, and we said so
when we asked for it (§3 of the original note).

IT proposed `Sites.Selected` scoped to specific folders, and stated:

> *"Sites.Selected — which is already configured and working for your and `recruitment` OneDrive on both
> HR_RPA and HR_RPA_PROD."*

**This is very likely all we need, and may need no new grant at all.** See §1.

### Correction to our earlier note

The first version of this document said `Sites.Selected` "covers SharePoint sites only, not personal
OneDrive". **That was wrong.** A OneDrive for Business account is backed by a SharePoint *personal site*
(`…-my.sharepoint.com/personal/…`), so `Sites.Selected` can be granted on it — which is exactly what IT has
already done. The recommendation in this document changed as a result.

---

## 1. Why this is almost certainly already solved

**The two app registrations carry identical permission grants** (confirmed 2026-09-02). They differ only in
the mailbox each one drives:

| App | Environment | Mailbox / drive owner |
|---|---|---|
| `HR_RPA` | staging / dev | `pkmondal@aapnainfotech.com` |
| `HR_RPA_PROD` | production | `recruitment@aapnainfotech.in` |

So the permission screenshot taken from `HR_RPA` describes production too, and the following chain holds for
both:

1. The ATS **already writes** to these OneDrive folders — every parsed resume
   (`onedrive.service.js` → `uploadFileToOneDrive()`) and every archived interview recording. Those uploads
   are app-only (client-credentials via `getAccessToken()`), and they work today.
2. Neither `Files.ReadWrite.All` nor `Sites.ReadWrite.All` is granted to **either** app.
3. Therefore the existing uploads are running on the `Sites.Selected` grant IT describes, with at least a
   **write** role on those drives.
4. Under `Sites.Selected`, a `write` role **includes read**.

**One unknown remains, and it is small:** the site-level role (`read` / `write` / `manage` / `fullcontrol`) is
not visible on the API-permissions screen for either app — per-site grants live outside it. Point 3 implies
write, but implies is not verifies.

**So the first action is a test, not a request.** An app-only `GET` of a file in the ATS folder returning 200
closes this item with no IT involvement. §2 answers IT's two questions regardless, so if the test fails the
grant can be extended without another round trip.

---

## 2. Answers to IT's two questions

> *"1. The exact SharePoint site URL or OneDrive folder you need to read files from
> 2. The purpose — what type of files does the app need to access?"*

### 2.1 Exact locations — two folders, one per environment

Both are **OneDrive folders the ATS itself created and already uploads into**. No SharePoint team site is
involved, and no other user's drive is needed.

| | Staging / dev — app `HR_RPA` | Production — app `HR_RPA_PROD` |
|---|---|---|
| **Drive owner** | `pkmondal@aapnainfotech.com` | `recruitment@aapnainfotech.in` |
| **Folder (drive item id)** | `015VOMPCPMTPAM74ASCVEYVZXTXXEZYOMJ` | `01G5FTREQK6XGR6VF3RVGJ2IJTJZNYXJ6P` |
| **Subfolders in scope** | `Document Collection/`, `Recordings_ATS/` | `Document Collection/`, `Recordings_ATS/` |
| **Set in** | `MS_ONEDRIVE_PARENT_ID` / `MS_DEFAULT_SENDER_EMAIL` | same, `.env.production` |

**Access level needed: `read`** on those folders. (The app already has effective write there — that is how
the resumes get uploaded in the first place.) Nothing outside these folders is needed, on any drive.

*Note the deliberate domain difference — staging is `aapnainfotech.com`, production is `aapnainfotech.in`.
Both are correct as configured; please don't normalise one to the other.*

### 2.2 Purpose — what the app reads and why

| File type | Where it came from | Why it is read back |
|---|---|---|
| **Candidate resumes** (PDF / DOCX) | Uploaded by the ATS itself when a resume is parsed | Attached to a dossier a recruiter emails to an **external interviewer** for a one-off Technical 3/4 round. The stored link is a SharePoint URL, so an outsider clicking it hits a login wall — the file has to travel inside the pack. |
| **Candidate-submitted documents** (ID, certificates) | Uploaded by candidates through the ATS document-collection link | Same pack, **off by default**, only when a recruiter explicitly opts in, and the opt-in is audited. |
| **Interview recording archive** (MP4) | Copied by the ATS from Teams | Played back to authorised reviewers; and, from a later phase, via a 14-day expiring link. |

Every one of these is a file **the ATS put there**. It never browses, lists or enumerates any drive — it reads
one specific item id at a time, taken from its own database.

---

## 3. Design change this prompts (our side, no IT action)

Reading by *sharing URL* (`GET /shares/{base64-url}/driveItem/content`) resolves a URL to an item and is the
awkward path under `Sites.Selected`. Reading by *item id* is direct and unambiguous:

```
GET /users/{drive-owner}/drive/items/{item-id}/content
```

`uploadFileToOneDrive()` already receives the full `item` object back from Graph and currently returns only
`item.webUrl`, discarding `item.id`. **We will persist the item id at upload time** and read back by id.

- New nullable columns beside the existing URL columns (`rpa_cv.cvFileUrl`, `rpa_candidate_documents.file_url`).
- Existing rows have no id: they fall back to the `/shares/` route once, and the resolved id is backfilled.
- This is strictly better regardless of permissions — a stored item id survives a file being renamed or moved,
  which a webUrl does not.

Recorded in `CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md` §6.3.

---

## 4. What we owe IT back

IT asked: *"Please test and confirm these are working as expected"* for
`OnlineMeetingRecording.Read.All` and `OnlineMeetingTranscript.Read.All`.

- [ ] **Recording fetch — staging.** IT's note that the recording grant is *"restricted to
      `recruitment@aapnainfotech.in` only"* describes **`HR_RPA_PROD`**, and is correct for production.
      Staging's `HR_RPA` is scoped to **`pkmondal@aapnainfotech.com`** — the mailbox its Teams application
      access policy was granted against (setup doc §3), and the one `MS_CALENDAR_MAILBOX` points at. Each app
      is scoped to its own environment's mailbox, which is the right configuration.
      **So this is a confirmation, not a suspected fault** — IT asked us to test, and it is worth doing before
      Phase 4 depends on it.
- [ ] **Transcript fetch.** Expected to still fail with *"Graph API access to transcripts is disabled for this
      tenant"* — that is the tenant switch in MS-GRAPH-SETUP-FOR-IT.md §3a, not a permission problem.
      Recordings are unaffected.
- [ ] **File read-back**, per §1 — the test that decides whether anything more is needed.

---

## 5. If the read test fails

Then we need one thing from IT, and it is small:

> On the existing `Sites.Selected` configuration for the two OneDrive accounts in §2.1, confirm the
> `HR_RPA` / `HR_RPA_PROD` app has the **`read`** role on that drive
> (`POST /sites/{site-id}/permissions` with role `read`, or PnP
> `Grant-PnPAzureADAppSitePermission -Permissions Read`).

No tenant-wide permission, no new consent, no change affecting any other employee account — which was IT's
stated requirement.

---

## 6. If none of this lands

The dossier still ships. It is generated from database content — profile, every round cleared, all
interviewer scorecards and consolidated feedback, assessment scores, interview history — and prints a line
saying the resume could not be attached and to request it from the recruiter. File attachment is the
difference between a complete pack and a recruiter sending a second email.

---

## 7. Checklist

- [x] ~~Add `Files.Read.All`~~ — **declined by IT 2026-09-02, withdrawn. Do not re-raise.**
- [x] **Developer:** test app-only read of a file in the §2.1 staging folder → **PASSED 2026-09-02** (§0)
- [x] ~~**IT, only if the read test fails:** confirm `read` role~~ — **not needed, the test passed**
- [x] **Developer:** persist OneDrive item ids at upload time (§3) — **DONE 2026-09-02.**
      `prisma/ddl/2026-09-02-onedrive-item-ids.sql` adds `rpa_cv.cv_file_item_id` and
      `rpa_candidate_documents.file_item_id`; `uploadFileToOneDriveDetailed()` stores the id, and
      `downloadDriveItem()` backfills legacy rows lazily on first read. Measured on staging: **7.7s**
      for the first read of a legacy row (resolve via `/shares/` + download), **0.8s** once the id is
      stored.
- [ ] **Developer:** re-run the read test against **production** (`HR_RPA_PROD`), and apply the same DDL
      there, before Phase 2 ships to production
- [ ] **Developer:** confirm recording/transcript fetch per §4

---

## Sources (Microsoft Learn)

- `Sites.Selected` / per-site permissions — https://learn.microsoft.com/en-us/graph/permissions-selected-overview
- Create site permission — https://learn.microsoft.com/en-us/graph/api/site-post-permissions
- Download driveItem content — https://learn.microsoft.com/en-us/graph/api/driveitem-get-content
