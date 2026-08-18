/**
 * Metric definitions — one source of truth for what every dashboard number means.
 *
 * WHY A REGISTRY: the explanations used to be scattered as a local `KPI_TOOLTIPS`
 * const in Dashboard.jsx plus hardcoded `<Tooltip title="…">` strings across ten
 * widget files, with some widgets (LiveActivityFeed) explaining nothing at all. That
 * does not scale — and the backend insight work adds a dozen more metrics, each of
 * which needs a definition and a provenance note to be trustworthy.
 *
 * An enterprise dashboard's credibility rests on every number being able to explain
 * itself: what it counts, how it is derived, and where it came from. Recruiters
 * challenge numbers, and "where does this come from?" needs an answer in the UI, not
 * in a spec document.
 *
 * WRITE THESE FOR RECRUITERS, NOT FOR ENGINEERS. Every string below is rendered
 * verbatim to whoever hovers the info icon. They previously carried endpoint paths
 * (`GET /dashboard/stats`), table names (`rpa_cv`), column-level SQL
 * (`approval_status in (pending, waiting, approved)`) and roadmap notes ("server-side
 * aggregation is planned") — none of which mean anything to the person reading the
 * dashboard, and the roadmap note actively undermined trust in the number it
 * described. The technical provenance is kept in the `// dev:` comments beside each
 * entry, which is where the people who need it are already looking.
 *
 * Render these with <MetricInfo metric="…" />.
 *
 * @typedef {object} MetricDefinition
 * @property {string} label   Human name; should match the on-screen label.
 * @property {string} short   One-or-two sentence plain-language explanation.
 * @property {string} [formula] How it is counted, in plain English, when that is not
 *   obvious from the label.
 * @property {string} [source]  Where the data comes from, named the way a recruiter
 *   would name it ("Candidate records", "Approved requisitions") — never an endpoint.
 * @property {string} [chart]   What an accompanying graph plots, when the graph shows
 *   a different quantity from the headline number. Cards whose graph follows the date
 *   range pass a live sentence to <MetricInfo chart="…"> instead of setting this.
 * @property {string} [caveat]  Known limitation a reader should weigh — phrased as
 *   something to keep in mind, not as an apology or a to-do.
 */

