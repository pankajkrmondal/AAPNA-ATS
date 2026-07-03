/**
 * useDashboardData — single orchestration hook for the advanced dashboard.
 *
 * Fetches everything the widgets need IN PARALLEL from the EXISTING endpoints (no backend
 * changes). Each source has its own try/catch so one failing endpoint never blanks the
 * whole dashboard — the corresponding widget just renders an empty/error state.
 *
 * Returns raw data; widgets/the page derive series via utils/dashboardAggregations.
 */
import { useEffect, useState, useCallback } from 'react';
import dashboardService from '../services/dashboardService';
import candidateService from '../services/candidateService';
import mrfService from '../services/mrfService';
import screeningService from '../services/screeningService';

/** How many candidates to pull for client-side trend/role/skill aggregation. */
const AGG_BATCH = 200;

const EMPTY_STATS = { totalCandidates: 0, activeMRFs: 0, todayUploads: 0, shortlisted: 0 };
const EMPTY_FUNNEL = { sourced: 0, aiScreened: 0, shortlisted: 0, hired: 0 };

export default function useDashboardData() {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [funnel, setFunnel] = useState(EMPTY_FUNNEL);
  const [candidates, setCandidates] = useState([]); // large batch for aggregation
  const [pendingMrfs, setPendingMrfs] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [pipelineTiles, setPipelineTiles] = useState({});
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const errs = {};

    const tasks = [
      // KPIs + funnel
      dashboardService.getStats()
        .then((res) => {
          const d = res.data?.data || res.data || {};
          setStats({
            totalCandidates: d.totalCandidates || 0,
            activeMRFs: d.activeMRFs || 0,
            todayUploads: d.todayUploads || 0,
            shortlisted: d.shortlisted || 0,
          });
          if (d.funnel) setFunnel(d.funnel);
        })
        .catch((e) => { errs.stats = e?.message || 'failed'; }),

      // Candidate batch for trends / top roles / skills (sorted newest first)
      candidateService.search({ sort: 'createdAt', order: 'desc' }, 1, AGG_BATCH)
        .then((res) => {
          const list = Array.isArray(res.data?.data)
            ? res.data.data
            : (res.data?.data?.data || res.data?.data?.candidates || res.data?.candidates || res.data || []);
          setCandidates(Array.isArray(list) ? list : []);
        })
        .catch((e) => { errs.candidates = e?.message || 'failed'; }),

      // Pending MRF approvals (for the action center)
      mrfService.list({ status: 'pending', limit: 50 })
        .then((res) => {
          const list = res.data?.data || res.data?.data?.data || res.data || [];
          setPendingMrfs(Array.isArray(list) ? list : (list?.data || []));
        })
        .catch((e) => { errs.mrfs = e?.message || 'failed'; }),

      // Zeko pipeline (interviews + status tiles)
      screeningService.getZekoPipeline()
        .then((res) => {
          const d = res.data?.data || res.data || {};
          setPipeline(Array.isArray(d.pipeline) ? d.pipeline : []);
          setPipelineTiles(d.tiles || {});
        })
        .catch((e) => { errs.pipeline = e?.message || 'failed'; }),

      // Approved roles (for the global role filter)
      screeningService.getRoles()
        .then((res) => {
          const list = res.data?.data || res.data || [];
          setRoles(Array.isArray(list) ? list : []);
        })
        .catch((e) => { errs.roles = e?.message || 'failed'; }),
    ];

    await Promise.allSettled(tasks);
    setErrors(errs);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return {
    stats,
    funnel,
    candidates,
    pendingMrfs,
    pipeline,
    pipelineTiles,
    roles,
    loading,
    errors,
    reload: load,
  };
}