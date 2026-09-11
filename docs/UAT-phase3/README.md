# UAT Phase 3 — HR Feedback Pack (Chhaya Verma & Naveen Satywali)

Source material in this folder:

| File | What it is |
|---|---|
| `Platform Feedback & Required Changes.docx` | Written UAT feedback sheet from Chhaya Verma (6 sections) |
| `MS Access _ Export.docx` | Transcript of the UAT review call — 10 Sep 2026, 12:05 PM, 1h 10m 40s. Attendees: Chhaya Verma, Naveen Satywali, Harish Mopuri, Pankaj Kumar Mondal |

Analysis produced from them:

| File | What it covers |
|---|---|
| [01-UAT-FEEDBACK-ANALYSIS.md](01-UAT-FEEDBACK-ANALYSIS.md) | Every feedback point, what Harish clarified on the call, current system behaviour in code, and the verdict (build / no build / workaround) |
| [02-BUILD-BACKLOG.md](02-BUILD-BACKLOG.md) | The items that need development — scope, acceptance criteria, code touch points, sizing, phase |
| [03-OPEN-DECISIONS-AND-ACTIONS.md](03-OPEN-DECISIONS-AND-ACTIONS.md) | Decisions still owed by HR, non-build actions, and demo/sign-off logistics |

## The one-paragraph summary

Of the 16 distinct points raised, **5 need no development** — Harish explained on the
call that the behaviour is either already present, deliberate, or a staging-only
artefact. **7 are straightforward builds** that fit before the Abhijit demo.
**2 are large** (JD tagging on upload; free-form stage skipping) — the second one
Harish explicitly asked to be re-confirmed in writing before any work starts,
because it changes the pipeline architecture. **2 are investigations** into
dashboard numbers that Harish could not explain on the call.

The single biggest gap, and the only one Chhaya labelled *mandatory*, is that
bulk/individual resume uploads are not tagged against a JD — so the link between
"this requisition" and "these candidates" does not exist in the data.

## Reading the "Harish said" markers

Harish Mopuri answered most of Chhaya's and Naveen's doubts live on the call.
Those answers change the verdict on several points — in some cases removing the
work entirely. Throughout [01-UAT-FEEDBACK-ANALYSIS.md](01-UAT-FEEDBACK-ANALYSIS.md)
they are called out as:

> **Harish clarified (hh:mm):** …

Read those before estimating anything. Three points that look like defects in the
written feedback sheet are not defects at all once his explanation is applied.
