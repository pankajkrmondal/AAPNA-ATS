/**
 * useDashboardData — single orchestration hook for the advanced dashboard.
 *
 * Fetches everything the widgets need IN PARALLEL. Each source has its own
 * catch so one failing endpoint never blanks the whole dashboard — the
 * corresponding widget just renders an empty/error state.
 *
 * N36: the numbers are counted on the server. The hook used to pull the newest
 * 200 candidates and aggregate them here, so any period with more than 200
 * arrivals was quietly under-counted; it also read interviews from the Zeko
 * list only. Stats and trends now follow the period and MRF filters; the
 * other lists load once.
 */
import { useEffect, useState, useCallback } from 'react';
import dashboardService from '../services/dashboardService';

const EMPTY_STATS = {
  totalCandidates: 0, activeMRFs: 0, pendingApprovalMRFs: 0, todayUploads: 0, shortlisted: 0, hired: 0,
  mrf: null, period: null, timeToHireDays: null,
};
const EMPTY_FUNNEL = { sourced: 0, aiScreened: 0, shortlisted: 0, hired: 0 };
const EMPTY_SERIES = { daily: [], total: 0 };
const EMPTY_TRENDS = {
  added: { ...EMPTY_SERIES, previousTotal: 0, deltaPct: null },
  enteredPipeline: EMPTY_SERIES,
  mrfsRaised: EMPTY_SERIES,
  topRoles: [],
  topSkills: [],
  matchedBy: null,
};

const unwrap = (res) => res?.data?.data ?? res?.data ?? null;
const asList = (res) => {
  const d = unwrap(res);
  return Array.isArray(d) ? d : [];
};

/**
 * @param {{ rangeDays: number, mrfId: number|string|null }} filters
 */
export default function useDashboardData({ rangeDays = 30, mrfId = null } = {}) {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [funnel, setFunnel] = useState(EMPTY_FUNNEL);
  const [trends, setTrends] = useState(EMPTY_TRENDS);
  const [upcoming, setUpcoming] = useState([]);
  const [mrfOptions, setMrfOptions] = useState([]);
  const [recruiterBreakdown, setRecruiterBreakdown] = useState([]); // [{ recruiter, added, shortlisted }]
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});

  // Follows the filters: KPIs, funnel, daily series, talent tallies.
  const loadFiltered = useCallback(async () => {
    setLoading(true);
    const errs = {};
    await Promise.allSettled([
      dashboardService.getStats({ rangeDays, mrfId })
        .then((res) => {
          const d = unwrap(res) || {};
          setStats({ ...EMPTY_STATS, ...d });
          if (d.funnel) setFunnel(d.funnel);
        })
        .catch((e) => { errs.stats = e?.message || 'failed'; }),
      dashboardService.getTrends({ rangeDays, mrfId })
        .then((res) => setTrends({ ...EMPTY_TRENDS, ...(unwrap(res) || {}) }))
        .catch((e) => { errs.trends = e?.message || 'failed'; }),
    ]);
    setErrors((prev) => ({ ...prev, stats: errs.stats, trends: errs.trends }));
    setLoading(false);
  }, [rangeDays, mrfId]);

  // Independent of the filters.
  const loadStatic = useCallback(async () => {
    const errs = {};
    await Promise.allSettled([
      dashboardService.getUpcomingInterviews(7)
        .then((res) => setUpcoming(asList(res)))
        .catch((e) => { errs.upcoming = e?.message || 'failed'; }),
      dashboardService.getMrfOptions()
        .then((res) => setMrfOptions(asList(res)))
        .catch((e) => { errs.mrfOptions = e?.message || 'failed'; }),
      // Per-recruiter Added + Shortlisted breakdown (one row per recruiter, both counts)
      dashboardService.getRecruiterBreakdown()
        .then((res) => setRecruiterBreakdown(asList(res)))
        .catch((e) => { errs.recruiterBreakdown = e?.message || 'failed'; }),
    ]);
    setErrors((prev) => ({ ...prev, ...errs }));
  }, []);

  useEffect(() => { loadFiltered(); }, [loadFiltered]);
  useEffect(() => { loadStatic(); }, [loadStatic]);

  const reload = useCallback(() => Promise.all([loadFiltered(), loadStatic()]), [loadFiltered, loadStatic]);

  return {
    stats,
    funnel,
    trends,
    upcoming,
    mrfOptions,
    recruiterBreakdown,
    loading,
    errors,
    reload,
  };
}
