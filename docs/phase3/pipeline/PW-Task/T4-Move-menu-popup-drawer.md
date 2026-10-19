# T4: "Move to…" menu, confirmation popup, drawer (plan §6 phase 4)

## Test plan

**Scope.**
- Card "Move to…" menu (swap icon on each card) and drawer "Move to…" button.
- Confirmation popup (`MoveStageModal.jsx`): candidate, From, To, FORWARD/BACKWARD tag with "(skips N stages)", "Skipped" line, "No email" line, "recorded under your name" line, extra warning for a jump into Documents/Offer, Cancel focused by default, no reason field.
- Locked card shows a lock icon with the reason in a tooltip; drawer "Move to…" disabled with the reason.
- Passed stages disabled in both menus.
- Drawer stage strip shows real states (passed green, skipped dashed, current, not visited grey).
- Drawer "Stage history" timeline.
- Approve modal landing picker under the flag (next not-passed stage pre-selected; any not-passed stage selectable).
- Withdraw Evalground / Cancel document request dialogs (behaviour covered in T3).

**Approach.** Playwright against `http://localhost:5173/pipeline`, logged in as a staff user with Candidate Pipeline access; staging fixture candidates only.

## Test cases

| ID | Case | Steps | Expected |
|---|---|---|---|
| T4-01 | Hint line | Open /pipeline with the flag on | "Drag a card to any stage…" hint visible |
| T4-02 | Menu items | Click a not-started card's swap icon | Every stage except the current one; passed stages disabled with "— passed" |
| T4-03 | Popup content (scenario 1) | HR Screening card → Technical Round 1 | Popup: From HR Screening (Zeko), To Technical Round 1, tag "FORWARD (skips 2 stages)", "HR Screening (Zeko) will be marked Skipped…", "No email…", "recorded under your name" |
| T4-04 | Cancel default | Popup open, press Enter | Popup closes; nothing moves |
| T4-05 | Cancel button | Click Cancel | Nothing moves; no network call to /move |
| T4-06 | Confirm | Click "Yes, move" | Card moves to Tech 1 at once; toast "… moved to Technical Round 1. No email was sent." |
| T4-07 | Backward styling | Move back | Tag "BACKWARD" in orange; confirm button in danger style |
| T4-08 | Offer warning (scenario 7) | HR Screening → Offer | Extra line "This moves the candidate to Offer without the interview rounds in between." |
| T4-09 | Locked card | Card with a booked interview | Lock icon instead of the swap icon; tooltip shows the reason |
| T4-10 | Drawer Move to… | Open the drawer, Move to… → a stage | Same popup; after confirm the drawer refreshes to the new stage |
| T4-11 | Drawer locked | Drawer of a locked candidate | "Move to…" disabled; tooltip with the reason |
| T4-12 | Stage strip states | Drawer after T4-06 | HR Screening dashed (skipped), Tech 1 current, others grey; legend line shown |
| T4-13 | Stage history | Drawer, "Stage history" panel | Entries for entered, moved (with user and time), outcomes, notes, oldest first |
| T4-14 | Approve picker | Approve a stage whose next stage was passed earlier | Picker pre-selects the next not-passed stage; passed stages not offered; backward choices labelled |
| T4-15 | 409 rollback | Make the card locked from another tab, then move it here | Card snaps back; error toast with the server message |
| T4-16 | Console clean | Throughout | No new React errors/warnings in the console |

## Results log

### Run 1: 16 Oct 2026

| ID | Result | Notes |
|---|---|---|
| Build | PASS | `npx vite build` succeeds with the new components |
| T4-01 to T4-16 | BLOCKED | Backend cannot start: staging DB unreachable |

### Run 2: 16 Oct 2026 (staging, Playwright 1920×1080, flag on)

| ID | Result | Notes |
|---|---|---|
| T4-01 | PASS | Hint line and "Move history" button shown. `screenshots/T4-01-board-flag-on.png` |
| T4-02 | PASS | Menu lists the 10 other stages; passed stages disabled "— passed" (2374) |
| T4-03 | PASS | Popup text exactly as plan C8: From/To, "FORWARD (skips 2 stages)", Skipped / No email / recorded lines. `screenshots/T4-03-popup-forward.png` |
| T4-04 | PASS | Cancel holds focus; Enter closed the popup, 0 calls to /move, card stayed |
| T4-05 | PASS | Cancel: nothing moves |
| T4-06 | PASS | Card in Tech 1 within 250 ms (before the server answered); toast "Flex Fresh A moved to Technical Round 1. No email was sent." |
| T4-07 | PASS | Backward: tag "BACKWARD" (orange), confirm button danger-styled. `screenshots/T4-07-popup-backward.png` |
| T4-08 | FAIL → FIXED → PASS | **Issue #2:** the swap button's "Move to…" tooltip stayed up over the open menu and swallowed the click on "Offer". Fixed in `CardMoveControl` (tooltip hidden while the menu is open). Re-test: tooltip count 0, "FORWARD (skips 9 stages)" + "This moves the candidate to Offer without the interview rounds in between." `screenshots/T4-08-popup-offer-warning.png` |
| T4-09 | FAIL → FIXED → PASS | Lock icon + reason tooltip shown. **Issue #3:** dnd-kit put `aria-disabled="true"` on a locked card's wrapper, so the whole card (incl. click-to-open) read as disabled to assistive tech and Playwright. Fixed in `DraggableCard` (no drag attributes on a locked card). Re-test: card opens, `aria-disabled` absent, tooltip "Offer shared on 16 Oct 2026." |
| T4-10 | PASS | Drawer "Move to…" → same popup → moved 2374 Tech 2 → Assessment; drawer refreshed (≈5 s against the remote DB) |
| T4-11 | FAIL → FIXED → PASS | **Issue #4:** the drawer's locked "Move to…" never showed its reason (a disabled button fires no mouse events). Fixed by wrapping it in a span. Re-test: hover shows "Offer shared on 16 Oct 2026." `screenshots/T4-11-drawer-locked.png`. **Issue #6:** after "Mark as sent manually" the drawer kept offering "Move to…" (server and board were locked) because the invite mutation did not reload the drawer detail. Fixed (`inviteMutation` invalidates `pipeline-detail`). Re-test on 2375: drawer locked ≈5 s after the invite |
| T4-12 | PASS | 2370 strip: HR dashed (skipped), Offer current, others grey + legend. `screenshots/T4-12-drawer-strip-history.png` |
| T4-13 | PASS | Stage history: "Entered HR Screening (Zeko)", "16 Oct 2026, 4:55 pm · pankaj — Moved forward from HR Screening (Zeko) to Offer (skipped 9 stages)" |
| T4-14 | PASS | 2374 Approve on Assessment: "(x) Technical Round 2 (next stage not yet passed) · skipped earlier", then Tech 3 … Offer; passed stages not offered. `screenshots/T4-14-approve-landing.png` |
| T4-15 | PASS | See T5-10 (409 rollback) |
| T4-16 | PASS | Console: only pre-existing antd deprecation warnings and the 400/409s the tests provoked on purpose |
