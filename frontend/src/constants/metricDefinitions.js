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

  // ── Analytics page (/analytics) ──────────────────────────────────────────
  // Added in Phase 2 of the Aurora Glass rollout, ahead of Phase 6 swapping the
  // page's ad-hoc tiles for the shared StatCard. Those four tiles carry no
  // explanation of any kind today — the numbers most likely to be challenged in
  // a review meeting are the ones with nothing behind them.
  activeInPipeline: {
    label: 'Active in pipeline',
    short: 'Candidates currently moving through a hiring process — not yet hired, rejected or withdrawn.',
    formula: 'A count of candidates sitting at any live stage. Anyone whose journey has closed, '
      + 'whichever way it closed, drops out of this number.',
    source: 'Your pipeline records.', // dev: GET /screening/analytics · tiles.active_in_pipeline
  },
  awaitingFeedback: {
    label: 'Awaiting feedback',
    short: 'Candidates who have been interviewed but whose interviewer has not submitted a scorecard yet.',
    formula: 'Counts candidates, not scorecards. A panel round issues one card per interviewer, '
      + 'so the number of outstanding cards can be higher than the number of candidates — when it '
      + 'is, the card count is shown beside the tile.',
    source: 'Your interview scorecards.', // dev: tiles.awaiting_feedback / awaiting_feedback_cards
    caveat: 'This is who you are waiting on, not how late they are. A scorecard issued an hour ago '
      + 'counts the same as one issued last week.',
  },
  onHoldOverThreshold: {
    label: 'On hold too long',
    short: 'Candidates parked on hold for longer than the threshold you pick beside the tile.',
    formula: 'Counts candidates whose hold has lasted more than the selected number of days — '
      + 'the ones likely to need chasing. Lower the threshold to catch holds sooner, raise it to '
      + 'see only the worst cases.',
    source: 'Your pipeline records.', // dev: tiles.on_hold_over_threshold · hold_threshold_days
    caveat: 'The threshold affects this tile only. Nothing else on the page changes with it.',
  },
  offersPending: {
    label: 'Offers pending',
    short: 'Offers that have gone out and are still waiting on the candidate to accept or decline.',
    formula: 'Counts candidates at the offer stage whose offer has neither been accepted nor turned down.',
    source: 'Your pipeline records.', // dev: tiles.offers_pending
  },

  // ── Vendor / HR upload screens ───────────────────────────────────────────
  // For Phase 5. The vendor screens are the entire reachable app for the
  // `vendor` role, and today not one of their KPIs explains itself.
  vendorTotalCandidates: {
    label: 'Total Candidates',
    short: 'Every candidate you have submitted, across all roles and all time.',
    formula: 'A count of your own submissions only — it never includes candidates sourced by '
      + 'anyone else.',
    source: 'Your submissions.', // dev: GET /vendor/dashboard · stats.total
  },
  vendorAddedThisMonth: {
    label: 'Added This Month',
    short: 'Candidates you have submitted since the first of the current calendar month.',
    formula: 'Resets on the 1st. Early in a month this will naturally look low next to the total.',
    source: 'Your submissions.', // dev: stats.thisMonth
  },
  vendorWithPosition: {
    label: 'With Position Applied',
    short: 'How many of your submissions name the role they are for.',
    formula: 'Counts submissions that have a position recorded against them.',
    source: 'Your submissions.', // dev: stats.withPosition
    caveat: 'A submission with no position still counts towards your total. It just takes longer '
      + 'to route to the right recruiter.',
  },
  vendorPendingReview: {
    label: 'Pending Review',
    short: 'Uploads held back because the candidate already appears to exist in the database.',
    formula: 'A recruiter has to decide whether each of these is the same person (merge) or a '
      + 'genuinely different one (keep both). Until then they are not in the candidate database.',
    source: 'The upload tracker.', // dev: duplicates awaiting review, upload job tracker
  },
  // ── /analytics headline tiles (Phase 6) ─────────────────────────────────
  // These six had no explanation of any kind. They also carry no date window,
  // which the page says in small print above them — repeated in each caveat
  // here, because the tile is what gets screenshotted into a status report.
  analyticsShortlisted: {
    label: 'Shortlisted',
    short: 'Candidates a recruiter has shortlisted from screening, all time.',
    formula: 'Counts candidates marked shortlisted, whether or not they have since '
      + 'moved further along or been closed out.',
    source: 'Your screening decisions.', // dev: GET /screening/analytics · tiles.shortlisted
    caveat: 'Lifetime total. It does not follow the date controls on this page.',
  },
  analyticsRejected: {
    label: 'Rejected',
    short: 'Candidates rejected at any stage, all time.',
    source: 'Your screening and pipeline decisions.',
    caveat: 'Lifetime total. It does not follow the date controls on this page.',
  },
  analyticsOnHold: {
    label: 'On Hold',
    short: 'Candidates currently parked on hold — not progressing, not rejected.',
    formula: 'Counts the ones on hold right now, at whatever stage they were paused.',
    source: 'Your pipeline records.',
    caveat: 'This is a snapshot of today, not a total over time — it goes down as '
      + 'holds are resolved.',
  },
  analyticsTotal: {
    label: 'Total',
    short: 'Every candidate that has entered screening, all time.',
    formula: 'The denominator for the other tiles: shortlisted, rejected and on-hold '
      + 'are all subsets of this.',
    source: 'Your candidate database.',
    caveat: 'Lifetime total. It does not follow the date controls on this page.',
  },
  analyticsZekoSent: {
    label: 'Zeko Sent',
    short: 'Assessment invitations sent to candidates through Zeko.',
    formula: 'Counts invitations sent, not candidates — a candidate re-invited after '
      + 'a lapsed link counts twice.',
    source: 'Your Zeko assessment records.',
  },
  analyticsZekoPassed: {
    label: 'Zeko Passed',
    short: 'Candidates who took a Zeko assessment and met the passing score.',
    formula: 'Only counts assessments whose score has synced back. A candidate who has '
      + 'sat the test but whose result has not arrived is in neither this nor a '
      + 'failed count yet.',
    source: 'Your Zeko assessment records.',
    caveat: 'Read against Zeko Sent rather than on its own — sent includes people who '
      + 'never opened the invitation.',
  },

  totalUploads: {
    label: 'Total Uploads',
    short: 'Every resume sent through this screen, whatever happened to it afterwards.',
    formula: 'Counts upload attempts, including ones that were rejected or are still processing — '
      + 'so it is normally higher than the number of candidates that reached the database.',
    source: 'The upload tracker.',
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
