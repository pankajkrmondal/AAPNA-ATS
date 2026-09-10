/**
 * dossierModel.js — the pure parts of building a candidate dossier.
 *
 * Two helpers that take plain objects and return plain values: how a journey's
 * state is described to an outsider, and how a download is described to the
 * audit log. Neither touches Prisma, Express or config.
 *
 * WHY THEY ARE NOT IN candidateDossier.service.js, where they logically belong:
 * that service reuses getCandidateScorecardReport(), which pulls in the email
 * and notification stack, which holds the event loop open — importing it from a
 * `node --test` file hangs the run. The plan's requirement that the dossier's
 * rules be testable "without a database or an Express app" (§5.1) therefore
 * applies to these two as much as to the redaction whitelist, so they live where
 * a unit test can reach them. The service re-exports both, so callers still see
 * one module.
 */

/**
 * A journey's status in words, for a reader who has never seen the ATS.
 *
 * HR allowed a dossier for ANY journey state, rejected and closed included
 * (decision #13, 2026-09-02). That makes this line load-bearing rather than
 * decorative: without it, an interviewer can read a pack about a candidate who
 * was rejected three weeks ago and reasonably assume they are being asked to
 * interview them.
 *
 * @param {object} pipeline - an rpa_candidate_pipeline row
 * @param {string} stageLabel - the human label for its current stage
 * @returns {{ stage_key: string, stage_label: string, state: string, closed: boolean, headline: string }}
 */
export function describeJourneyStatus(pipeline, stageLabel) {
  const stage = stageLabel || pipeline.current_stage_key;
  const base = { stage_key: pipeline.current_stage_key, stage_label: stage };

  if (pipeline.closed_at || pipeline.final_outcome) {
    const outcome = (pipeline.final_outcome || 'closed').replace(/_/g, ' ');
    return {
      ...base,
      state: 'closed',
      closed: true,
      headline: `This candidate's application is CLOSED (${outcome.toUpperCase()}). `
        + `It reached ${stage}. This pack is a record, not a request to interview.`,
    };
  }
  if (pipeline.is_paused) {
    return {
      ...base,
      state: 'paused',
      closed: false,
      headline: `This candidate's application is currently ON HOLD at ${stage}.`,
    };
  }
  return {
    ...base,
    state: 'in_progress',
    closed: false,
    headline: `This candidate is currently at ${stage}.`,
  };
}

/**
 * Content types Graph actually returns for the documents this system stores.
 * Only the ones we can name confidently — guessing is worse than omitting,
 * because a WRONG extension makes a file fail to open rather than merely
 * prompting the reader to pick an application.
 */
const EXT_BY_CONTENT_TYPE = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'text/plain': '.txt',
};

/** Extensions that describe a SharePoint VIEWER page, not the document itself. */
const WEB_PAGE_EXTENSIONS = new Set(['aspx', 'asp', 'html', 'htm', 'php', 'jsp']);

/**
 * Work out the file extension for a dossier attachment.
 *
 * THIS MATTERS MORE THAN IT LOOKS. A file named "01_Resume_Asha-R" with no
 * extension does not open by double-click on Windows: the recipient gets a
 * "choose an app" dialog for an unsolicited document, which most people abandon.
 *
 * Three sources, in this order, each learned the hard way during testing:
 *
 *   1. the name Graph returned — authoritative, but present only when we
 *      resolved through /shares/, i.e. the FIRST read of a legacy row
 *   2. the Content-Type of the download — authoritative, and the ONLY source
 *      once the item id is stored, because reading by id skips the metadata call
 *   3. the stored URL — last resort, and filtered
 *
 * Source 2 sits above source 3 deliberately. A SharePoint webUrl frequently ends
 * `/Doc.aspx?sourcedoc=…`, so trusting the URL produced `01_Resume_X.aspx` for a
 * Word document — not merely useless but actively wrong, since it tells the
 * operating system to open a web page. Both that and the no-extension case
 * reached a real downloaded pack before this function existed.
 *
 * @param {{name?: string|null, url?: string|null, contentType?: string|null}} [sources]
 * @returns {string} '.pdf'-style, or '' when genuinely unknowable
 */
