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
    formula: 'Requisitions that have not been filled, closed, rejected or withdrawn. '
      + 'The "awaiting approval" figure below it counts the ones still waiting on an approver.',
    // dev: approval_status in (pending, waiting, approved) AND filled_at IS NULL AND closed_at IS NULL,
    // counted server-side in dashboard.service.js getStats() · rpa_mrf.
    source: 'Your requisition records.',
  },
  todayUploads: {
    label: "Today's Uploads",
    short: 'Candidate CVs added since midnight today (India time).',
    formula: 'A count of candidates added at or after 00:00 IST today.',
    source: 'Your candidate database.', // dev: GET /dashboard/stats · rpa_cv
  },
  shortlisted: {
    label: 'Shortlisted',
    short: 'Candidates in the interview pipeline right now: shortlisted for a role and not yet closed.',
    formula: 'Every open pipeline journey — same count as the Candidate Pipeline board. A candidate '
      + 'shortlisted for two roles counts twice. With an MRF picked, only that MRF.',
    source: 'Your interview pipeline.', // dev: rpa_candidate_pipeline WHERE final_outcome IS NULL (N36)
  },
  shortlistRate: {
    label: 'Shortlist rate',
    short: 'Of the candidates added in the selected period, how many were shortlisted in it.',
    formula: 'Candidates who entered the pipeline in the period ÷ candidates added in the period.',
    source: 'Your candidate database and interview pipeline.',
    caveat: 'Someone added near the end of the period may be shortlisted after it, so the latest '
      + 'days read a little low.',
  },
  hired: {
    label: 'Hired',
    short: 'Candidates whose journey was closed as approved or joined.',
    formula: 'The same rule Recruitment Analytics uses, so the two screens agree.',
    source: 'Your interview pipeline.', // dev: final_outcome IN HIRED_OUTCOMES (N36)
  },

  // ── Widgets ──────────────────────────────────────────────────────────────
  hiringTrends: {
    label: 'Hiring Trends',
    short: 'Candidates added per day over the period you have selected.',
    formula: 'Each point is the number of candidates added on that day (India time), counted over '
      + 'the whole database.',
    source: 'Your candidate database.', // dev: GET /dashboard/trends (N36)
    caveat: 'With an MRF picked, a candidate counts when uploaded for or shortlisted to that MRF (JD tagging), '
      + 'or, for candidates added before tagging existed, when the "Position Applied" they gave matches its role.',
  },
  conversionFunnel: {
    label: 'Conversion Funnel',
    short: 'How many candidates survive each stage, from sourced through to hired.',
    formula: 'Sourced is every CV; AI Screened is those the AI has profiled; Entered pipeline is every '
      + 'candidate ever shortlisted for a role; Hired is those closed as approved or joined. '
      + 'Time-to-hire is the median days from shortlist to hire.',
    source: 'Your candidate database and interview pipeline. Always all roles.',
    // dev: GET /dashboard/stats · rpa_cv + rpa_candidate_pipeline (N36)
  },
  talentInsights: {
    label: 'Talent Insights',
    short: 'The roles candidates applied for most often, and the skills that come up most often, '
      + 'among candidates added in the selected period.',
    source: 'Your candidate profiles.', // dev: GET /dashboard/trends (N36)
    caveat: 'Roles are the "Position Applied" each candidate gave; spelling variants of one role are '
      + 'counted together.',
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
    short: 'Zeko and Teams interviews with a start time falling today.',
    source: 'Your interview schedule.', // dev: GET /dashboard/upcoming-interviews (N36)
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
    short: 'Zeko interviews and Teams interviews over the next seven days, soonest first. Click one '
      + 'to open that candidate on the pipeline board.',
    source: 'Your interview schedule.', // dev: GET /dashboard/upcoming-interviews (N36)
  },
  latestUploads: {
    label: 'Latest uploads',
    short: 'The five most recently added candidates. Click one to open the candidate.',
    source: 'Your candidate database.', // dev: GET /dashboard/recent-uploads
  },
  dateRange: {
    label: 'Date range',
    short: 'Sets the period the graphs, Hiring Trends, Talent Insights and the shortlist rate cover.',
    caveat: 'The big numbers on the cards are lifetime totals and stay the same whichever period '
      + 'you pick.',
  },
  roleFilter: {
    label: 'MRF filter',
    short: 'Narrows the page to one requisition, so you can see how a single position is tracking.',
    caveat: 'Shortlisted and the pipeline graph follow the MRF exactly. Candidates added, Hiring '
      + 'Trends and Talent Insights match on the role name the candidate applied for, until uploads '
      + 'are linked to an MRF (JD tagging).',
  },

  // ── Analytics › Open Positions board and role view (L06) ─────────────────
  // dev: GET /api/pipeline/analytics/positions(/:mrfId) · openPositions.service.js,
  // rules in openPositions.helpers.js, applicants in mrfApplicants.service.js.
  analyticsRange: {
    label: 'Date range',
    short: 'Every number on this page follows this range, except the ones marked NOW, which show today.',
    formula: 'Whole days in India time, both ends included. The arrow figures compare with the same '
      + 'number of days just before the range.',
  },
  opApplied: {
    label: 'Applied',
    short: 'Candidates who came in for this role in the range.',
    formula: 'Tagged to the requisition (uploaded, shortlisted or added to it) on that day, or — for '
      + 'mailbox and website applicants — a "Position Applied" that matches the role, counted on the '
      + 'day the candidate was added.',
    caveat: 'Where several requisitions share a role name, an untagged candidate counts once, under '
      + 'the newest one raised before they arrived. JD tags started on 21 Oct 2026.',
  },
  opResponded: {
    label: 'Responded',
    short: 'Applicants who sent back the candidate details form in the range — the "qualified" number.',
    formula: 'Counted on the day the form came back. A profile that was complete on arrival counts on '
      + 'the day it was added. Forms returned before 14 Oct 2026 count on the day they were requested.',
  },
  opShortlisted: {
    label: 'Shortlisted',
    short: 'Candidates moved into the pipeline for this role in the range.',
  },
  opRejected: {
    label: 'Rejected',
    short: 'Candidates rejected in the range — at screening or at any pipeline stage.',
  },
  opMovedForward: {
    label: 'Moved forward',
    short: 'Candidates who reached a stage after HR screening in the range.',
  },
  opInterviews: {
    label: 'Interviews',
    short: 'Interviews held in the range: Teams rounds marked as held, and Zeko rounds completed.',
  },
  opOffers: {
    label: 'Offers',
    short: 'Offers raised for approval in the range.',
  },
  opJoined: {
    label: 'Joined',
    short: 'Candidates who joined in the range.',
  },
  opInPipeline: {
    label: 'In pipeline',
    short: 'Candidates in the pipeline for this role right now.',
    caveat: 'NOW: a snapshot of today. It does not follow the date range.',
  },
  opOnHold: {
    label: 'On hold',
    short: 'Candidates on hold for this role right now.',
    caveat: 'NOW: a snapshot of today. It does not follow the date range.',
  },
  opStuck: {
    label: 'Stuck',
    short: 'Candidates who have sat in the same stage for 10 days or more.',
    caveat: 'NOW: a snapshot of today. Notes and emails do not reset the clock; only a stage move does.',
  },
  opAwaitingFeedback: {
    label: 'Awaiting feedback',
    short: 'Interviews that happened but whose scorecard has not come back yet.',
    caveat: 'NOW: a snapshot of today.',
  },
  opShortlistPct: {
    label: 'Shortlist %',
    short: 'Of the applicants in the range, the share moved into the pipeline.',
    formula: 'Shortlisted ÷ Applied, both in the range.',
  },
  opResponsePct: {
    label: 'Response rate',
    short: 'Of the applicants in the range, the share who sent back the details form.',
    formula: 'Responded ÷ Applied, both in the range.',
  },
  opHealth: {
    label: 'Health',
    short: 'How this open role is doing this week.',
    formula: 'At risk: open longer than the target, or no applicants in 7 days with fewer than 3 in '
      + 'the pipeline. Watch: anyone stuck, feedback overdue, no applicants in 7 days, or applicants '
      + 'down by more than half on the week before. On track: none of these.',
    caveat: 'Always judged on the last 7 days, whatever range the page shows. The target is set in '
      + 'Settings (45 days unless changed).',
  },
  roleSummaryTotalApplied: {
    label: 'Total applied',
    short: 'Candidates who came in for this requisition in the range — the same number as "Applied" '
      + 'on Open Positions.',
  },
  roleSummaryTotalScreened: {
    label: 'Total screened',
    short: 'Shortlisted + Rejected + On hold + Future prospect + Closed: every screening decision for '
      + 'this requisition in the range.',
  },

  // ── Analytics › Positions tab (N39) ──────────────────────────────────────
  // dev: GET /api/pipeline/analytics/positions · positionsOverview() in
  // backend/src/services/pipelineAnalytics.helpers.js.
  positionsOpened: {
    label: 'Opened',
    short: 'The day the requisition was approved (or raised, for older ones with no approval date).',
  },
  positionsDaysOpen: {
    label: 'Days open',
    short: 'Days from opening until today — or until it was filled or closed, for a closed one.',
  },
  positionsShortlisted: {
    label: 'Shortlisted',
    short: 'Every candidate shortlisted for this requisition, whatever happened to them since.',
  },
  positionsMovedForward: {
    label: 'Moved forward',
    short: 'Candidates who got past the first pipeline stage (HR screening) for this requisition.',
  },
  positionsStageReach: {
    label: 'Reached each stage',
    short: 'How many candidates reached each stage. A candidate who reached Tech 2 also counts under '
      + 'the stages before it that they went through.',
    caveat: 'An optional stage that was skipped is not counted as reached.',
  },
  positionsJoiningRatio: {
    label: 'Joining ratio',
    short: 'Of the candidates who accepted an offer, how many actually joined.',
    formula: 'Joined ÷ offers accepted. Shown as "–" until someone has accepted an offer.',
    caveat: 'Someone who accepted recently may simply not have reached their joining date yet.',
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
  timeToHire: {
    label: 'Time-to-hire',
    short: 'How long a hire actually takes, from the day a candidate enters the pipeline to the day '
      + 'their journey closes as hired.',
    formula: 'The middle figure across every hire, not the average — one unusually long requisition '
      + 'would drag an average somewhere no real hire has been. Only candidates who were hired '
      + 'count; rejected and withdrawn journeys are excluded, since they have no hire date. '
      + 'The stage bars below are a separate, wider calculation: average days per stage across '
      + 'all closed journeys, however they ended.',
    source: 'Your pipeline records.', // dev: GET /pipeline/analytics · timeToHire.median_days
    caveat: 'Check the number of hires it is based on, shown beneath it. Over two or three hires '
      + 'this is a description of those hires, not a benchmark you can plan against.',
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
    caveat: 'Follows the date range at the top of the page: decisions made in it.',
  },
  analyticsRejected: {
    label: 'Rejected',
    short: 'Candidates rejected at any stage.',
    source: 'Your screening and pipeline decisions.',
    caveat: 'Follows the date range at the top of the page: decisions made in it.',
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
    short: 'Every candidate that has entered screening.',
    formula: 'The denominator for the role breakdown: shortlisted, rejected, on-hold and '
      + 'future prospect are all subsets of this, and together they account for '
      + 'every candidate counted here.',
    source: 'Your candidate database.',
    caveat: 'Follows the date range at the top of the page: decisions made in it.',
  },
  analyticsZekoSent: {
    label: 'Zeko Sent',
    short: 'Candidates who have been sent a Zeko assessment.',
    formula: 'Counts each candidate once, however many rounds they were invited to — '
      + 'so it can be read directly against the four tiles beside it.',
    source: 'Your Zeko assessment records.',
    caveat: 'Being sent an assessment is not the same as opening it. Read this '
      + 'alongside Zeko Score Received to see how many actually came back.',
  },
  analyticsZekoScoreReceived: {
    label: 'Zeko Score Received',
    short: 'Candidates whose Zeko assessment score has come back into the ATS.',
    formula: 'Counts each candidate once, from the point their result syncs across. '
      + 'Someone who has sat the test but whose score has not arrived yet is not '
      + 'counted here.',
    source: 'Your Zeko assessment records.',
    caveat: 'This is not a pass count — the ATS records the score Zeko returns and does '
      + 'not judge it against a threshold. Read it against Zeko Sent, which '
      + 'includes people who never opened the invitation.',
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
