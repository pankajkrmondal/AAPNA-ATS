import fs from 'fs';
import path from 'path';
import logger from '../config/logger.js';
import config from '../config/index.js'; // updated env config with gemini and local uploads

let cachedToken = null;
let tokenExpiry = null;

// Node's fetch has no default timeout. These calls sit inside the sequential
// per-file resume loop, so a half-open connection to Graph would stall not just
// this upload but every remaining file in the batch. Metadata/token calls are
// small and quick; the file PUT gets a longer budget.
const GRAPH_METADATA_TIMEOUT_MS = 30_000;
const GRAPH_UPLOAD_TIMEOUT_MS = 90_000;

/**
 * Request an access token from Microsoft Identity Platform using Client Credentials.
 */
export async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const { clientId, clientSecret, tenantId } = config.microsoft;
  
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Microsoft credentials (clientId/clientSecret/tenantId) are not configured.');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'https://graph.microsoft.com/.default',
    client_secret: clientSecret,
    grant_type: 'client_credentials'
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString(),
    signal: AbortSignal.timeout(GRAPH_METADATA_TIMEOUT_MS)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Failed to obtain Microsoft access token: ${response.statusText}. ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  // Expire cached token 5 minutes before actual expiry time
  tokenExpiry = Date.now() + (data.expires_in * 1000) - 300000;
  
  return cachedToken;
}

/** Graph rejects these in an item name; also strips path separators. */
const ILLEGAL_FOLDER_CHARS = /["*:<>?/\\|]/g;

/**
 * Sanitizes a folder name for Graph: strips illegal characters, collapses
 * whitespace, and trims trailing dots/spaces (which Windows/SharePoint reject).
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFolderName(name) {
  return String(name || '')
    .replace(ILLEGAL_FOLDER_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120);
}

/**
 * Returns the id of a child folder, creating it if it doesn't exist.
 *
 * Graph's path-addressed upload does not reliably create missing intermediate
 * folders, so a nested path has to be walked and created a level at a time.
 *
 * @param {string} accessToken
 * @param {string} parentId - drive item id of the parent folder
 * @param {string} folderName
 * @returns {Promise<string>} the child folder's drive item id
 */
async function ensureChildFolder(accessToken, parentId, folderName) {
  const defaultSender = config.microsoft.defaultSender;
  const driveBase = defaultSender
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(defaultSender)}/drive`
    : 'https://graph.microsoft.com/v1.0/drive';

  // Address the child BY PATH rather than listing the parent's children: the
  // configured parent is the flat folder every resume lands in, so it holds far
  // more than one page of items and a paged list would miss an existing folder,
  // then fail to create it because it is already there.
  const byPathUrl = `${driveBase}/items/${parentId}:/${encodeURIComponent(folderName)}?$select=id,folder`;

  const lookup = async () => {
    const res = await fetch(byPathUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GRAPH_METADATA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const item = await res.json();
    return item?.folder ? item.id : null;
  };

  const existingId = await lookup();
  if (existingId) return existingId;

  const createRes = await fetch(`${driveBase}/items/${parentId}/children`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      folder: {},
      // Two uploads racing for the same candidate folder must converge on one
      // folder, not create "Name 1" alongside "Name".
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
    signal: AbortSignal.timeout(GRAPH_METADATA_TIMEOUT_MS),
  });

  if (createRes.ok) {
    const created = await createRes.json();
    return created.id;
  }

  // 409 = it appeared between the lookup and the create (concurrent upload).
  if (createRes.status === 409) {
    const raced = await lookup();
    if (raced) return raced;
  }

  const errorData = await createRes.json().catch(() => ({}));
  throw new Error(`Could not create OneDrive folder "${folderName}": ${createRes.statusText}. ${JSON.stringify(errorData)}`);
}

/**
 * Resolves (creating as needed) a chain of nested folders under the configured
 * parent, and returns the deepest folder's id.
 *
 * @param {string[]} folderPath - e.g. ['Document Collection', 'Asha R (cv-4821)']
 * @returns {Promise<string>} drive item id to upload into
 */
export async function ensureOneDriveFolderPath(folderPath = []) {
  const accessToken = await getAccessToken();
  let parentId = config.microsoft.oneDriveParentId;

  for (const rawName of folderPath) {
    const name = sanitizeFolderName(rawName);
    if (!name) continue;
    parentId = await ensureChildFolder(accessToken, parentId, name);
  }
  return parentId;
}

/**
 * Upload a local file to MS OneDrive target folder.
 * @param {string} localFilePath - Path of the file on disk
 * @param {string} originalName - The original name of the uploaded file
 * @param {object} [options]
 * @param {string[]} [options.folderPath] - nested folders under the configured
 *   parent to upload into, created on demand (e.g.
 *   ['Document Collection', 'Asha R (cv-4821)']). Omit to upload flat into the
 *   parent folder, which is what every pre-existing caller does.
 * @returns {Promise<string>} The SharePoint/OneDrive webUrl of the uploaded file
 */
export async function uploadFileToOneDrive(localFilePath, originalName, { folderPath = [] } = {}) {
  try {
    const accessToken = await getAccessToken();
    const parentId = folderPath.length
      ? await ensureOneDriveFolderPath(folderPath)
      : config.microsoft.oneDriveParentId; // Target parent folder ID from config/env

    // Format unique filename: BaseName_Timestamp.ext
    const uniqueSuffix = Math.round(Date.now() / 1000);
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    // Replace non-alphanumeric chars to match naming conventions cleanly
    const cleanBase = base.replace(/[^a-zA-Z0-9]/g, '_');
    const cleanFilename = `${cleanBase}_${uniqueSuffix}${ext}`;

    const defaultSender = config.microsoft.defaultSender;
    const uploadUrl = defaultSender
      ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(defaultSender)}/drive/items/${parentId}:/${cleanFilename}:/content`
      : `https://graph.microsoft.com/v1.0/drive/items/${parentId}:/${cleanFilename}:/content`;
    const fileBuffer = fs.readFileSync(localFilePath);

    logger.info(`OneDrive: Uploading local file ${localFilePath} to folder ID ${parentId} as "${cleanFilename}"...`);

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream'
      },
      body: fileBuffer,
      signal: AbortSignal.timeout(GRAPH_UPLOAD_TIMEOUT_MS)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Upload failed: ${response.statusText}. ${JSON.stringify(errorData)}`);
    }

    const item = await response.json();
    logger.info(`OneDrive: Successfully uploaded file to OneDrive. webUrl: ${item.webUrl}`);
    return item.webUrl;
  } catch (err) {
    logger.warn(`OneDrive: Failed to upload file "${originalName}" to OneDrive: ${err.message}`);
    throw err;
  }
}
