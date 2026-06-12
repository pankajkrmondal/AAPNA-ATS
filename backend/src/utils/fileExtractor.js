import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';

/**
 * Extracts raw text from a document buffer based on mimetype.
 * Supports PDF and DOCX.
 * 
 * @param {Buffer} buffer - File data buffer
 * @param {string} mimetype - File mimetype (e.g. application/pdf)
 * @returns {Promise<string>} - Extracted text
 */
export async function extractTextFromBuffer(buffer, mimetype) {
  if (!buffer) {
    throw new Error('Buffer is empty or undefined.');
  }

  const mime = mimetype.toLowerCase();

  if (mime === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text || '';
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword'
  ) {
    const data = await mammoth.extractRawText({ buffer });
    return data.value || '';
  }

  // Fallback to text if plaintext
  if (mime.startsWith('text/')) {
    return buffer.toString('utf8');
  }

  throw new Error(`Unsupported file type for text extraction: ${mimetype}`);
}
