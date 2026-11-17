/**
 * U07 · The earlier role's rounds, for the interview panel.
 *
 * A candidate moved to another JD (journeyMove.service.js) starts a new journey
 * with `moved_from_pipeline_id`; the old journey keeps its scorecards, Zeko,
 * Evalground and recordings. The next interviewer on the new JD should see
 * them, so the panel's candidate table and its report so far carry the earlier
 * journeys' rounds, each labelled "<round> · earlier role: <MRF title>".
 *
 * Panel-only: the dossier download is built by buildDossierModel() alone and
 * never passes through here.
 *
 * Pure and import-free (tests/unit/panelEarlierRoles.test.js). The loader,
 * loadEarlierRoleModels() in interviewPanelPack.service.js, walks the chain and
 * builds one redacted dossier model per earlier journey.
 *
 * What travels from an earlier journey: its current scorecards (and the named
 * consolidated feedback), its scored Zeko rounds, its Evalground results and its
 * recordings (with their share links, when the pack minted them). What does not:
 * its progress events, its bookings, its pending scorecards, and the recruiter's
 * round notes, which live on the CV and are already on the current journey.
 *
 * Every relabelled item carries `earlier_role` (the title), `earlier_label` (the
 * label before relabelling) and `earlier_seq` (0 = the oldest role). Scorecards,
 * named feedback and recordings also lose their `stage_key` (kept as
 * `earlier_stage_key`), so nothing keyed by stage — the invite's own round, the
 * round notes — can mistake an earlier role's Tech 1 for this one's.
 */

/** How an earlier role's round is named: "Technical Round 1 · earlier role: Java Lead". */
export function earlierRoleLabel(label, role) {
  return `${label || 'Round'} · earlier role: ${role || 'earlier role'}`;
}

const scored = (z) => z && z.overall_score !== null && z.overall_score !== undefined;

/**
 * Does an earlier journey hold anything the panel should see?
 * @param {object|null} model - buildDossierModel() output for that journey
 */
export function earlierRoleHasResults(model) {
  if (!model) return false;
  return (model.scorecards || []).some((c) => !c.earlier_attempt)
    || (model.zeko || []).some(scored)
    || (model.assessments || []).length > 0
    // U03b: a recording from a cancelled booking or a no-show is not a result.
    || (model.recordings || []).some((r) => r.booking_held !== false);
}

/**
 * The current journey's panel model with the earlier roles' rounds in front of
 * its own (they happened first). Returns a new object; neither input changes.
 * The result carries `earlier_roles: [title…]`, which also tells a second call
 * that the merge is done, and `earlier_role_ids` (U03b): each merged role's
 * journey id, in the same order, so a round note can join its role's row.
 *
 * @param {object} model - the current journey's dossier model (links applied)
 * @param {Array<{role?: string|null, model: object}>} earlier - oldest first
 * @returns {object}
 */
export function mergeEarlierRoles(model, earlier = []) {
  if (!model) return model;
  if (Array.isArray(model.earlier_roles)) return model;
  const roles = (earlier || []).filter((e) => earlierRoleHasResults(e?.model));
  const out = {
    ...model,
    earlier_roles: [],
    earlier_role_ids: [],
  };
  if (!roles.length) return out;

  const scorecards = [];
  const named = [];
  const zeko = [];
  const assessments = [];
  const recordings = [];
  roles.forEach((e, seq) => {
    const m = e.model;
    const role = e.role || m.candidate?.position || 'earlier role';
    const tag = (label) => ({ earlier_role: role, earlier_label: label, earlier_seq: seq });
    out.earlier_roles.push(role);
    out.earlier_role_ids.push(m.generated?.pipeline_id != null ? String(m.generated.pipeline_id) : null);

    for (const c of (m.scorecards || []).filter((s) => !s.earlier_attempt)) {
      scorecards.push({
        ...c, ...tag(c.stage_label), stage_key: null, earlier_stage_key: c.stage_key ?? null, stage_label: earlierRoleLabel(c.stage_label, role),
      });
    }
    for (const c of m.consolidated_by_interviewer || []) {
      named.push({
        ...c, ...tag(c.round), stage_key: null, earlier_stage_key: c.stage_key ?? null, round: earlierRoleLabel(c.round, role),
      });
    }
    for (const z of (m.zeko || []).filter(scored)) {
      zeko.push({ ...z, ...tag(z.round), round: earlierRoleLabel(z.round, role) });
    }
    for (const a of m.assessments || []) {
      const label = a.test_name || 'Assessment';
      assessments.push({ ...a, ...tag(label), test_name: earlierRoleLabel(label, role) });
    }
    for (const r of m.recordings || []) {
      recordings.push({
        ...r, ...tag(r.stage_label), stage_key: null, earlier_stage_key: r.stage_key ?? null, stage_label: earlierRoleLabel(r.stage_label, role),
      });
    }
  });

  out.scorecards = [...scorecards, ...(model.scorecards || [])];
  out.consolidated_by_interviewer = [...named, ...(model.consolidated_by_interviewer || [])];
  out.zeko = [...zeko, ...(model.zeko || [])];
  out.assessments = [...assessments, ...(model.assessments || [])];
  out.recordings = [...recordings, ...(model.recordings || [])];
  return out;
}

export default {
  earlierRoleLabel, earlierRoleHasResults, mergeEarlierRoles,
};
