/**
 * React Query hooks for Screening (JD Filtering) data.
 *
 * Roles are prefetched at app load (see AppShell) and cached for the session so the
 * dropdown is instant and per-role candidate results survive page navigation.
 * staleTime: Infinity => no automatic refetch; reloads are explicit via the Refresh button.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import screeningService from '../services/screeningService';
import { getSocket } from '../services/socket';

// Query key factories (shared with prefetch + manual cache writes).
export const screeningKeys = {
  roles: ['screening', 'roles'],
  // Under the roles key on purpose: invalidating `roles` refreshes both lists.
  rolesWithClosed: ['screening', 'roles', 'withClosed'],
  roleCandidates: (roleId) => ['screening', 'roleCandidates', roleId],
};

// Normalize the axios envelope ({ data: { data } } | { data }) to the useful payload.
const unwrap = (res) => res?.data?.data ?? res?.data ?? null;

/**
 * Approved MRF roles for the JD Filtering dropdown — one entry per MRF (N19).
 * @param {{ includeClosed?: boolean }} [opts] also list closed MRFs (N20)
 */
export function useApprovedRoles({ includeClosed = false, enabled = true } = {}) {
  const queryClient = useQueryClient();

  // staleTime:Infinity means this list never refetches on its own, so a
  // requisition that closes while the page is open would keep offering a role
  // nobody is hiring for. The backend broadcasts 'mrf:closed' the moment the
  // last opening is filled; refetch on that one signal rather than polling.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const onMrfClosed = ({ mrf_id: mrfId } = {}) => {
      queryClient.invalidateQueries({ queryKey: screeningKeys.roles });
      if (mrfId) {
        queryClient.removeQueries({ queryKey: screeningKeys.roleCandidates(mrfId) });
      }
    };

    // 'mrf:updated' (N19): an MRF was approved or edited, so the list changed.
    const onMrfUpdated = () => queryClient.invalidateQueries({ queryKey: screeningKeys.roles });

    socket.on('mrf:closed', onMrfClosed);
    socket.on('mrf:updated', onMrfUpdated);
    return () => {
      socket.off('mrf:closed', onMrfClosed);
      socket.off('mrf:updated', onMrfUpdated);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: includeClosed ? screeningKeys.rolesWithClosed : screeningKeys.roles,
    queryFn: () => screeningService.getRoles({ includeClosed }),
    select: (res) => unwrap(res) || [],
    staleTime: Infinity,
    // Off for users without Candidate Screening access (Search Candidate, N21).
    enabled,
  });
}

/** Candidates matched to a selected role. Cached per role; only fires when a role is selected. */
export function useRoleCandidates(roleId, enabled = true) {
  return useQuery({
    queryKey: screeningKeys.roleCandidates(roleId),
    queryFn: () => screeningService.searchRoleCandidates(roleId),
    select: (res) => unwrap(res),
    enabled: Boolean(roleId) && enabled,
    staleTime: Infinity,
  });
}