/** @type {Record<string, MetricDefinition>} */
export const METRICS = {
  // ── Headline KPIs ────────────────────────────────────────────────────────
  // NOTE on the KPI graphs: three of the four cards show a RATE (new records per day)
  // beneath a running TOTAL. They are different quantities, so Dashboard.jsx passes
  // each card a live `chart` sentence naming both the quantity and the selected date
  // range — a reader should never have to assume the line is the total's history.
  totalCandidates: {
    label: 'Total Candidates',
    short: 'Every CV in the system, across all roles and sources.',
    formula: 'A count of every candidate record, whatever the role or the date it was added.',
    source: 'Your candidate database.', // dev: GET /dashboard/stats · rpa_cv
  },
  activeMRFs: {
    label: 'Active MRFs',
    short: 'Manpower Requisition Forms still open — pending, awaiting approval, or approved but not yet filled.',
    formula: 'Requisitions that have not been filled and have not been rejected or withdrawn. '
      + 'The "awaiting approval" figure below it counts the ones still waiting on an approver.',
    // dev: approval_status in (pending, waiting, approved) AND filled_at IS NULL,
    // counted server-side in dashboard.service.js getStats() · rpa_mrf.
    source: 'Your requisition records.',
    caveat: 'The graph is drawn from the most recent batch of open requisitions, so in a very '
      + 'busy period it can under-count the earliest days shown. The headline number and the '
      + '"awaiting approval" figure are full counts and are never affected.',
  },
  todayUploads: {
    label: "Today's Uploads",
    short: 'Candidate CVs added since midnight today.',
    formula: 'A count of candidates added at or after 00:00 today, in your local time.',
    source: 'Your candidate database.', // dev: GET /dashboard/stats · rpa_cv
  },
  shortlisted: {
    label: 'Shortlisted',
    short: 'Candidates moved to a shortlisted or selected stage of the pipeline.',
    formula: 'A count of shortlist entries currently sitting at shortlisted or selected.',
    source: 'Your shortlist and interview pipeline.', // dev: rpa_shortlisted_candidates
  },

  // ── Widgets ──────────────────────────────────────────────────────────────
  hiringTrends: {
    label: 'Hiring Trends',
    short: 'Candidates added per day over the period you have selected, for the role you have selected.',
    formula: 'Each bar in the line is the number of candidates added on that day.',
    source: 'Your candidate database.',
    caveat: 'Based on the 200 most recently added candidates, so a long period reaching further '
      + 'back than those 200 cover may under-count its earliest days.',
  },
  conversionFunnel: {
    label: 'Conversion Funnel',
    short: 'How many candidates survive each stage, from sourced through to hired.',
    formula: 'Sourced is every CV; AI Screened is those the AI has profiled; Shortlisted is those '
      + 'on a shortlist and not rejected; Hired is those who joined or accepted an offer.',
    source: 'Your candidate database and shortlist records.',
    // dev: GET /dashboard/stats · rpa_cv + rpa_shortlisted_candidates
  },
  talentInsights: {
    label: 'Talent Insights',
    short: 'The roles candidates apply for most often, and the skills that come up most often across their profiles.',
    source: 'Your candidate profiles.',
    caveat: 'Based on the 200 most recently added candidates rather than the whole database, so it '
      + 'describes what is arriving now rather than everything you have ever received.',
  },
  recruiterActivity: {
    label: 'Recruiter Activity',
    short: 'For each recruiter: how many candidates they added, next to how many they shortlisted to a role.',
    formula: 'Added counts the CVs that person uploaded. Shortlisted counts the candidates they put '
      + 'forward for a role — rejections are not counted, even though rejecting also picks a role.',
    source: 'Upload history and shortlist history, matched to the same person wherever both can be. '
      + 'These are full counts across the whole database.',
    // dev: GET /dashboard/recruiter-breakdown — rpa_cv.last_action_by (email) and
    // rpa_shortlisted_candidates.shortlisted_by (username) both resolved against rpa_users.
    caveat: 'Entries that belong to no user account — "Self Applied", for instance — are listed '
      + 'under that label rather than hidden.',
  },
  actionCentre: {
    label: 'Needs Your Attention',
    short: 'Work waiting on you right now. Each row opens the screen where it gets actioned.',
  },
  awaitingScreening: {
    label: 'Awaiting screening',
    short: 'Candidates who have been sourced but not yet screened by the AI.',
    formula: 'Everyone sourced, minus everyone already AI screened.',
  },
  interviewsToday: {
    label: 'Interviews today',
    short: 'Interviews with a start time falling today.',
    source: 'Your interview schedule.', // dev: GET /screening/analytics/pipeline
  },
  liveActivity: {
    label: 'Live Activity',
    short: 'Pipeline events as they happen — uploads, screening decisions and stage changes — '
      + 'arriving without a page refresh.',
    caveat: 'This is a live ticker, not a history log. It starts empty each time you open the '
      + 'dashboard and fills as things happen.',
  },
  upcomingInterviews: {
    label: 'Upcoming Interviews',
    short: 'Interviews scheduled over the next seven days, soonest first.',
    source: 'Your interview schedule.', // dev: GET /screening/analytics/pipeline
  },
  latestUploads: {
    label: 'Latest uploads',
    short: 'The five most recently added candidates. Open Search Candidates for the full, searchable list.',
    source: 'Your candidate database.', // dev: GET /dashboard/recent-uploads
  },
  dateRange: {
    label: 'Date range',
    short: 'Sets the period every graph on this page covers — the four card graphs and Hiring Trends.',
    caveat: 'The big numbers on the cards are lifetime totals and stay the same whichever period '
      + 'you pick. Only the graphs and the wording beneath them follow this control.',
  },
  roleFilter: {
    label: 'Role filter',
    short: 'Narrows the graphs to one role, so you can see how a single position is tracking.',
    caveat: 'The big numbers on the cards cover all roles and do not change. The card graphs, '
      + 'Hiring Trends and Talent Insights all follow this filter.',
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