export function extensionFor({ name, url, contentType } = {}) {
  const fromPath = (candidate) => {
    // Strip ?query and #fragment first — a SharePoint URL routinely carries both.
    const bare = String(candidate || '').trim().split(/[?#]/)[0];
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(bare);
    if (!m) return '';
    const ext = m[1].toLowerCase();
    return WEB_PAGE_EXTENSIONS.has(ext) ? '' : `.${ext}`;
  };

  const fromName = fromPath(name);
  if (fromName) return fromName;

  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (EXT_BY_CONTENT_TYPE[type]) return EXT_BY_CONTENT_TYPE[type];

  return fromPath(url);
}

/**
 * Fold the attachment results back into the model's manifest.
 *
 * The manifest is the pack's own account of what it does and does not contain,
 * so it has to describe what actually happened on THIS download rather than what
 * the feature is capable of in general. Four different outcomes have to read
 * differently to whoever opens the pack:
 *
 *   attached        — here it is, by filename
 *   fetch failed    — we tried, it did not work, ask the recruiter
 *   not requested   — the recruiter chose not to send it (not a fault)
 *   wrong format    — a single-file pack cannot carry it; a fuller one exists
 *
 * Collapsing those into one "not included" line is how a reader ends up assuming
 * a candidate has no resume when in fact a fetch 403'd.
 *
 * Pure — no Prisma, no Graph — so it lives here with the other testable halves;
 * collectAttachments() in the service does the fetching.
 *
 * @param {object} model
 * @param {{files: Array, notes: object, degraded: boolean, documentCount: number, totalBytes: number}} attachments
 * @param {{includeResume?: boolean, includeDocuments?: boolean, supportsAttachments?: boolean}} chosen
 * @returns {object} the same model, mutated
 */
export function applyAttachments(model, attachments, chosen = {}) {
  const { supportsAttachments = true } = chosen;
  const resumeFile = attachments.files.find((f) => /\/01_Resume_/.test(f.name));
  // Only a note that names a FAILURE makes the download "degraded" — the flag
  // that makes the UI warn "a file could not be attached". A candidate who has
  // no resume on file produces a note too, and warning about that told
  // recruiters something had gone wrong when nothing had (seen in staging,
  // 2026-09-03). Absence and failure are different states and the pack has to
  // keep them apart; `failed` is the collector's own record of which is which.
  const failed = new Set(attachments.failed || []);

  for (const entry of model.manifest) {
    if (entry.item === 'Resume') {
      if (resumeFile) {
        entry.included = true;
        entry.note = `Attached as ${resumeFile.name}.`;
      } else if (!supportsAttachments) {
        entry.note = 'This is a single-file version of the pack, which cannot carry attachments. '
          + 'Ask the recruiter for the full ZIP if you need the resume.';
      } else if (!chosen.includeResume) {
        entry.note = 'Not included in this download, by the recruiter\'s choice.';
      } else if (attachments.notes.resume) {
        entry.note = attachments.notes.resume;
        if (failed.has('resume')) entry.degraded = true;
      }
    }
  }

  // Personal documents get their own manifest line ONLY when they were asked
  // for. Listing "0 personal documents" on every pack would advertise a category
  // most recipients have no business thinking about.
  if (chosen.includeDocuments && supportsAttachments) {
    model.manifest.push({
      item: 'Candidate personal documents',
      included: attachments.documentCount > 0,
      note: attachments.documentCount
        ? `${attachments.documentCount} document(s) attached at the recruiter's explicit request.`
        : (attachments.notes.documents || 'None could be attached.'),
      // Same distinction: a candidate who has submitted no documents is not a
      // failed download, and must not make the UI warn about one.
      degraded: [...failed].some((k) => k.startsWith('document_')),
    });
  }

  model.attachments = {
    count: attachments.files.length,
    bytes: attachments.totalBytes,
    resume_attached: Boolean(resumeFile),
    document_count: attachments.documentCount,
  };
  return model;
}

/**
 * Fold what came back from Zeko into the model — the report itself, and the
 * share link when one was minted (plan §6.6, §6.7).
 *
 * The sibling of applyAttachments(), and for the same reason: what the pack says
 * about the screening report has to describe THIS download. Five outcomes read
 * differently to whoever opens it —
 *
 *   rendered        the assessment is in section 6, minus compensation
 *   linked          Zeko's own page is one click away, with no login
 *   not requested   the recruiter chose not to send it (not a fault)
 *   could not fetch we tried and failed; ask the recruiter
 *   none exists     there is no screening report for this candidate at all
 *
 * Both go on the ROUND rather than in lists of their own, because a candidate
 * can sit two screening rounds on one job and a reader needs to know which
 * report they are looking at.
 *
 * Pure — the fetching is collectZekoExtras() in the service.
 *
 * @param {object} model
 * @param {{reports?: Array<{index: number, detail: object}>, links?: Array<{index: number, url: string}>,
 *   notes?: object, degraded?: boolean}} [result]
 * @param {{includeScreeningDetail?: boolean, includeScreeningReport?: boolean}} [chosen]
 * @returns {object} the same model, mutated
 */
export function applyZekoExtras(model, result = {}, chosen = {}) {
  const { reports = [], links = [], notes = {} } = result;
  const { includeScreeningDetail = true, includeScreeningReport = false } = chosen;

  for (const report of reports) {
    const round = model.zeko?.[report.index];
    if (round) round.report_detail = report.detail;
  }
  for (const link of links) {
    const round = model.zeko?.[link.index];
    if (round) round.report_link = link.url;
  }

  const rendered = (model.zeko || []).filter((z) => z.report_detail).length;
  const linked = (model.zeko || []).filter((z) => z.report_link).length;
  model.zeko_report_details = { count: rendered };
  model.zeko_report_links = { count: linked };

  const entry = model.manifest.find((m) => m.item === 'AI screening report (Zeko)');
  const anyReport = (model.zeko || []).some((z) => z.report_available);
  if (!entry || !anyReport) return model;

  if (rendered || linked) {
    entry.included = true;
    entry.note = [
      rendered
        ? 'The screening assessment is set out in section 6 of this report '
          + '(compensation has been removed from it).'
        : null,
      linked
        ? 'A link to the vendor\'s own full report is also in section 6 — it opens with no login.'
        : null,
    ].filter(Boolean).join(' ');
    // Asked for both, got one: the pack still says which half is missing rather
    // than presenting what arrived as though it were everything.
    if (includeScreeningReport && !linked) {
      entry.note += ' The link to the vendor\'s own report could not be created — ask the recruiter.';
      entry.degraded = true;
    }
    if (includeScreeningDetail && !rendered) {
      entry.note += ' The detailed assessment could not be retrieved — ask the recruiter.';
      entry.degraded = true;
    }
  } else if (!includeScreeningDetail && !includeScreeningReport) {
    entry.note = 'Not included in this download, by the recruiter\'s choice.';
  } else {
    // The first failure note, rather than all of them: the reader's next step is
    // the same whichever round failed, and three variations of "ask the
    // recruiter" read as noise.
    entry.note = Object.values(notes)[0]
      || 'The AI screening report could not be retrieved — please ask the recruiter for it.';
    entry.degraded = true;
  }
  return model;
}

/**
 * Fold the minted recording share links into the model (plan §6.5, Phase 4).
 *
 * The sibling of applyZekoExtras(), joined by INDEX rather than by id for the
 * same reason: the model's recordings are the redacted, serialized view and
 * deliberately do not carry the database id, so the collector — which reads the
 * same rows in the same order — hands back positions.
 *
 * Five outcomes have to read differently to whoever opens the pack:
 *
 *   linked         watch it here, until this date
 *   not requested  the recruiter chose not to share the footage (not a fault)
 *   not playable   the recording exists but has no content we can serve
 *   mint failed    we tried and could not; ask the recruiter
 *   none exist     there are no recordings for this candidate at all
 *
 * `playable` is what keeps "not playable" and "mint failed" apart, and the two
 * must not be collapsed. A candidate whose rounds were recorded but not yet
 * archived has nothing to link; treating that as a failure told the pack's
 * reader "no viewing link could be created — please ask the recruiter" and set
 * X-Export-Degraded, so the recruiter was warned that a file could not be
 * attached when nothing had gone wrong. An older caller that does not report it
 * keeps the previous, pessimistic reading.
 *
 * @param {object} model
 * @param {{links?: Array<{index: number, url: string, expires_at: *}>, requested?: boolean,
 *   playable?: number, degraded?: boolean}} [result]
 * @param {{includeRecordingLinks?: boolean}} [chosen]
 * @returns {object} the same model, mutated
 */
export function applyRecordingShareLinks(model, result = {}, chosen = {}) {
  const { links = [], playable, degraded = false } = result;
  const { includeRecordingLinks = false } = chosen;
  const nothingToLink = playable === 0;

  for (const link of links) {
    const recording = model.recordings?.[link.index];
    if (recording) {
      recording.share_url = link.url;
      recording.share_expires_at = link.expires_at;
    }
  }

  const linked = (model.recordings || []).filter((r) => r.share_url).length;
  model.recording_share_links = { count: linked };

  const entry = model.manifest?.find((m) => m.item === 'Interview recordings');
  if (!entry || !(model.recordings || []).length) return model;

  if (linked) {
    entry.included = true;
    entry.note = `${linked} recording(s) can be watched from the links in section 9 of this report. `
      + 'They open with no login, expire, and can be withdrawn by the recruiter at any time.';
    // Asked for links on every round and got fewer: say so rather than let the
    // reader assume the rounds without a link were never recorded.
    if (linked < model.recordings.length) {
      entry.note += ` ${model.recordings.length - linked} other recording(s) are not shared here — `
        + 'ask the recruiter.';
    }
  } else if (!includeRecordingLinks) {
    entry.note = `${model.recordings.length} recording(s) exist for this candidate. They were not shared `
      + "in this download, by the recruiter's choice — ask them if you need to watch one.";
  } else if (nothingToLink) {
    // Absence, not failure. The round happened and is listed; there is simply no
    // file behind it yet — the archive copy has not landed, or Microsoft has
    // aged the original out. Nothing went wrong with this download, so it must
    // not be flagged as degraded.
    entry.note = `${model.recordings.length} recording(s) are listed for this candidate, but none of `
      + 'them has a playable file, so there is nothing to link to — please ask the recruiter.';
  } else {
    entry.note = `${model.recordings.length} recording(s) exist for this candidate, but no viewing link `
      + 'could be created — please ask the recruiter.';
    entry.degraded = true;
  }
  if (degraded) entry.degraded = true;
  return model;
}

/**
 * Whether a finished pack is too big to email, and what to tell the recruiter.
 *
 * §6.4 set a 40 MB ceiling on the pack deliberately ABOVE Outlook's ~25 MB
 * attachment limit, so that a big pack is produced rather than silently
 * truncated to fit — and then said the recruiter must be TOLD when it will not
 * send. Without this they find out from a bounce message hours later, by which
 * point they believe the candidate's details are already with the interviewer.
 *
 * Pure, and separate from the controller, because the threshold comparison is
 * the whole of the behaviour and it should be pinned by a test rather than by
 * someone re-reading an if-statement in a request handler.
 *
 * @param {number} bytes - the built pack's size
 * @param {number} warnBytes - config.dossier.warnPackBytes
 * @returns {null|{bytes: number, megabytes: number, message: string}} null when it will send fine
 */
export function packSizeNotice(bytes, warnBytes) {
  const size = Number(bytes);
  const limit = Number(warnBytes);
  if (!Number.isFinite(size) || !Number.isFinite(limit) || limit <= 0 || size <= limit) return null;

  // Floored at 0.1, never 0. Two reasons, both found by testing this with the
  // threshold turned down: a header reading "0" is nonsense to whoever reads it,
  // and 0 is FALSY — the modal's `if (result.oversizeMb)` would skip the warning
  // entirely, so the one configuration where the warning fires hardest would be
  // the one where it silently did not fire at all.
  const mb = (n) => Math.max(0.1, Math.round((n / (1024 * 1024)) * 10) / 10);
  const megabytes = mb(size);

  return {
    bytes: size,
    megabytes,
    // Says the size, the consequence and the way out — a warning that only says
    // "this file is large" leaves the recruiter to guess what to do about it.
    message: `This pack is ${megabytes} MB, which is above the usual ${mb(limit)} MB `
      + 'limit for email attachments. Send it as a OneDrive link instead, or download it again with the '
      + 'resume and documents unticked.',
  };
}

/**
 * What a given download actually contained, in plain terms, for both audit
 * surfaces and the READ-ME.
 *
 * Counts rather than booleans wherever a count exists: "scorecards(2)" tells
 * someone reviewing the log a year later how much was exposed, which
 * "scorecards: true" does not. This is the difference between an audit that can
 * answer "which candidate's what went to whom" and one that can only confirm
 * that something happened (plan §8.4).
 *
 * @param {object} model - a built dossier model
 * @returns {string[]}
 */
export function describeIncludedCategories(model) {
  const included = ['profile'];
  if (model.contact_details_included) included.push('contact_details');
  if (model.scorecards.length) included.push(`scorecards(${model.scorecards.length})`);
  if (model.assessments.length) included.push(`assessments(${model.assessments.length})`);
  // Separate from the line above, and for the same reason the two screening
  // categories are separate: "assessments(1)" means three section scores left
  // the building, while "assessment_detail(1)" means the whole of someone's
  // test — question counts, difficulty split and topic scores — did.
  if (model.assessment_details?.count) {
    included.push(`assessment_detail(${model.assessment_details.count})`);
  }
  if (model.zeko.length) included.push(`screening_scores(${model.zeko.length})`);
  if (model.stages.length) included.push('stage_history');
  if (model.interviews.length) included.push(`interview_history(${model.interviews.length})`);
  // Deliberately named "listed", not "included". Phase 1 records that recordings
  // EXIST while carrying no way to watch one; Phase 4's share links will expose
  // the footage itself. Those are materially different disclosures and the audit
  // has to keep them distinguishable, or a later review cannot tell which packs
  // actually let someone outside the company watch an interview.
  if (model.recordings.length) included.push(`recordings_listed(${model.recordings.length})`);

  // Attachments — the actual FILES that left, as opposed to data about them.
  // Decision #11 allowed personal documents as an opt-in rather than excluding
  // them, and that choice is only defensible if the system can answer "whose
  // payslip went to whom, and who decided that?" months later. So the count is
  // recorded, not merely the fact that a box was ticked (plan §8.4).
  if (model.attachments?.resume_attached) included.push('resume_file');
  if (model.attachments?.document_count) {
    included.push(`personal_documents(${model.attachments.document_count})`);
  }
  // Two categories, not one, because they are two different disclosures and a
  // later review must be able to tell them apart:
  //   ..._detail        the assessment, rendered inside the pack under OUR
  //                     redaction — compensation removed, nothing playable
  //   ..._no_login_link a URL that opens Zeko's own page — CTC, the hiring band,
  //                     the transcript and the interview video — to anyone
  //                     holding the file, and unlike our recording links
  //                     (plan §6.5) it is Zeko's to expire, not ours
  if (model.zeko_report_details?.count) {
    included.push(`screening_report_detail(${model.zeko_report_details.count})`);
  }
  if (model.zeko_report_links?.count) {
    included.push(`screening_report_no_login_link(${model.zeko_report_links.count})`);
  }
  // The same distinction one more time, and here it is the sharpest in the whole
  // audit: "recordings_listed" means the pack said an interview exists;
  // "recording_no_login_link" means someone outside the company can watch it.
  if (model.recording_share_links?.count) {
    included.push(`recording_no_login_link(${model.recording_share_links.count})`);
  }
  return included;
}

export default {
  describeJourneyStatus,
  describeIncludedCategories,
  applyAttachments,
  applyZekoExtras,
  applyRecordingShareLinks,
  packSizeNotice,
  extensionFor,
};
