# T5: Drag and drop on the board (plan §6 phase 5)

## Test plan

**Scope.** `@dnd-kit/core` 6.3.1 on the Candidate Pipeline board (`Pipeline.jsx`): draggable cards (`DraggableCard`), droppable columns (`DroppableColumn`), drag overlay, edge auto-scroll inside the horizontal board, the shared confirmation popup on drop, optimistic move with rollback on refusal.

**Rules under test.**
- A locked card cannot be picked up.
- While dragging, the card's current column and every stage it already passed are greyed out and refuse the drop; the column under the pointer is outlined.
- A plain click on a card still opens the drawer (6 px travel before a drag starts).
- Dropping on a valid column opens the popup; nothing moves until "Yes, move".

**Approach.** Playwright mouse drag (`browser_drag`, or mouse down / move / up via `browser_run_code_unsafe`) on staging fixture cards.

## Test cases

| ID | Case | Steps | Expected |
|---|---|---|---|
| T5-01 | Click still opens drawer | Click a card | Drawer opens; no drag |
| T5-02 | Drag starts | Mouse down on a card, move 20 px | Overlay card follows the pointer; source card dims |
| T5-03 | Greyed columns | During T5-02 | Current column and passed stages `data-drop-state=invalid` (greyed); others `valid` |
| T5-04 | Drop → popup | Drop on Technical Round 1 | Popup with From/To/direction; nothing moved yet |
| T5-05 | Drop → cancel | Cancel in the popup | Card stays in its column |
| T5-06 | Drop → confirm | Drop again, "Yes, move" | Card appears in the target column immediately; toast; board refresh keeps it there |
| T5-07 | Drop on invalid column | Drop on a passed stage / own column | No popup; nothing moves |
| T5-08 | Locked card | Try to drag a locked card | Does not pick up (`data-locked=true`); lock tooltip available |
| T5-09 | Edge auto-scroll | Drag towards the right edge of the board | Board scrolls to reveal Documents / Offer |
| T5-10 | Rollback on 409 (scenario 10) | Tab A moves the candidate; tab B (stale) drags and confirms | Tab B: card snaps back; error toast "Someone else moved this candidate…" |
| T5-11 | Accidental move undo (scenario 8) | Drop on wrong column, confirm, drag straight back, confirm | Both moves succeed; both appear in Stage history and Move history |
| T5-12 | Move button doesn't drag | Press the swap icon | Opens the menu; no drag starts |
| T5-13 | Flag off | Flag off, reload | No drag; no swap icons; no hint line |

## Results log

### Run 1: 16 Oct 2026

| ID | Result | Notes |
|---|---|---|
| Build | PASS | `@dnd-kit/core@6.3.1` installed in `frontend/` (exact version); `npx vite build` succeeds |
| T5-01 to T5-13 | BLOCKED | Backend cannot start: staging DB unreachable |

### Run 2: 16 Oct 2026 (staging, Playwright real mouse drags, 1920×1080, flag on)

| ID | Result | Notes |
|---|---|---|
| T5-01 | PASS | Clicking a card opens the drawer (6 px drag threshold) |
| T5-02 | PASS | Overlay card follows the pointer; source card dims. `screenshots/T5-03-dragging.png` |
| T5-03 | FAIL → FIXED → PASS | Drop states correct (own column + passed stages `invalid`). **Issue #1:** columns were 414-508 px instead of 260 px — one long nowrap line (vendor email) widened its flex column, and the board's arrow step assumes 260+12 px. Fixed with `minWidth: 0` on the column. Re-test: all 11 columns 260 px (flag on and off) |
| T5-04 | PASS | Drop on HR Screening → popup "BACKWARD" |
| T5-05 | PASS | Cancel keeps the card |
| T5-06 | PASS | Confirm: card in the target column at once, stays after refresh |
| T5-07 | FAIL → FIXED → PASS | **Issue #5:** dropping on the greyed (passed) Functional column opened a popup for IQ / Tech Assessment, the neighbouring column the dragged card overlapped (dnd-kit's default rectangle collision skips disabled columns). Fixed: pointer-based collision (`boardCollision`, keyboard keeps rectangles). Re-test: drop on the greyed column → no popup, nothing moves. `screenshots/T5-07-passed-column-greyed.png` |
| T5-08 | PASS | Locked card (`data-locked=true`) cannot be picked up; lock tooltip |
| T5-09 | PASS | Dragging to the right edge auto-scrolled the board to the end (scrollLeft 0 → 1806); Offer in view; Escape cancelled the drag, no popup |
| T5-10 | PASS | Scenario 10: tab B loaded, candidate moved elsewhere, tab B dragged + confirmed → card jumped at once, then 409 toast "Someone else moved this candidate…", board settled on the real column (Assessment). `screenshots/T5-10-stale-tab-409.png` |
| T5-11 | PASS | Scenario 8: 2369 HR → Tech 1, then dragged straight back; both moves in Stage history and Move history |
| T5-12 | PASS | Pressing the swap button opens the menu, no drag, no drawer |
| T5-13 | PASS | Flag off: no draggables, no swap/lock icons, no hint (see T7-05) |
