/**
 * Pipeline analytics CSV exports — one endpoint, several tables, chosen with
 * `?table=`.
 *
 * The tables on screen are top-10 summaries (pipeline.service.js caps the
 * ranked lists). These exports pass `topN: null` for the COMPLETE ranked list,
 * because a 10-row CSV is useless for the analysis someone exports in order to
 * do. The UI says so in its success toast rather than leaving the difference
 * to be discovered.
 *
 * getPipelineAnalytics() already loads every journey to compute all of these,
 * so serving one table per request adds no new query load.
 */
import * as pipelineService from '../services/pipeline.service.js';

/** table key -> { label, columns, pick } */
export const TABLES = {
  funnel: {
    label: 'Pipeline-Funnel',
    columns: [
      { header: 'Stage', key: 'label' },
      { header: 'Candidates Reached', key: 'count', numeric: true },
    ],
    pick: (a) => a.funnel.stages,
  },

  stuck: {
    label: 'Pipeline-Stuck-Candidates',
    columns: [
      { header: 'Pipeline ID', key: 'pipeline_id' },
      { header: 'Candidate', key: 'candidate_name' },
      { header: 'Stage', key: 'stage' },
      { header: 'Days In Stage', key: 'days', numeric: true },
      { header: 'Blocked On', key: 'blocked_on' },
    ],
    pick: (a) => a.stuckCandidates,
  },

  rejection_reasons: {
    label: 'Pipeline-Rejection-Reasons',
    columns: [
      // Free-text "Other" reasons already arrive as the typed text, never the
      // word "Other" — see the rejection-reason mapping in pipeline.service.js.
      { header: 'Reason', key: 'reason' },
      { header: 'Count', key: 'count', numeric: true },
      { header: 'Most Common Stage', key: 'most_common_stage' },
    ],
    pick: (a) => a.rejectionReasons,
  },

  time_to_hire: {
    label: 'Pipeline-Time-To-Hire',
    columns: [
      { header: 'Stage', key: 'label' },
      { header: 'Average Days', key: 'avg_days', numeric: true },
    ],
    pick: (a) => a.timeToHire.stages,
  },

  vendor_performance: {
    label: 'Pipeline-Vendor-Performance',
    columns: [
      { header: 'Vendor', key: 'vendor_email' },
      { header: 'Submitted', key: 'submitted', numeric: true },
      { header: 'Shortlisted', key: 'shortlisted', numeric: true },
      { header: 'Shortlist Rate (%)', key: 'shortlist_rate', numeric: true },
    ],
    pick: (a) => a.vendorPerformance,
  },

  source_of_hire: {
    label: 'Pipeline-Source-Of-Hire',
    columns: [
      { header: 'Source', key: 'source' },
      { header: 'Submitted', key: 'submitted', numeric: true },
      { header: 'Shortlisted', key: 'shortlisted', numeric: true },
      { header: 'Rejected', key: 'rejected', numeric: true },
      { header: 'On Hold', key: 'on_hold', numeric: true },
      { header: 'Shortlist Rate (%)', key: 'shortlist_rate', numeric: true },
    ],
    pick: (a) => a.sourceOfHire,
  },
};

export const TABLE_KEYS = Object.keys(TABLES);

/** Build the spec runExport needs for one table. Throws on an unknown key. */
export function specFor(tableKey) {
  const table = TABLES[tableKey];
  if (!table) return null;

  return {
    key: `pipeline_analytics_${tableKey}`,
    label: table.label,
    columns: table.columns,
    fetch: async () => {
      // topN: null — the export is the complete ranked list, not the screen's top 10.
      const analytics = await pipelineService.getPipelineAnalytics({ topN: null });
      return table.pick(analytics) || [];
    },
  };
}

export default { TABLES, TABLE_KEYS, specFor };
