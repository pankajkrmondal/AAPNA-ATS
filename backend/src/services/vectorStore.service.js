import { GoogleGenerativeAI } from '@google/generative-ai';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { sendRerankApiAlert } from './emailNotification.service.js';

// Cohere Rerank's documented per-request document ceiling — batch and merge
// instead of silently truncating the candidate pool before scoring.
const COHERE_MAX_DOCUMENTS = 1000;
// Bounded fallback size shown to the recruiter if the Rerank API fails —
// keeps the UI usable (and fast) instead of erroring out or dumping an
// unranked, unbounded list.
const RERANK_DEGRADED_FALLBACK_SIZE = 250;
// Candidate pool is no longer capped before reranking (see searchRoleCandidates/
// searchKeywordCandidates), so a very broad search can produce many batches. This
// bounds how many Cohere requests run AT ONCE — protects a free/trial API key's
// requests-per-minute limit regardless of pool size, without capping how many
// candidates eventually get reranked (batches just queue instead of failing).
const RERANK_MAX_CONCURRENT_BATCHES = 5;

/** Runs `worker` over `items` with at most `limit` calls in flight at once. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runNext() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

let genAI = null;
if (config.gemini.apiKey) {
  genAI = new GoogleGenerativeAI(config.gemini.apiKey);
}

/**
 * Generate vector embedding using Google Gemini API
 * @param {string} text - The input text to embed
 * @returns {Promise<number[]>} The vector embedding array
 */
export async function generateEmbedding(text) {
  if (!genAI) {
    throw new Error('Gemini API key is not configured for vector embeddings.');
  }

  const modelName = 'gemini-embedding-001';
  let lastError = null;

  // Try generating embedding with retry logic
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.embedContent(text);
      if (result && result.embedding && result.embedding.values) {
        return result.embedding.values;
      }
      throw new Error('Invalid embedding response format from Gemini.');
    } catch (err) {
      lastError = err;
      logger.warn(`Failed to generate embedding (attempt ${attempt}/3): ${err.message}`);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  throw lastError || new Error('All attempts to generate vector embedding failed.');
}

/**
 * Enriches candidate data, generates embedding, and saves to rpa_cv_vectors
 * @param {number|bigint} candidateId - The database ID of the candidate in rpa_cv
 * @param {Object} parsedData - The parsed candidate fields from Gemini
 * @returns {Promise<Object>} The metadata stored
 */
export async function saveCandidateVector(candidateId, parsedData) {
  const numericId = Number(candidateId);
  try {
    const email = parsedData.EmailID || parsedData.unique_key || '';
    if (!email) {
      logger.warn(`Skipping vector generation for candidate ${candidateId} because EmailID is missing.`);
      return null;
    }

    // Acquire lock
    try {
      await prisma.rpa_cv.update({
        where: { id: BigInt(numericId) },
        data: { cvVectorLock: 'resume' }
      });
    } catch (lockErr) {
      logger.warn(`Failed to set cvVectorLock for candidate ${numericId}: ${lockErr.message}`);
    }
    
    // Build enriched data object exactly as n8n does
    const enrichedData = {
      id: numericId,
      ...parsedData
    };
    
    const vectorText = JSON.stringify(enrichedData, null, 2);
    
    logger.info(`Generating vector embedding for candidate ${numericId} (${email})...`);
    const embedding = await generateEmbedding(vectorText);
    const vectorStr = `[${embedding.join(',')}]`;
    
    const metadata = {
      EmailID: email,
      id: numericId
    };

    // Use transaction/raw queries to update vector store
    await prisma.$transaction(async (tx) => {
      // 1) Delete existing vector for this candidate (by candidate_id, unique_key or metadata EmailID)
      await tx.$executeRaw`
        DELETE FROM public.rpa_cv_vectors 
        WHERE candidate_id = ${numericId} OR unique_key = ${email} OR metadata->>'EmailID' = ${email}
      `;
      
      // 2) Insert new vector
      await tx.$executeRawUnsafe(
        `INSERT INTO public.rpa_cv_vectors (id, text, metadata, embedding, unique_key, candidate_id)
         VALUES (gen_random_uuid(), $1, $2, $3::vector, $4, $5)`,
        vectorText,
        metadata,
        vectorStr,
        email,
        numericId
      );
    });

    logger.info(`Successfully stored vector embedding in DB for candidate ${numericId}`);
    return metadata;
  } catch (err) {
    logger.error(`Error saving candidate vector to store for candidate ${candidateId}:`, {
      error: err.message
    });
    return null;
  } finally {
    // Release lock
    try {
      await prisma.rpa_cv.update({
        where: { id: BigInt(numericId) },
        data: { cvVectorLock: null }
      });
      logger.debug(`Cleared cvVectorLock for candidate ${numericId}`);
    } catch (unlockErr) {
      logger.error(`Failed to clear cvVectorLock for candidate ${numericId}: ${unlockErr.message}`);
    }
  }
}

