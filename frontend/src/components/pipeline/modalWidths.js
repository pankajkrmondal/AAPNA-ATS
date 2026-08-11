/**
 * One width scale for every Candidate Pipeline modal.
 *
 * Replaces per-modal magic numbers that had drifted to 440/480/560/620/720/820
 * with no rule behind them, leaving the busiest modals visibly cramped.
 *
 * The binding constraint is the branded email preview: wrapBrandedEmail()'s
 * shell (mirrored in common/EmailBodyEditor/brandedShell.js) is a fixed
 * 620px-wide table, and AntD's modal content padding costs ~48px, so any modal
 * hosting the email editor needs 620 + 48 = 668px MINIMUM just to avoid
 * squeezing it. Several were 560. Hence EMAIL, with real breathing room.
 *
 * FORM matches the candidate drawer (680) — the one surface confirmed to feel
 * right — so the two read as the same family.
 */
export const MODAL_WIDTH = {
  /** Short confirmations and small single-purpose forms. */
  CONFIRM: 560,
  /** Multi-field forms with no embedded email preview. Matches the drawer. */
  FORM: 680,
  /** Anything hosting the 620px branded email editor, or a wide report. */
  EMAIL: 820,
};

export default MODAL_WIDTH;
