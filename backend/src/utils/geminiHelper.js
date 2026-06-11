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
 * Call Gemini (with OpenRouter try first) with robust fallback and retry on 429/503/Quota issues.
 * @param {string} prompt - The prompt to send
 * @param {Object} options - Generation options (e.g. responseMimeType)
 * @returns {Promise<string>} The response text
 */
export async function generateContentWithFallback(prompt, options = {}) {
  // 1) Try OpenRouter if configured
  if (config.openrouter?.apiKey) {
    try {
      const modelName = config.openrouter.model || 'openai/gpt-4.1-nano';
      logger.info(`[Gemini Helper] Attempting content generation with OpenRouter model: ${modelName}`);

      const headers = {
        'Authorization': `Bearer ${config.openrouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/google/antigravity',
        'X-Title': 'ATS Migration'
      };

      const body = {
        model: modelName,
        messages: [{ role: 'user', content: prompt }]
      };

      if (options.generationConfig?.responseMimeType === 'application/json') {
        body.response_format = { type: 'json_object' };
      }

      const baseUrl = config.openrouter.baseUrl || 'https://openrouter.ai/api/v1';
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (Status ${response.status}): ${errorText}`);
      }

      const responseData = await response.json();
      if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
        return responseData.choices[0].message.content;
      }
      throw new Error('Invalid response structure from OpenRouter API.');
    } catch (err) {
      logger.warn(`[Gemini Helper] OpenRouter content generation failed: ${err.message}. falling back to Gemini...`);
    }
  }

  // 2) Fallback to Gemini
  if (!genAI) {
    throw new Error('Neither OpenRouter nor Gemini API keys are configured.');
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

  throw lastError || new Error('All Gemini and OpenRouter models failed to generate content.');
}
