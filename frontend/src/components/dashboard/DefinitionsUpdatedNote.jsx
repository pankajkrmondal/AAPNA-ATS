/**
 * DefinitionsUpdatedNote — tells dashboard users why the numbers moved (N36).
 *
 * The dashboard now counts every candidate (not the newest 200) and uses the
 * pipeline's own rules for Shortlisted and Hired, so several figures change
 * visibly on release. The note shows for SHOW_DAYS after DEFINITIONS_UPDATED_ON
 * and can be dismissed; the dismissal is remembered per browser.
 *
 * RELEASE STEP: set DEFINITIONS_UPDATED_ON to the production release date.
 */
import { useState } from 'react';
import { Alert } from 'antd';
import { fmtDate } from '../../utils/dateFormat';

export const DEFINITIONS_UPDATED_ON = '2026-10-19';
const SHOW_DAYS = 14;
const STORAGE_KEY = `dashboard.definitionsNote.dismissed.${DEFINITIONS_UPDATED_ON}`;

const readDismissed = () => {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
};

export default function DefinitionsUpdatedNote() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const expired = Date.now() > new Date(`${DEFINITIONS_UPDATED_ON}T00:00:00+05:30`).getTime() + SHOW_DAYS * 24 * 60 * 60 * 1000;
  if (dismissed || expired) return null;

  const onClose = () => {
    setDismissed(true);
    try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* private window: shows again next visit */ }
  };

  return (
    <Alert
      type="info"
      showIcon
      closable
      onClose={onClose}
      style={{ marginBottom: 16 }}
      data-testid="dashboard-definitions-note"
      message={`Dashboard definitions updated on ${fmtDate(DEFINITIONS_UPDATED_ON)}`}
      description="The graphs now count every candidate (they used to sample the latest 200). Shortlisted means candidates in the pipeline now, and Hired uses the same rule as Recruitment Analytics, so some numbers have changed. Hover the ⓘ next to any number to see how it is counted."
    />
  );
}
