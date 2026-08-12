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
// Query parsing lives in the dependency-free helpers module so it stays
// unit-testable — importing anything that reaches pipeline.service.js opens a
// Redis connection that never closes and hangs `node --test`.
import { parseAnalyticsParams } from '../services/pipelineAnalytics.helpers.js';

export { parseAnalyticsParams };

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
    // "Shortlist Rate (%)" is gone on purpose: it was 100% for every vendor by
    // construction. See the comment in pipeline.service.js's vendor block.
    // "Candidates In Pipeline" replaces the old "Submitted" header because it
    // counts journeys, not CVs sent — the old header implied the latter.
    columns: [
      { header: 'Vendor', key: 'vendor_email' },
      { header: 'Candidates In Pipeline', key: 'in_pipeline', numeric: true },
      { header: 'Hired', key: 'hired', numeric: true },
      { header: 'Rejected', key: 'rejected', numeric: true },
    ],
    pick: (a) => a.vendorPerformance,
  },

  source_of_hire: {
    label: 'Pipeline-Source-Of-Hire',
    // Buckets are mutually exclusive and sum to Submitted (see bucketFor).
    // The old "Shortlisted"/"Shortlist Rate" pair counted open journeys as
    // shortlisted and overlapped the other columns; the rate is now hire-based.
    columns: [
      { header: 'Source', key: 'source' },
      { header: 'Submitted', key: 'submitted', numeric: true },
      { header: 'In Progress', key: 'in_progress', numeric: true },
      { header: 'Hired', key: 'hired', numeric: true },
      { header: 'Rejected', key: 'rejected', numeric: true },
      { header: 'On Hold', key: 'on_hold', numeric: true },
      { header: 'Closed (Other)', key: 'closed_other', numeric: true },
      { header: 'Hire Rate (%)', key: 'hire_rate', numeric: true },
    ],
    pick: (a) => a.sourceOfHire,
  },
};

export const TABLE_KEYS = Object.keys(TABLES);

/**
 * Build the spec runExport needs for one table. Throws on an unknown key.
 *
 * @param {string} tableKey - one of TABLE_KEYS
 * @param {object} [query] - req.query, so the CSV honours the same filters the
 *   screen used. Defaults to {} so existing callers keep working unchanged.
 */
export function specFor(tableKey, query = {}) {
  const table = TABLES[tableKey];
  if (!table) return null;

  return {
    key: `pipeline_analytics_${tableKey}`,
    label: table.label,
    columns: table.columns,
    fetch: async () => {
      const analytics = await pipelineService.getPipelineAnalytics({
        ...parseAnalyticsParams(query),
        // topN: null — the export is the complete ranked list, not the screen's top 10.
        topN: null,
      });
      return table.pick(analytics) || [];
    },
  };
}

export default { TABLES, TABLE_KEYS, specFor, parseAnalyticsParams };
