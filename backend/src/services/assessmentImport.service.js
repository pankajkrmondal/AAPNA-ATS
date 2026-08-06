/**
 * assessmentImport.service.js — Phase 3 Module 2: Evalground bulk-CSV import.
 *
 * Bulk-CSV path only (mailbox-polling ingestion is a deferred fast-follow —
 * see docs/phase3/07-EVALGROUND-IMPORT-PLAN.md §3). Row reading reuses the
 * same schema-free "flatten row → AI parses JSON" pattern already used for
 * Excel-bulk resume rows in hrUpload.service.js (~lines 1083-1101), just with
 * a different prompt/output schema.
 *
 * A real Evalground export (docs/General Aptitude, Python, SQL MCQ Test at
 * AAPNA - 2025TestReport (15) 1.csv) has no per-row "Test Name" column — a
 * "Test Report" export is scoped to one test, one row per candidate-attempt.
 * The test's identity is therefore taken from the uploaded file name
 * (verbatim, minus extension) rather than a row column, unless a row itself
 * carries an explicit test-name-like field (checked first, for exports that
 * do include one).
 */
import path from 'path';
import XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import redis from '../config/redis.js';
import AppError, { AIModelError } from '../utils/AppError.js';
import { generateContentWithFallback } from '../utils/geminiHelper.js';
import * as onedriveService from './onedrive.service.js';
import { emitToRole } from '../socket/index.js';
import { setStageOutcome } from './pipeline.service.js';
import { STAGE_KEYS } from '../config/pipelineStages.js';
import { notify, NOTIFICATION_TYPES } from './notification.service.js';
import { getAssessmentAutomationSettings } from './assessmentSettings.service.js';

const PREVIEW_KEY_PREFIX = 'assessment-import:preview:';
const PREVIEW_TTL_SECONDS = 3600;
const AI_CONCURRENCY = 5;
const SECTION_KEYS = ['section_1', 'section_2', 'section_3'];

const serializeBigInts = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? Number(v) : v)));

// ── Row extraction (mirrors hrUpload.service.js's Excel-row AI-parse pattern) ─

/**
 * Reads every row of a .csv/.xlsx file and flattens each to plain `key: value`
 * text — the exact same shape hrUpload.service.js hands to its AI parser.
 * @param {string} filePath
 * @returns {{ rowNumber: number, rawText: string }[]}
 */
function extractRowsFromFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet);
  if (rows.length === 0) {
    throw new AppError('File contains no data rows.', 400);
  }
  return rows.map((row, idx) => ({
    rowNumber: idx + 2, // header is row 1
    rawText: Object.entries(row).map(([k, v]) => `${k}: ${v ?? ''}`).join('\n'),
  }));
}

/** Uploaded file name, minus extension, used verbatim as the test identity. */
function deriveTestNameFromFileName(originalName) {
  return path.basename(originalName, path.extname(originalName)).trim();
}

// ── AI row parsing (one call per row) ─────────────────────────────────────

async function parseRowWithAI(rawText) {
  const prompt = `You are a strict JSON parser for a single row of an Evalground assessment result export (CSV/Excel).
Rules (IMPORTANT):
1. Return ONLY valid JSON matching the schema below. No markdown, no explanations, no comments.
2. Never invent or guess an email address. If no email is present in the row text, return null for "email".
3. "section1Marks"/"section2Marks"/"section3Marks" are the raw MARKS awarded for that section (a number), NOT a percentage. Prefer a field literally named "Section 1 Marks"/"Section 2 Marks"/"Section 3 Marks" (or "Section 1"/"Section 2"/"Section 3") over other section-related columns (ignore per-difficulty/correct/wrong/unattempted breakdown columns). If a section isn't present in this row, return null for it.
4. "overallPercentage" is the overall percentage score for the whole test (a number, e.g. 96.49), usually a column literally named "Percentage".
5. "overallResult" is the vendor's own overall pass/fail verdict for the whole test (e.g. "Passed", "Failed"), usually a column literally named "Result".
6. "testName" — ONLY set this if the row itself contains an explicit test/assessment name field (e.g. a "Test Name" or "Assessment Name" column). Otherwise return null — do not guess or invent one.
7. "overallMarksScored" is the RAW total marks scored across the whole test (a number, e.g. 55), usually a column literally named "Marks Scored". This is NOT the same as "overallPercentage" and NOT the vendor's own "overallResult" — do not derive it from either.

Schema:
{
  "email": string|null,
  "name": string|null,
  "testName": string|null,
  "section1Marks": number|null,
  "section2Marks": number|null,
  "section3Marks": number|null,
  "overallPercentage": number|null,
  "overallResult": string|null,
  "overallMarksScored": number|null
}

Row data:
---
${rawText}
---
`;

  try {
    const rawResponse = await generateContentWithFallback(prompt, {
      generationConfig: { responseMimeType: 'application/json' },
    });
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1) {
      throw new Error('No JSON found in LLM output');
    }
    return JSON.parse(rawResponse.slice(startIdx, endIdx + 1));
  } catch (err) {
    logger.error('Failed to parse assessment row via AI:', { error: err.message });
    throw new AIModelError('AI processing failed. Please try again or contact support.');
  }
}

