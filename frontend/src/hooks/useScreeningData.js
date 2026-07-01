/**
 * React Query hooks for Screening (JD Filtering) data.
 *
 * Roles are prefetched at app load (see AppShell) and cached for the session so the
 * dropdown is instant and per-role candidate results survive page navigation.
 * staleTime: Infinity => no automatic refetch; reloads are explicit via the Refresh button.
 */
import { useQuery } from '@tanstack/react-query';
import screeningService from '../services/screeningService';

// Query key factories (shared with prefetch + manual cache writes).
export const screeningKeys = {
  roles: ['screening', 'roles'],
  roleCandidates: (roleId) => ['screening', 'roleCandidates', roleId],
};

// Normalize the axios envelope ({ data: { data } } | { data }) to the useful payload.
const unwrap = (res) => res?.data?.data ?? res?.data ?? null;

/** Approved MRF roles for the JD Filtering dropdown. */
export function useApprovedRoles() {
  return useQuery({
    queryKey: screeningKeys.roles,
    queryFn: screeningService.getRoles,
    select: (res) => unwrap(res) || [],
    staleTime: Infinity,
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
