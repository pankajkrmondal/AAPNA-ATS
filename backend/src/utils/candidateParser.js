/**
 * Utility helpers to parse candidate string metrics into indexed numeric fields
 */

/**
 * Extracts a float/decimal number representing experience in years
 * @param {string} expStr - e.g. "5.5 Years", "3", "Fresher"
 * @returns {number|null}
 */
export function parseExperienceNumeric(expStr) {
  if (expStr === null || expStr === undefined) return null;
  const str = String(expStr).trim();
  if (!str) return null;

  // Check for fresher/trainee variants
  if (/fresher|intern|trainee/i.test(str)) {
    return 0.0;
  }

  const match = str.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

/**
 * Extracts a float/decimal representing CTC in Lakhs Per Annum (LPA)
 * @param {string} ctcStr - e.g. "₹12 - ₹15 LPA", "12.5", "1500000"
 * @returns {number|null}
 */
export function parseExpectedCTCNumeric(ctcStr) {
  if (ctcStr === null || ctcStr === undefined) return null;
  const str = String(ctcStr).trim();
  if (!str) return null;

  // Clean formatting: remove currency symbols, commas
  const cleanStr = str.replace(/[₹$,]/g, '').trim();
  
  // Match first number
  const match = cleanStr.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (match) {
    let val = parseFloat(match[1]);
    
    // If it's a full annual salary like 1200000 (12 lakhs), divide by 100,000 to get LPA
    if (val > 1000) {
      val = val / 100000;
    }
    return val;
  }
  return null;
}

/**
 * Extracts an integer representing the notice period in days
 * @param {string} npStr - e.g. "15 Days", "Immediate", "3 Months", "Serving Notice"
 * @returns {number|null}
 */
export function parseNoticePeriodDays(npStr) {
  if (npStr === null || npStr === undefined) return null;
  const str = String(npStr).toLowerCase().trim();
  if (!str) return null;

  // Check for immediate or serving notice period
  if (str.includes('immediate') || str.includes('serving') || str === '0') {
    return 0;
  }

  const numMatch = str.match(/([0-9]+)/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    if (str.includes('month')) {
      return val * 30;
    }
    return val; // Assume days by default
  }
  return null;
}
