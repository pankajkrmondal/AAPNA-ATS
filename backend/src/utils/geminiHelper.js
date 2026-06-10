import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/index.js';
import logger from '../config/logger.js';

let genAI = null;
if (config.gemini.apiKey) {
  genAI = new GoogleGenerativeAI(config.gemini.apiKey);
}

// Order of models to try in case of failure/rate limit/quota issue
const FALLBACK_MODELS = [
  config.gemini.model,
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-flash-latest',
];

const uniqueModels = [...new Set(FALLBACK_MODELS.filter(Boolean))];

/**
 * Call Gemini with robust fallback and retry on 429/503/Quota issues.
 * @param {string} prompt - The prompt to send
 * @param {Object} options - Generation options (e.g. responseMimeType)
 * @returns {Promise<string>} The response text
 */
export async function generateContentWithFallback(prompt, options = {}) {
  if (!genAI) {
    throw new Error('Gemini API key is not configured.');
  }

  let lastError = null;

  for (const modelName of uniqueModels) {
    let attempts = 0;
    const maxAttempts = 3;
    let delay = 1500; // start with 1.5s delay

    while (attempts < maxAttempts) {
      try {
        logger.info(`[Gemini Helper] Attempting content generation with model: ${modelName} (attempt ${attempts + 1}/${maxAttempts})`);
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: options.generationConfig || {}
        });

        const response = await model.generateContent(prompt);
        const text = response.response.text();
        return text;
      } catch (err) {
        lastError = err;
        attempts++;
        const isRateLimit = err.message.includes('429') || err.message.includes('503') || err.message.includes('quota');
        
        if (isRateLimit && attempts < maxAttempts) {
          logger.warn(`[Gemini Helper] Temporary error or rate limit (503/429) with model ${modelName}: ${err.message}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // exponential backoff
        } else {
          logger.warn(`[Gemini Helper] Model ${modelName} failed: ${err.message}`);
          break; // Try next model
        }
      }
    }
  }

  throw lastError || new Error('All Gemini models failed to generate content.');
}