/** One AI call per NEW distinct test-name cluster — never per row. */
async function suggestMappingWithAI(testName) {
  const prompt = `You are helping map the generic "Section 1/2/3" scores of an Evalground assessment test onto skill labels, based only on the test's name.

Test name: "${testName}"

For each of Section 1, Section 2, and Section 3, suggest:
- "skill_label": a short human-readable skill name this section most likely tests (e.g. "General Aptitude", "Python", "SQL", "English", "Problem Solving").
- "legacy_field": one of "IQScore" (use ONLY for a General Aptitude / reasoning / IQ-style section), "TechScore" (use for the PRIMARY role-specific technical/coding section), or null (any other section that doesn't map cleanly to either — e.g. English or a secondary technical topic).

Exactly one section should normally get "IQScore" and exactly one should normally get "TechScore" — pick the single best-fitting section for each; use null for the rest.

Return ONLY this JSON schema, no markdown, no explanation:
{
  "section_1": { "skill_label": string, "legacy_field": "IQScore"|"TechScore"|null },
  "section_2": { "skill_label": string, "legacy_field": "IQScore"|"TechScore"|null },
  "section_3": { "skill_label": string, "legacy_field": "IQScore"|"TechScore"|null }
}

Example: test name "Java Developer - Technical Assessment" -> section_1 = General Aptitude (IQScore), section_2 = Java (TechScore), section_3 = Problem Solving (null).`;

  try {
    const rawResponse = await generateContentWithFallback(prompt, {
      generationConfig: { responseMimeType: 'application/json' },
    });
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1) {
      throw new Error('No JSON found in LLM output');
    }
    return JSON.parse(rawResponse.slice(startIdx, endIdx + 1));
  } catch (err) {
    logger.error('Failed to suggest section mapping via AI:', { error: err.message });
    throw new AIModelError('AI processing failed. Please try again or contact support.');
  }
}

/** Bounded-concurrency map — batches are small (tens of rows), so preview stays synchronous. */
async function mapWithConcurrency(items, worker, concurrency = AI_CONCURRENCY) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runNext() {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
}

// ── Candidate + concurrent-journey matching ───────────────────────────────

/**
 * Matches an email to an open Assessment-stage journey. If more than one
 * open journey exists for the same email (concurrent MRFs), only the most
 * recently-entered one is auto-matched — the rest are reported, never
 * silently applied (Phase 3 M2 decision, resolving doc 04's Q24).
 */