/** Builds the per-candidate document text sent to Cohere for one rerank call. */
function toDocument(c) {
  return c.text || JSON.stringify({
    id: Number(c.id),
    Name: c.Name,
    TotalExperienceYears: c.TotalExperienceYears,
    CurrentCompany: c.CurrentCompany,
    Top5KeySkills: c.Top5KeySkills,
    HighestQualification: c.HighestQualification,
    CurrentLocation: c.CurrentLocation,
    ExpectedCTC_LPA: c.ExpectedCTC_LPA,
    NoticePeriod: c.NoticePeriod,
    resume_technical_terms: c.resume_technical_terms
  });
}

/** One Cohere Rerank call for a single batch (<= COHERE_MAX_DOCUMENTS documents). */
async function rerankBatch(query, batch) {
  const documents = batch.map(toDocument);

  const response = await fetch(config.cohere.baseUrl || 'https://api.cohere.com/v2/rerank', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'Authorization': `Bearer ${config.cohere.apiKey}`
    },
    body: JSON.stringify({
      model: config.cohere.model || 'rerank-v3.5',
      query,
      documents,
      top_n: documents.length
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Cohere Rerank API error (Status ${response.status}): ${errText}`);
  }

  const result = await response.json();
  if (!result || !Array.isArray(result.results)) {
    throw new Error('Invalid response format from Cohere Rerank API.');
  }

  return result.results.map(r => ({ ...batch[r.index], cohereScore: r.relevance_score }));
}

/**
 * Rerank candidate search results using the Cohere Rerank API. Reranks the
 * FULL candidate pool (batched under the hood if it exceeds Cohere's
 * per-request document ceiling) rather than an arbitrary top-N slice, so a
 * later deterministic score-threshold — not this step — decides what counts
 * as "matching". On any API failure, falls back to a bounded, unranked
 * (base vector-distance order) list and fires an internal alert email so the
 * degradation is visible and actionable, instead of erroring out for the
 * recruiter or silently returning an unbounded unranked list.
 *
 * @param {string} query - The search query/keyword
 * @param {Array} candidates - The list of pre-filtered candidates from database
 * @param {number} [topN] - Number of ranked candidates to return; defaults to the full pool
 * @returns {Promise<{ candidates: Array, degraded: boolean, degradedReason: string|null }>}
 */
export async function rerankCandidates(query, candidates, topN = null) {
  if (!candidates || candidates.length === 0) {
    return { candidates: [], degraded: false, degradedReason: null };
  }

  const effectiveTopN = topN || candidates.length;

  if (!config.cohere?.apiKey) {
    logger.warn('Cohere API key is not configured. Skipping Cohere reranking.');
    return { candidates: candidates.slice(0, effectiveTopN), degraded: false, degradedReason: null };
  }

  try {
    logger.info(`Sending ${candidates.length} candidates to Cohere Rerank for query "${query}"`);

    const batches = [];
    for (let i = 0; i < candidates.length; i += COHERE_MAX_DOCUMENTS) {
      batches.push(candidates.slice(i, i + COHERE_MAX_DOCUMENTS));
    }

    const scoredBatches = await mapWithConcurrency(batches, RERANK_MAX_CONCURRENT_BATCHES, (batch) => rerankBatch(query, batch));
    const scored = scoredBatches.flat();
    scored.sort((a, b) => b.cohereScore - a.cohereScore);

    return { candidates: scored.slice(0, effectiveTopN), degraded: false, degradedReason: null };
  } catch (err) {
    // Cohere's HTTP status is embedded in the message by rerankBatch() above
    // ("Cohere Rerank API error (Status 429): ...") — cheap, reliable way to tell
    // a rate-limit hit apart from an outage/auth/config failure without a second
    // round-trip. Matters more now that the candidate pool isn't capped before
    // reranking, so a broad search can produce many more batches than before.
    const isRateLimited = /status 429/i.test(err.message) || /rate.?limit/i.test(err.message);
    logger.error('Failed to rerank candidates with Cohere, falling back to a bounded list:', {
      error: err.message,
      rateLimited: isRateLimited,
    });

    // Non-blocking: the alert must never delay or fail the recruiter's search.
    sendRerankApiAlert({ query, candidateCount: candidates.length, errorMessage: err.message, rateLimited: isRateLimited }).catch(() => {});

    const shown = Math.min(RERANK_DEGRADED_FALLBACK_SIZE, candidates.length);
    return {
      candidates: candidates.slice(0, RERANK_DEGRADED_FALLBACK_SIZE),
      degraded: true,
      degradedReason: `Candidate ranking service is temporarily ${isRateLimited ? 'busy' : 'unavailable'} — showing the top ${shown} of ${candidates.length} matches by base relevance. Our team has been notified.`,
    };
  }
}

