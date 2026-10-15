/**
 * Server-side rules for skipping pipeline stages (Phase 3 "Do Now": N33 skip
 * guard, N24 CEO round optional). Pure — no Prisma — so node:test can load it.
 *
 * The UI only ever offers a skip for optional stages, but the API used to take
 * any skip from any staff user. These rules make the server the authority:
 *
 *   - only an OPTIONAL stage can be skipped, whether the candidate is sitting
 *     on it (advanceStage) or it lies ahead of an approval (setStageOutcome);
 *   - an approval may jump over a RUN of consecutive optional stages (HR Round
 *     -> Documents, bypassing CEO Round and Client Round), never over a
 *     mandatory one.
 *
 * Audit trail: the journey gets ONE 'skip' event, written against the stage it
 * LANDS in. A 'skip' row means "arrived here by bypassing optional stages"
 * (config/pipelineStages.js, isStageArrival); a row per bypassed stage would
 * count arrivals at stages nobody entered and inflate the funnel.
 */
import AppError from './AppError.js';

export const MANDATORY_SKIP_MESSAGE = 'This stage is mandatory and cannot be skipped.';

/**
 * advanceStage moves a candidate on WITHOUT an outcome — that is a skip of
 * the stage they are on, so it is only allowed when that stage is optional.
 * @param {{ stage_key: string, label?: string, is_optional?: boolean }} stage
 */
export function assertSkippable(stage) {
  if (!stage?.is_optional) {
    throw new AppError(`${MANDATORY_SKIP_MESSAGE} Record an outcome for ${stage?.label || stage?.stage_key || 'it'} instead.`, 400);
  }
}

/**
 * Where an approval lands.
 *
 * @param {{ stage_key: string, label?: string, is_optional?: boolean }[]} stages
 *   active stages in sort order
 * @param {number} currentIdx index of the stage being approved
 * @param {object} [opts]
 * @param {string|null} [opts.skipToStageKey] land here, bypassing every stage between
 * @param {boolean} [opts.skipOptionalNext] legacy one-stage form: bypass the next stage only
 * @returns {{ nextStage: object|null, skipped: object[] }} nextStage null = nothing after
 *   the current stage (approving the final stage)
 */
export function resolveApproveLanding(stages, currentIdx, { skipToStageKey = null, skipOptionalNext = false } = {}) {
  const next = stages[currentIdx + 1] || null;
  if (!next) {
    if (skipToStageKey || skipOptionalNext) throw new AppError('There is no later stage to skip to.', 400);
    return { nextStage: null, skipped: [] };
  }

  let targetIdx = currentIdx + 1;
  if (skipToStageKey) {
    targetIdx = stages.findIndex((s) => s.stage_key === skipToStageKey);
    if (targetIdx <= currentIdx) {
      throw new AppError(`"${skipToStageKey}" is not a later active stage for this candidate.`, 400);
    }
  } else if (skipOptionalNext) {
    targetIdx = currentIdx + 2;
    if (targetIdx >= stages.length) throw new AppError('There is no later stage to skip to.', 400);
  }

  const skipped = stages.slice(currentIdx + 1, targetIdx);
  const mandatory = skipped.find((s) => !s.is_optional);
  if (mandatory) {
    throw new AppError(`${MANDATORY_SKIP_MESSAGE} ${mandatory.label || mandatory.stage_key} has to happen first.`, 400);
  }
  return { nextStage: stages[targetIdx], skipped };
}

/**
 * Note on the landing stage's 'skip' event. One stage keeps the wording the
 * audit trail already has; a run lists them all.
 * @param {{ stage_key: string, label?: string }[]} skipped
 */
export function skipNote(skipped) {
  const part = (s) => `${s.stage_key} (${s.label || s.stage_key})`;
  if (skipped.length === 1) return `Skipped optional stage ${part(skipped[0])}`;
  return `Skipped optional stages ${skipped.map(part).join(', ')}`;
}