async function matchRowToPipeline(email) {
  if (!email) {
    return { cvId: null, matchedPipelineId: null, otherOpenPipelineIds: [], matchNote: 'No email on this row.' };
  }

  const rows = await prisma.$queryRaw`
    SELECT p.id AS pipeline_id, cv.id AS cv_id, ev.entered_at
    FROM rpa_cv cv
    JOIN rpa_candidate_pipeline p ON p.cv_id = cv.id
    LEFT JOIN LATERAL (
      SELECT MAX(created_at) AS entered_at
      FROM rpa_pipeline_stage_events
      WHERE pipeline_id = p.id AND stage_key = 'assessment' AND event_type IN ('entered', 'skip')
    ) ev ON true
    WHERE cv."EmailID" ILIKE ${email}
      AND p.current_stage_key = 'assessment'
      AND p.current_stage_status = 'in_progress'
    ORDER BY ev.entered_at DESC NULLS LAST, p.id DESC;
  `;

  if (!rows || rows.length === 0) {
    const cvRows = await prisma.$queryRaw`SELECT id FROM rpa_cv WHERE "EmailID" ILIKE ${email} LIMIT 1;`;
    const cvId = cvRows?.[0]?.id ?? null;
    return {
      cvId,
      matchedPipelineId: null,
      otherOpenPipelineIds: [],
      matchNote: cvId ? 'Candidate found, but no open Assessment-stage journey.' : 'No candidate found for this email.',
    };
  }

  const [winner, ...rest] = rows;
  return {
    cvId: winner.cv_id,
    matchedPipelineId: winner.pipeline_id,
    otherOpenPipelineIds: rest.map((r) => r.pipeline_id),
    matchNote: rest.length > 0
      ? `Multiple open Assessment journeys for this email — auto-matched to pipeline ${winner.pipeline_id} (most recently entered); ${rest.length} other open journey(s) not applied: ${rest.map((r) => r.pipeline_id).join(', ')}.`
      : null,
  };
}

// ── Retake / skip-unless-changed (scoped to pipeline_id + test_name) ──────

async function computeRowStatus(pipelineId, testName, sections) {
  if (!pipelineId) return { status: 'unmatched', existing: null };

  const existing = await prisma.rpa_assessment_results.findFirst({
    where: { pipeline_id: BigInt(pipelineId), test_name: testName },
    orderBy: { created_at: 'desc' },
  });

  if (!existing) return { status: 'matched', existing: null };

  const unchanged = ['section_1_score', 'section_2_score', 'section_3_score'].every((key, i) => {
    const prev = existing[key] === null || existing[key] === undefined ? null : Number(existing[key]);
    const next = sections[i] === null || sections[i] === undefined ? null : Number(sections[i]);
    return prev === next;
  });

  return { status: unchanged ? 'duplicate_skipped' : 'score_overwritten', existing };
}

// ── Preview orchestration ──────────────────────────────────────────────────

/**
 * Parses an uploaded file, suggests/looks-up section→skill mappings per test
 * cluster, matches candidates, and computes what would happen on commit —
 * without writing anything to the database yet.
 */
