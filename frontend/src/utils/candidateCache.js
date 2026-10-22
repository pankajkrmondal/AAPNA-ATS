/**
 * Drop every cached screen that shows its own copy of a candidate, after the
 * candidate record is edited (N29). The backend syncs the pipeline's copy and
 * clears its own caches on save; these are the browser-side ones.
 *
 * Screening's candidate lists are cached with staleTime Infinity, so they are
 * removed rather than invalidated (as the 'mrf:closed' handler in
 * hooks/useScreeningData.js does): an inactive query would otherwise only be
 * marked stale and still render the old name on the next visit.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 */
export function invalidateCandidateCopies(queryClient) {
  queryClient.removeQueries({ queryKey: ['screening', 'roleCandidates'] });
  queryClient.invalidateQueries({ queryKey: ['pipeline-board'] });
  queryClient.invalidateQueries({ queryKey: ['pipeline-detail'] });
  queryClient.invalidateQueries({ queryKey: ['candidate-pipeline-scores'] });
}

export default invalidateCandidateCopies;
