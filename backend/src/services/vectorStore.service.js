import { GoogleGenerativeAI } from '@google/generative-ai';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';

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

/**
 * Rerank candidate search results using Cohere Rerank API
 * @param {string} query - The search query/keyword
 * @param {Array} candidates - The list of pre-filtered candidates from database
 * @param {number} [topN=50] - Number of ranked candidates to return
 * @returns {Promise<Array>} Reranked candidates
 */
export async function rerankCandidates(query, candidates, topN = 50) {
  if (!config.cohere?.apiKey) {
    logger.warn('Cohere API key is not configured. Skipping Cohere reranking.');
    return candidates;
  }

  if (!candidates || candidates.length === 0) {
    return [];
  }

  try {
    logger.info(`Sending ${candidates.length} candidates to Cohere Rerank for query "${query}"`);

    const documents = candidates.map(c => {
      // Use stored vector text or construct a descriptive JSON string
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
    });

    const response = await fetch('https://api.cohere.com/v2/rerank', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'Authorization': `Bearer ${config.cohere.apiKey}`
      },
      body: JSON.stringify({
        model: 'rerank-v3.5',
        query,
        documents,
        top_n: topN
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Cohere Rerank API error (Status ${response.status}): ${errText}`);
    }

    const result = await response.json();
    if (result && Array.isArray(result.results)) {
      // Map results back to candidate objects with scores
      const scored = result.results.map(r => {
        const candidate = candidates[r.index];
        return {
          ...candidate,
          cohereScore: r.relevance_score
        };
      });

      // Sort by cohereScore DESC
      scored.sort((a, b) => b.cohereScore - a.cohereScore);
      return scored;
    }

    throw new Error('Invalid response format from Cohere Rerank API.');
  } catch (err) {
    logger.error('Failed to rerank candidates with Cohere, returning candidates in original order:', { error: err.message });
    return candidates;
  }
}