export async function previewImport({ filePath, originalName, uploadedByUser }) {
  const rawRows = extractRowsFromFile(filePath);
  const fileTestName = deriveTestNameFromFileName(originalName);

  const parsedRows = await mapWithConcurrency(rawRows, async (row) => {
    try {
      const parsed = await parseRowWithAI(row.rawText);
      return { rowNumber: row.rowNumber, parsed, error: null };
    } catch (err) {
      return { rowNumber: row.rowNumber, parsed: null, error: err.message };
    }
  });

  // Resolve test name per row (explicit in-row field wins, else the file name) and cluster.
  const rowsWithTestName = parsedRows.map((r) => ({
    ...r,
    testName: (r.parsed?.testName && String(r.parsed.testName).trim()) || fileTestName,
  }));

  const clusterMap = new Map();
  for (const row of rowsWithTestName) {
    if (!clusterMap.has(row.testName)) clusterMap.set(row.testName, []);
    clusterMap.get(row.testName).push(row.rowNumber);
  }

  const clusters = [];
  for (const [testName, rowNumbers] of clusterMap.entries()) {
    const remembered = await prisma.rpa_assessment_test_mappings.findUnique({ where: { test_name: testName } });
    const mapping = remembered
      ? remembered.section_label_map
      : await suggestMappingWithAI(testName);
    clusters.push({ testName, rowCount: rowNumbers.length, remembered: !!remembered, mapping });
  }
  const mappingByTestName = new Map(clusters.map((c) => [c.testName, c.mapping]));

  let matched = 0;
  let unmatched = 0;
  let duplicateSkipped = 0;
  let scoreWillOverwrite = 0;
  let malformed = 0;

  const rows = [];
  for (const row of rowsWithTestName) {
    if (row.error || !row.parsed?.email) {
      malformed += 1;
      rows.push({
        rowNumber: row.rowNumber,
        email: row.parsed?.email || null,
        testName: row.testName,
        status: 'error',
        detail: row.error || 'No email found on this row.',
      });
      continue;
    }

    const email = String(row.parsed.email).toLowerCase().trim();
    const match = await matchRowToPipeline(email);
    const sections = [row.parsed.section1Marks ?? null, row.parsed.section2Marks ?? null, row.parsed.section3Marks ?? null];
    const { status } = match.matchedPipelineId
      ? await computeRowStatus(match.matchedPipelineId, row.testName, sections)
      : { status: 'unmatched' };

    if (status === 'matched') matched += 1;
    else if (status === 'score_overwritten') scoreWillOverwrite += 1;
    else if (status === 'duplicate_skipped') duplicateSkipped += 1;
    else unmatched += 1;

    rows.push({
      rowNumber: row.rowNumber,
      email,
      name: row.parsed.name || null,
      testName: row.testName,
      section1Marks: row.parsed.section1Marks ?? null,
      section2Marks: row.parsed.section2Marks ?? null,
      section3Marks: row.parsed.section3Marks ?? null,
      overallPercentage: row.parsed.overallPercentage ?? null,
      overallResult: row.parsed.overallResult ?? null,
      overallMarksScored: row.parsed.overallMarksScored ?? null,
      cvId: match.cvId,
      matchedPipelineId: match.matchedPipelineId,
      otherOpenPipelineIds: match.otherOpenPipelineIds,
      matchNote: match.matchNote,
      status,
    });
  }

  let rawFileUrl = `/uploads/${path.basename(filePath)}`;
  try {
    const onedriveUrl = await onedriveService.uploadFileToOneDrive(filePath, originalName);
    if (onedriveUrl) rawFileUrl = onedriveUrl;
  } catch (err) {
    logger.warn(`OneDrive upload failed for assessment import file ${originalName}, using local fallback: ${err.message}`);
  }

  const batchId = uuidv4();
  const payload = {
    batchId,
    fileName: originalName,
    rawFileUrl,
    uploadedByUser,
    clusters,
    rows,
  };
  // rows[].cvId/matchedPipelineId/otherOpenPipelineIds come straight from raw
  // SQL ($queryRaw) and are native BigInt — must be sanitized before caching,
  // same as every other place this service hands data back across a boundary.
  await redis.setex(`${PREVIEW_KEY_PREFIX}${batchId}`, PREVIEW_TTL_SECONDS, JSON.stringify(serializeBigInts(payload)));

  return serializeBigInts({
    batchId,
    fileName: originalName,
    totalRows: rows.length,
    matched,
    unmatched,
    duplicateSkipped,
    scoreWillOverwrite,
    malformed,
    clusters: clusters.map((c) => ({ testName: c.testName, rowCount: c.rowCount, remembered: c.remembered, mapping: c.mapping })),
    rows,
  });
}

// ── Commit orchestration ───────────────────────────────────────────────────

/**
 * Applies a (possibly HR-edited) set of cluster mappings and row overrides,
 * writes rpa_assessment_imports/rpa_assessment_results/rpa_assessment_test_mappings,
 * writes back rpa_cv.IQScore/TechScore/FinalStatus, and notifies recruiters.
 */
