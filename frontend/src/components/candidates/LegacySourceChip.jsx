/**
 * LegacySourceChip — the one way the legacy-import label is shown (Phase 4,
 * docs/Phase 4/SCOPE-Legacy-Source-Label-and-Filter.md).
 *
 * Says where the candidate came from by name: "MS Access" when the import
 * created the candidate, "Also in MS Access" when the candidate was already in
 * the ATS and the import only filled empty fields. Later "Excel" and
 * "Old resume" the same way. The wording comes from the API (`legacyLabel`), so
 * the screen and the CSV export always agree.
 *
 * Same place and size as ReferralChip, its own colour. One shared component so
 * that Candidate Screening and the Pipeline cards can use it later unchanged.
 *
 * `cvId` (candidate view only) adds a tooltip with the source table and import
 * date, fetched the first time it opens. The wide table passes no `cvId`.
 *
 * The API leaves the label out for vendors; the chip is not a permission check.
 */
import { useState } from 'react';
import { Tag, Tooltip } from 'antd';
import candidateService from '../../services/candidateService';
import { fmtDate } from '../../utils/dateFormat';

/** Colour per source, so the three imports are told apart at a glance. */
const SOURCE_COLOUR = { ms_access: 'geekblue', excel: 'cyan', resume: 'purple' };

const OUTCOME_TEXT = {
  inserted: 'created by the import',
  updated_existing: 'already in the ATS, empty fields filled',
  merged_in_file: 'duplicate row merged into this candidate',
};

/** Import rows behind the label, loaded on first request. */
function useImportDetail(cvId) {
  const [state, setState] = useState({ loading: false, rows: null, failed: false });

  const load = () => {
    if (!cvId || state.loading || state.rows) return;
    setState({ loading: true, rows: null, failed: false });
    candidateService.getLegacyImports(cvId)
      .then((res) => setState({ loading: false, rows: res.data?.data || [], failed: false }))
      .catch(() => setState({ loading: false, rows: null, failed: true }));
  };

  let content;
  if (state.failed) content = 'Could not load the import details.';
  else if (!state.rows) content = 'Loading…';
  else if (state.rows.length === 0) content = 'No import details on file.';
  else {
    content = (
      <div style={{ fontSize: 12 }}>
        {state.rows.map((r, i) => (
          <div key={i}>
            Table “{r.sourceTable}”, imported {fmtDate(r.importedAt)}: {OUTCOME_TEXT[r.outcome] || r.outcome}
          </div>
        ))}
      </div>
    );
  }
  return { load, content };
}

export default function LegacySourceChip({ label, source, cvId = null, compact = false }) {
  const detail = useImportDetail(cvId);
  if (!label) return null;

  const chip = (
    <Tag
      color={SOURCE_COLOUR[source] || 'blue'}
      data-testid="legacy-source-chip"
      style={{
        marginInlineEnd: 0,
        fontSize: compact ? 10 : 11,
        lineHeight: compact ? '16px' : '18px',
        paddingInline: compact ? 5 : 7,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Tag>
  );

  if (!cvId) return chip;
  return (
    <Tooltip title={detail.content} onOpenChange={(open) => { if (open) detail.load(); }}>
      {chip}
    </Tooltip>
  );
}
