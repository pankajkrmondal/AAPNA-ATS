import { generateContentWithFallback } from '../utils/geminiHelper.js';
import logger from '../config/logger.js';
import config from '../config/index.js';

/**
 * Calls Google Gemini / OpenRouter to parse key details from a Job Description text.
 * 
 * @param {string} jdText - Raw Job Description text content
 * @returns {Promise<Object>} - Parsed details object
 */
export async function parseJobDescription(jdText) {
  const prompt = `Extract the following details from this Job Description.

Return ONLY a raw JSON object.
Do NOT wrap the response in markdown.
Do NOT use \`\`\`json or \`\`\` code blocks.
Do NOT add explanations, comments, or text before or after the JSON.

The response MUST start with { and end with }.

Schema:
{
  "min_experience_years": number,
  "max_experience_years": number,
  "mandatory_skills": "comma separated skills",
  "good_to_have_skills": "comma separated skills",
  "education": "education requirement",
  "roles_and_responsibilities": "concise summary of main responsibilities"
}

Rules:
* If experience range appears as "2-4 years", map min=2, max=4.
* If a single experience number is given (e.g. "5+ years"), map min=5, max=null.
* Mandatory skills must be technologies explicitly required.
* Good to have skills should be optional or preferred technologies.
* Remove duplicates.
* Skills must be concise technology names only.
* roles_and_responsibilities should be a short summarized paragraph or comma-separated key responsibilities extracted from the JD.
* If a value is not found, return null.

Return valid JSON only.

Job Description:
${jdText}`;

  try {
    const responseText = await generateContentWithFallback(prompt, {
      generationConfig: { responseMimeType: 'application/json' }
    });

    let cleanedText = responseText.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }

    const parsedData = JSON.parse(cleanedText);
    return {
      min_experience_years: parsedData.min_experience_years !== undefined ? parsedData.min_experience_years : null,
      max_experience_years: parsedData.max_experience_years !== undefined ? parsedData.max_experience_years : null,
      mandatory_skills: parsedData.mandatory_skills || null,
      good_to_have_skills: parsedData.good_to_have_skills || null,
      education: parsedData.education || null,
      roles_and_responsibilities: parsedData.roles_and_responsibilities || null,
    };
  } catch (err) {
    logger.error(`Failed to parse JD using LLM helper: ${err.message}`);
    // Return fallback structure so the execution doesn't crash
    return {
      min_experience_years: null,
      max_experience_years: null,
      mandatory_skills: null,
      good_to_have_skills: null,
      education: null,
      roles_and_responsibilities: null,
    };
  }
}