export async function commitImport({ batchId, clusterMappings = [], rowOverrides = {}, actedByUser }) {
  const cacheKey = `${PREVIEW_KEY_PREFIX}${batchId}`;
  const cached = await redis.get(cacheKey);
  if (!cached) {
    throw new AppError('This preview has expired — please re-upload the file.', 410);
  }
  const payload = JSON.parse(cached);

  // Assessment automation (deadline-days is read elsewhere, by assessmentInvite.service.js) —
  // when OFF (default), every matched row behaves exactly as before this feature existed.
  const automation = await getAssessmentAutomationSettings();
  const failedThresholdReason = automation.autoAdvanceEnabled
    ? await prisma.rpa_outcome_reasons.findFirst({ where: { reason_label: 'Failed Assessment Threshold', is_active: true } })
    : null;
  if (automation.autoAdvanceEnabled && !failedThresholdReason) {
    logger.warn('assessment_auto_advance_enabled is ON but no active "Failed Assessment Threshold" reason was found — auto-reject skipped this run; failing rows fall back to manual review.');
  }

  const overrideByTestName = new Map(clusterMappings.map((c) => [c.testName, c.mapping]));
  const resolvedMappingByTestName = new Map(
    payload.clusters.map((c) => [c.testName, overrideByTestName.get(c.testName) || c.mapping])
  );

  const importRow = await prisma.rpa_assessment_imports.create({
    data: {
      mechanism: 'bulk_csv',
      file_name: payload.fileName,
      raw_file_url: payload.rawFileUrl,
      uploaded_by: actedByUser?.username || payload.uploadedByUser?.username || null,
      uploaded_by_id: actedByUser?.id || payload.uploadedByUser?.id || null,
      total_rows: payload.rows.length,
    },
  });

  // Remember every cluster's confirmed mapping (new or corrected) for future imports.
  for (const cluster of payload.clusters) {
    const mapping = resolvedMappingByTestName.get(cluster.testName);
    await prisma.rpa_assessment_test_mappings.upsert({
      where: { test_name: cluster.testName },
      update: {
        section_label_map: mapping,
        confirmed_by: actedByUser?.username || null,
        confirmed_by_id: actedByUser?.id || null,
        confirmed_at: new Date(),
        modified_at: new Date(),
      },
      create: {
        test_name: cluster.testName,
        section_label_map: mapping,
        confirmed_by: actedByUser?.username || null,
        confirmed_by_id: actedByUser?.id || null,
        first_import_id: importRow.id,
      },
    });
  }

  let matchedCount = 0;
  let unmatchedCount = 0;
  let duplicateSkippedCount = 0;
  let errorCount = 0;

  for (const row of payload.rows) {
    if (row.status === 'error') {
      errorCount += 1;
      await prisma.rpa_assessment_results.create({
        data: {
          import_id: importRow.id,
          pipeline_id: null,
          cv_id: null,
          test_name: row.testName,
          section_label_map: resolvedMappingByTestName.get(row.testName) || {},
          email_matched: row.email || '',
          match_note: row.detail || 'Malformed row.',
          source_row_number: row.rowNumber,
          status: 'error',
        },
      });
      continue;
    }

    const override = rowOverrides[row.rowNumber];
    const pipelineId = override?.pipelineId || row.matchedPipelineId;
    const mapping = resolvedMappingByTestName.get(row.testName) || {};
    const sections = [row.section1Marks ?? null, row.section2Marks ?? null, row.section3Marks ?? null];

    const { status: computedStatus, existing } = pipelineId
      ? await computeRowStatus(pipelineId, row.testName, sections)
      : { status: 'unmatched', existing: null };

    if (computedStatus === 'duplicate_skipped') {
      duplicateSkippedCount += 1;
      continue; // skip-unless-changed — no write at all, not even modified_at
    }

    if (computedStatus === 'unmatched' || !pipelineId) {
      unmatchedCount += 1;
      await prisma.rpa_assessment_results.create({
        data: {
          import_id: importRow.id,
          pipeline_id: null,
          cv_id: row.cvId ? BigInt(row.cvId) : null,
          test_name: row.testName,
          section_label_map: mapping,
          section_1_score: sections[0],
          section_2_score: sections[1],
          section_3_score: sections[2],
          overall_percentage: row.overallPercentage ?? null,
          overall_result: row.overallResult ?? null,
          overall_marks_scored: row.overallMarksScored ?? null,
          email_matched: row.email,
          match_note: row.matchNote,
          source_row_number: row.rowNumber,
          status: 'unmatched',
        },
      });
      continue;
    }

    // matched or score_overwritten
    if (existing) {
      await prisma.rpa_assessment_results.update({
        where: { id: existing.id },
        data: {
          import_id: importRow.id,
          section_1_score: sections[0],
          section_2_score: sections[1],
          section_3_score: sections[2],
          overall_percentage: row.overallPercentage ?? null,
          overall_result: row.overallResult ?? null,
          overall_marks_scored: row.overallMarksScored ?? null,
          status: 'score_overwritten',
          modified_at: new Date(),
        },
      });
    } else {
      await prisma.rpa_assessment_results.create({
        data: {
          import_id: importRow.id,
          pipeline_id: BigInt(pipelineId),
          cv_id: row.cvId ? BigInt(row.cvId) : null,
          test_name: row.testName,
          section_label_map: mapping,
          section_1_score: sections[0],
          section_2_score: sections[1],
          section_3_score: sections[2],
          overall_percentage: row.overallPercentage ?? null,
          overall_result: row.overallResult ?? null,
          overall_marks_scored: row.overallMarksScored ?? null,
          email_matched: row.email,
          match_note: row.matchNote,
          source_row_number: row.rowNumber,
          status: 'matched',
        },
      });
    }
    matchedCount += 1;

    // Legacy IQScore/TechScore writeback — unconditional, independent of any
    // automation setting. Best effort, mirrors zeko.service.js's fetchInterviewResults().
    try {
      if (row.cvId) {
        for (let i = 0; i < SECTION_KEYS.length; i += 1) {
          const legacyField = mapping[SECTION_KEYS[i]]?.legacy_field;
          const value = sections[i];
          if (value === null || value === undefined) continue;
          if (legacyField === 'IQScore') {
            await prisma.$executeRaw`UPDATE rpa_cv SET "IQScore" = ${String(value)} WHERE id = ${BigInt(row.cvId)};`;
          } else if (legacyField === 'TechScore') {
            await prisma.$executeRaw`UPDATE rpa_cv SET "TechScore" = ${String(value)} WHERE id = ${BigInt(row.cvId)};`;
          }
        }
      }
    } catch (err) {
      logger.error(`Assessment import IQScore/TechScore write-back failed for pipeline ${pipelineId}: ${err.message}`);
    }

    // Auto-advance/auto-reject — OFF by default (assessment_auto_advance_enabled).
    // The FIRST non-recruiter-initiated stage outcome in this codebase: when ON,
    // this calls the exact same setStageOutcome() a manual Approve/Reject click
    // uses, including its real outcome email (through the existing
    // EMAIL_REDIRECT_TO_TEST-safe send path) and, for 'approved', its automatic
    // advance to the next stage — with zero recruiter click in the loop.
    let autoOutcomeApplied = false;
    const marksScored = row.overallMarksScored ?? null;

    // STAGE GATE — the candidate must still be ON the assessment round.
    //
    // setStageOutcome() resolves the outcome against the journey's CURRENT
    // stage, not the stage the CSV is about. Without this check, re-importing
    // an older Evalground export for someone who has since moved to Tech 1
    // would approve them out of TECH 1 and advance them to Tech 2 — a round
    // they never sat. Same for a candidate already closed, or one whose result
    // arrives after a recruiter decided the round manually.
    //
    // The result itself is still recorded either way (above); only the
    // automatic outcome is skipped. A row that fails this gate falls through to
    // the manual path, which is exactly what a human would want to review.
    let onAssessmentStage = false;
    if (automation.autoAdvanceEnabled && pipelineId) {
      const journey = await prisma.rpa_candidate_pipeline.findUnique({
        where: { id: BigInt(pipelineId) },
        select: { current_stage_key: true, final_outcome: true },
      });
      onAssessmentStage = journey?.current_stage_key === STAGE_KEYS.ASSESSMENT && !journey.final_outcome;
      if (!onAssessmentStage) {
        logger.info(
          `Assessment auto-advance skipped for pipeline ${pipelineId} (row ${row.rowNumber}): candidate is at "${journey?.current_stage_key || 'unknown'}"${journey?.final_outcome ? ' and closed' : ''}, not the assessment round. Result recorded for manual review.`
        );
      }
    }

    if (automation.autoAdvanceEnabled && pipelineId && marksScored !== null && onAssessmentStage) {
      try {
        if (Number(marksScored) > 50) {
          await setStageOutcome(pipelineId, {
            outcomeKey: 'approved',
            actedBy: null,
            notes: `Auto-approved — Evalground "Marks Scored" ${marksScored} > 50 (test "${row.testName}"). Assessment automation is ON.`,
          });
          autoOutcomeApplied = true;
        } else if (failedThresholdReason) {
          await setStageOutcome(pipelineId, {
            outcomeKey: 'rejected',
            reasonId: Number(failedThresholdReason.id),
            actedBy: null,
            notes: `Auto-rejected — Evalground "Marks Scored" ${marksScored} <= 50 (test "${row.testName}"). Assessment automation is ON.`,
          });
          autoOutcomeApplied = true;
        }
        // else: score <= 50 and no active "Failed Assessment Threshold" reason
        // found — falls through to the manual path below for THIS row only.
      } catch (err) {
        logger.error(`Assessment auto-advance/-reject failed for pipeline ${pipelineId} (row ${row.rowNumber}): ${err.message}`);
        autoOutcomeApplied = false; // never lose the row — fall back to the manual path below
      }
    }

    if (autoOutcomeApplied) continue; // outcome's own writeback supersedes 'Evalground Test Shared' immediately

    // Manual path (automation OFF, or ON but this row didn't qualify): result
    // shared with the recruitment team, HR decision still pending — NOT a
    // stage outcome, so no seed-pipeline-stages.js/OUTCOME_BUTTONS change
    // involved. HR's actual Pass/Fail/Hold click goes through the existing
    // setStageOutcome(), which independently writes 'Evalground Test
    // Passed'/'Failed'/'On Hold' via finalStatusLabelFor().
    try {
      if (row.cvId) {
        await prisma.$executeRaw`UPDATE rpa_cv SET "FinalStatus" = 'Evalground Test Shared' WHERE id = ${BigInt(row.cvId)};`;
      }
      await prisma.rpa_pipeline_stage_events.create({
        data: {
          pipeline_id: BigInt(pipelineId),
          stage_key: 'assessment',
          event_type: 'note',
          status_label: 'Evalground Test Shared',
          notes: `Evalground result imported: "${row.testName}" — Section 1/2/3: ${sections.map((s) => (s === null ? '—' : s)).join(' / ')}${row.overallResult ? ` (vendor result: ${row.overallResult})` : ''}.`,
          acted_by: actedByUser?.id || null,
        },
      });
    } catch (err) {
      logger.error(`Assessment import legacy write-back failed for pipeline ${pipelineId}: ${err.message}`);
    }
  }

  await prisma.rpa_assessment_imports.update({
    where: { id: importRow.id },
    data: {
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      duplicate_skipped_count: duplicateSkippedCount,
      error_count: errorCount,
      modified_at: new Date(),
    },
  });

  await redis.del(cacheKey);

  const summary = {
    importId: importRow.id,
    matched: matchedCount,
    unmatched: unmatchedCount,
    duplicateSkipped: duplicateSkippedCount,
    error: errorCount,
  };

  try {
    // Kept: AssessmentImportModal and other open views still listen for this to
    // refresh themselves. The bell now reads from rpa_notifications instead.
    emitToRole('recruiter', 'assessment:import_done', serializeBigInts(summary));
  } catch (err) {
    logger.warn(`assessment:import_done emit failed: ${err.message}`);
  }

  await notify({
    type: NOTIFICATION_TYPES.ASSESSMENT_IMPORT_DONE,
    title: 'Evalground results imported',
    description: `${matchedCount} matched${unmatchedCount ? `, ${unmatchedCount} unmatched` : ''}${duplicateSkippedCount ? `, ${duplicateSkippedCount} unchanged` : ''}`,
    linkPath: '/pipeline',
    meta: serializeBigInts(summary),
  });

  return serializeBigInts(summary);
}

// ── Candidate-facing read (drives the Assessment round panel) ────────────

export async function getAssessmentResultForPipeline(pipelineId) {
  const result = await prisma.rpa_assessment_results.findFirst({
    where: { pipeline_id: BigInt(pipelineId), status: { in: ['matched', 'score_overwritten'] } },
    orderBy: { modified_at: 'desc' },
  });

  if (!result) {
    return serializeBigInts({ result: null, suggestedOutcome: null, pending: true });
  }

  const overallResult = (result.overall_result || '').trim().toLowerCase();
  const suggestedOutcome = overallResult === 'passed' ? 'approved' : overallResult === 'failed' ? 'rejected' : null;

  return serializeBigInts({ result, suggestedOutcome, pending: false });
}

// ── History ────────────────────────────────────────────────────────────────

export async function listImportHistory({ page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.rpa_assessment_imports.findMany({ orderBy: { uploaded_at: 'desc' }, skip, take: limit }),
    prisma.rpa_assessment_imports.count(),
  ]);
  return { rows: serializeBigInts(rows), total };
}
