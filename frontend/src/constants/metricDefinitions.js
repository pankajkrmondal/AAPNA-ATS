/**
 * Metric definitions — one source of truth for what every dashboard number means.
 *
 * WHY A REGISTRY: the explanations used to be scattered as a local `KPI_TOOLTIPS`
 * const in Dashboard.jsx plus hardcoded `<Tooltip title="…">` strings across ten
 * widget files, with some widgets (LiveActivityFeed) explaining nothing at all. That
 * does not scale — and the backend insight work adds a dozen more metrics, each of
 * which needs a definition, a formula and a provenance note to be trustworthy.
 *
 * An enterprise dashboard's credibility rests on every number being able to explain
 * itself: what it counts, how it is derived, and which table it came from. Recruiters
 * challenge numbers, and "where does this come from?" needs an answer in the UI, not
 * in a spec document.
 *
 * Render these with <MetricInfo metric="…" />.
 *
 * @typedef {object} MetricDefinition
 * @property {string} label   Human name; should match the on-screen label.
 * @property {string} short   One-or-two sentence plain-language explanation.
 * @property {string} [formula] How it is computed, when that is not obvious.
 * @property {string} [source]  Where the data comes from — endpoint and/or table.
 * @property {string} [chart]   What an accompanying sparkline/graph plots, when the
 *   chart shows a different quantity from the headline number.
 * @property {string} [caveat]  Known limitation a reader should weigh.
 */

/** @type {Record<string, MetricDefinition>} */
export const METRICS = {
  // ── Headline KPIs ────────────────────────────────────────────────────────
  // NOTE on the KPI sparklines: the big number is a running TOTAL, while the line
  // beneath it is a RATE (new records per day, last 7 days). They are different
  // quantities, so each `chart` note below says exactly what its line plots — a
  // reader should never have to assume the line is the total's history.
  totalCandidates: {
    label: 'Total Candidates',
    short: 'Every CV in the system, across all roles and sources.',
    formula: 'Count of all candidate records, unfiltered by role or date.',
    source: 'GET /dashboard/stats · rpa_cv',
    chart: 'Line: new candidates added per day over the last 7 days.',
  },
  activeMRFs: {
    label: 'Active MRFs',
    short: 'Manpower Requisition Forms still open — pending, awaiting approval, or approved but not yet filled.',
    formula: 'approval_status in (pending, waiting, approved) AND filled_at is empty. '
      + 'The "awaiting approval" figure below it counts approval_status = pending on the same basis.',
    source: 'GET /dashboard/stats · rpa_mrf',
    chart: 'Line: requisitions raised per day over the last 7 days.',
    caveat: 'The line is drawn from the most recent batch of unsubmitted requisitions, '
      + 'so on a busy week it can under-count the earliest of the seven days. The headline '
      + 'and the "awaiting approval" figure are both full counts and are not affected.',
  },
  todayUploads: {
    label: "Today's Uploads",
    short: 'Candidate CVs added since midnight today.',
    formula: 'Count of candidates created at or after 00:00 local time.',
    source: 'GET /dashboard/stats · rpa_cv',
    chart: 'Line: uploads per day over the last 7 days, so today reads in context.',
  },
  shortlisted: {
    label: 'Shortlisted',
    short: 'Candidates moved to a shortlisted or selected stage of the pipeline.',
    formula: 'Count of shortlist records whose pipeline status is shortlisted or selected.',
    source: 'GET /dashboard/stats · rpa_shortlisted_candidates',
    chart: 'Line: candidates entering the pipeline per day over the last 7 days.',
  },

  // ── Widgets ──────────────────────────────────────────────────────────────
  hiringTrends: {
    label: 'Hiring Trends',
    short: 'Candidates added per day over the selected window, filtered by the role picker.',
    formula: 'Daily count of candidate records grouped by creation date.',
    caveat: 'Currently derived from the 200 most recent candidates in the browser, so it '
      + 'describes a sample rather than the full database. Server-side aggregation is planned.',
  },
  conversionFunnel: {
    label: 'Conversion Funnel',
    short: 'How many candidates survive each stage, from sourced through to hired.',
    formula: 'Sourced = all CVs; AI Screened = CVs with AI profile insights; '
      + 'Shortlisted = shortlist records not rejected; Hired = joined, offer accepted, or hired status.',
    source: 'GET /dashboard/stats · rpa_cv + rpa_shortlisted_candidates',
  },
  talentInsights: {
    label: 'Talent Insights',
    short: 'The most common applied-for roles and the most frequent skills across candidate profiles.',
    caveat: 'Computed in the browser from the 200 most recent candidates, not the full database.',
  },
  recruiterActivity: {
    label: 'Recruiter Activity',
    short: 'Per recruiter: how many candidates they added, versus how many they shortlisted to a role.',
    formula: 'Added counts uploads attributed to the recruiter; Shortlisted counts only '
      + 'shortlist actions — rejections are excluded even though both pick a role.',
    source: 'GET /dashboard/recruiter-breakdown',
    caveat: 'Uploads are attributed by email and shortlists by username; entries that match no '
      + 'user account (e.g. "Self Applied") appear under their raw label.',
  },
  actionCentre: {
    label: 'Needs Your Attention',
    short: 'Work waiting on you right now, each row linking to where it is actioned.',
  },
  awaitingScreening: {
    label: 'Awaiting screening',
    short: 'Candidates sourced but not yet AI-screened.',
    formula: 'Sourced minus AI Screened from the conversion funnel.',
  },
  interviewsToday: {
    label: 'Interviews today',
    short: 'Interviews scheduled with a start time falling today.',
    source: 'GET /screening/analytics/pipeline',
  },
  liveActivity: {
    label: 'Live Activity',
    short: 'Pipeline events streaming in over the websocket as they happen — uploads, '
      + 'screening decisions and stage changes.',
    caveat: 'Live only. It starts empty on each page load and is not a historical log.',
  },
  upcomingInterviews: {
    label: 'Upcoming Interviews',
    short: 'Scheduled interviews over the next seven days, soonest first.',
    source: 'GET /screening/analytics/pipeline · rpa_interview_schedule',
  },
  latestUploads: {
    label: 'Latest uploads',
    short: 'The five most recently added candidates. Open Search Candidate for the full, searchable list.',
    source: 'GET /dashboard/recent-uploads',
  },
};

/**
 * @param {string} key
 * @returns {MetricDefinition|null}
 */
export function getMetric(key) {
  return METRICS[key] || null;
}

export default METRICS;
