# Pipeline Prototype v6 — Invite/Outcome/Decision + Editable Outcome Emails

Scope: `frontend/src/pages/PipelinePrototype.jsx`, continuing the frontend-only
Phase 3 walkthrough prototype (mock data, no backend). v5 added AI touches;
this pass replaces the generic "an email will be sent" notice with a real,
editable outcome email wherever the recruiter makes a decision.

---

## 1. Approve/Hold/Reject → decision modal with a real, editable email

The existing "Record round outcome" modal (outcome radio + reason + notes)
previously ended with a static info line: *"Automated outcome email →
{audience}. Logged with open tracking."* That's now a full **Subject +
Body** draft, pre-filled from a template function (`emailDraftFor`) and
editable before send:

- **Hold** → drafts from the real **"Application On Hold"** template
  (`backend/prisma/seed-email-templates.js`, `id 18`), shown as a blue
  `Template — Application On Hold (#18)` tag.
- **Reject** → drafts from the real **"Rejection — Post Interview"**
  template (`id 4`), same tag treatment.
- **Approve** → **no matching template exists** in
  `seed-email-templates.js` for "approved / moving to next stage" (the
  seed file has shortlist, rejection, and on-hold templates, but nothing
  for a mid-pipeline round approval). The modal shows an editable draft
  tagged **`Draft — no template yet`** in orange, plus a warning banner
  calling out the gap explicitly rather than silently reusing an unrelated
  template.

Switching the outcome radio inside the modal regenerates the draft for the
newly selected outcome (`openOutcomeModal`, reused for both the round-action
buttons and the in-modal radio group). `saveOutcome()` now logs the actual
edited subject and template/draft status into the round's email timeline,
e.g. `Outcome email "Application on Hold - AAPNA Infotech" → candidate
(template: Application On Hold #18, edited before send)`.

## 2. Offer stage: "Close candidate record" → confirm modal, same pattern

Previously a single danger button closed the record immediately with a
generic `message.info` toast. It now opens a confirm modal
(`closeOpen`/`closeStatus`/`closeSubject`/`closeBody`) that:
- Restates the candidate and the selected closure status (Joined /
  Candidate Withdrawn / Did Not Join / Backed Out / Joined and Left /
  Rejected / On Hold — unchanged list, now a controlled `Select`).
- Shows the same editable Subject + Body pattern as the decision modal,
  tagged **`Draft — no template yet`** — there's no seeded template for a
  closure email either, and the modal says so via the tag rather than
  implying one exists.
- Warns that closing removes the candidate from the board with no undo in
  this prototype.

Only on confirming the modal does the candidate actually get filtered out
of `candidates` state — closing is no longer a single irreversible click.

## 3. What stayed the same

- The outcome radio options, mandatory-reason validation
  (`okButtonProps={{ disabled: outcome !== 'approved' && !reason }}`), and
  the reason dropdown are unchanged.
- Vendor dual-send framing (`mailAudience()`) is unchanged — the modal still
  addresses "candidate + {vendor}" where applicable.
- No backend call is made anywhere here; `emailDraftFor` / `closureEmailDraft`
  are pure string builders in component/module scope, and "sending" is still
  a mocked `message.success/info/warning` + a timeline entry.

---

## Flagged gap (carried forward, not just a prototype detail)

Real template coverage in `seed-email-templates.js` today has **shortlist**,
**rejection**, and **on-hold** templates, but nothing for a stage approval
that just moves a candidate forward, and nothing for record closure. If M1
(the real Pipeline Tracker build, `docs/phase3/03-DEVELOPMENT-PLAN.md`) ships
one outcome email per stage×outcome via `rpa_stage_email_templates`, these
two gaps need real templates before go-live — this prototype's "Draft — no
template yet" tag is the intentional placeholder for that decision.
