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
 * Resolves (creating as needed) a chain of folders anchored at the DRIVE ROOT,
 * rather than under MS_ONEDRIVE_PARENT_ID.
 *
 * Needed because the recording archive lives in its own top-level folder
 * (Recordings_ATS, created by hand in the mailbox's OneDrive), which is a
 * sibling of the resume parent rather than a child of it. Reusing
 * ensureOneDriveFolderPath() would have buried recordings inside the CV folder.
 *
 * @param {string[]} folderPath - e.g. ['Recordings_ATS', 'Asha R (pipeline-1396)']
 * @returns {Promise<string>} drive item id of the deepest folder
 */
export async function ensureDriveFolderPathFromRoot(folderPath = []) {
  const accessToken = await getAccessToken();
  const defaultSender = config.microsoft.defaultSender;
  const driveBase = defaultSender
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(defaultSender)}/drive`
    : 'https://graph.microsoft.com/v1.0/drive';

  const rootRes = await fetch(`${driveBase}/root?$select=id`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GRAPH_METADATA_TIMEOUT_MS),
  });
  if (!rootRes.ok) throw new Error(`Could not read the OneDrive root: ${rootRes.statusText}`);
  let parentId = (await rootRes.json()).id;

  for (const rawName of folderPath) {
    const name = sanitizeFolderName(rawName);
    if (!name) continue;
    parentId = await ensureChildFolder(accessToken, parentId, name);
  }
  return parentId;
}

/**
 * Uploads a stream to OneDrive via a resumable upload session.
 *
 * WHY NOT uploadFileToOneDrive(): that one does readFileSync into a Buffer and a
 * single PUT with a 90-second budget. Fine for a CV; hopeless for an interview
 * recording, which Microsoft sizes at roughly 400 MB per hour — it would hold
 * the whole file in memory and time out long before finishing.
 *
 * This streams source → destination in fixed chunks, so peak memory is one chunk
 * regardless of whether the recording is 2 MB or 2 GB, and each chunk gets its
 * own timeout instead of the transfer sharing one.
 *
 * @param {object} params
 * @param {ReadableStream} params.webStream - a fetch Response.body
 * @param {number} params.totalBytes - exact size; Graph requires it per chunk
 * @param {string} params.parentItemId - destination folder
 * @param {string} params.fileName
 * @returns {Promise<{id: string, webUrl: string, size: number}>}
 */
export async function uploadStreamToOneDrive({ webStream, totalBytes, parentItemId, fileName }) {
  const accessToken = await getAccessToken();
  const defaultSender = config.microsoft.defaultSender;
  const driveBase = defaultSender
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(defaultSender)}/drive`
    : 'https://graph.microsoft.com/v1.0/drive';

  const sessionRes = await fetch(
    `${driveBase}/items/${parentItemId}:/${encodeURIComponent(fileName)}:/createUploadSession`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      // 'replace' so a retried archive overwrites its own half-finished attempt
      // rather than leaving "Tech 1 1.mp4" next to "Tech 1.mp4".
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
      signal: AbortSignal.timeout(GRAPH_METADATA_TIMEOUT_MS),
    }
  );
  if (!sessionRes.ok) {
    const body = await sessionRes.json().catch(() => ({}));
    throw new Error(`Could not start an upload session for "${fileName}": ${sessionRes.status} ${JSON.stringify(body)}`);
  }
  // The session URL carries its own short-lived credential — deliberately NOT
  // sent with the app's bearer token, which Graph rejects on these PUTs.
  const { uploadUrl } = await sessionRes.json();

  // Graph requires every chunk except the last to be a multiple of 320 KiB.
  const CHUNK = 320 * 1024 * 25; // 8 MiB
  const reader = webStream.getReader();
  let pending = Buffer.alloc(0);
  let offset = 0;
  let finalItem = null;

  const putChunk = async (buf) => {
    const start = offset;
    const end = offset + buf.length - 1;
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(buf.length),
        'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
      },
      body: buf,
      signal: AbortSignal.timeout(GRAPH_UPLOAD_TIMEOUT_MS),
    });
    // 202 = chunk accepted, more expected. 200/201 = final chunk, item returned.
    if (res.status === 200 || res.status === 201) {
      finalItem = await res.json();
    } else if (res.status !== 202) {
      const body = await res.text().catch(() => '');
      throw new Error(`Chunk ${start}-${end} rejected: ${res.status} ${body.slice(0, 300)}`);
    }
    offset += buf.length;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) pending = Buffer.concat([pending, Buffer.from(value)]);
      // Flush whole chunks while enough has accumulated; the remainder rides
      // along with the next read, so no chunk is ever short except the last.
      while (pending.length >= CHUNK) {
        await putChunk(pending.subarray(0, CHUNK));
        pending = pending.subarray(CHUNK);
      }
      if (done) break;
    }
    if (pending.length > 0) await putChunk(pending);
  } catch (err) {
    // Abandon the session so a failed attempt does not leave a half-written
    // placeholder occupying the name for the next retry.
    await fetch(uploadUrl, { method: 'DELETE' }).catch(() => {});
    throw err;
  }

  if (!finalItem) {
    throw new Error(`Upload of "${fileName}" ended after ${offset}/${totalBytes} bytes without a completed item.`);
  }
  logger.info(`OneDrive: archived "${fileName}" (${finalItem.size ?? offset} bytes).`);
  return { id: finalItem.id, webUrl: finalItem.webUrl, size: finalItem.size ?? offset };
}

/**
 * Deletes one drive item. Used by the recording retention job.
 *
 * A 404 counts as success: the goal is "this file no longer exists", and
 * something already having removed it satisfies that. Treating it as a failure
 * would leave the row stuck in 'copied' forever, retried daily against a file
 * that is not there.
 *
 * @param {string} itemId - drive item id
 * @returns {Promise<void>}
 * @throws {Error} on any failure other than a missing item
 */
export async function deleteDriveItem(itemId) {
  const accessToken = await getAccessToken();
  const defaultSender = config.microsoft.defaultSender;
  const driveBase = defaultSender
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(defaultSender)}/drive`
    : 'https://graph.microsoft.com/v1.0/drive';

  const res = await fetch(`${driveBase}/items/${itemId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GRAPH_METADATA_TIMEOUT_MS),
  });
  if (res.status === 204 || res.status === 404) return;
  const body = await res.text().catch(() => '');
  throw new Error(`Could not delete drive item ${itemId}: ${res.status} ${body.slice(0, 200)}`);
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
 * Upload a local file and return the full item — id AND webUrl.
 *
 * uploadFileToOneDrive() below keeps returning just the webUrl so that none of
 * its six existing callers has to change. Callers that PERSIST the location
 * (rpa_cv.cvFileUrl, rpa_candidate_documents.file_url) use this one instead and
 * store the id alongside, because:
 *
 *   1. A webUrl cannot be read back by an application. It is a browser URL
 *      behind a Microsoft login, so handing it to an external interviewer
 *      produces a login wall rather than a resume — the whole reason the
 *      candidate dossier needs the bytes (plan §6.3).
 *   2. An item id survives the file being renamed or moved in the drive. A
 *      webUrl does not: every stored URL is one rename from being a dead link.
 *
 * @param {string} localFilePath
 * @param {string} originalName
 * @param {{ folderPath?: string[] }} [options]
 * @returns {Promise<{id: string, webUrl: string, name: string, size: number}>}
 */
export async function uploadFileToOneDriveDetailed(localFilePath, originalName, { folderPath = [] } = {}) {
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
    return {
      id: item.id, webUrl: item.webUrl, name: item.name || cleanFilename, size: item.size ?? fileBuffer.length,
    };
  } catch (err) {
    logger.warn(`OneDrive: Failed to upload file "${originalName}" to OneDrive: ${err.message}`);
    throw err;
  }
}

/**
 * Upload a local file to the OneDrive target folder.
 *
 * Unchanged signature and return type — a bare webUrl string — so the callers
 * that only need somewhere to link to (MRF job descriptions, assessment import
 * files) keep working exactly as before.
 *
 * @param {string} localFilePath - Path of the file on disk
 * @param {string} originalName - The original name of the uploaded file
 * @param {object} [options]
 * @param {string[]} [options.folderPath] - nested folders under the configured
 *   parent to upload into, created on demand (e.g.
 *   ['Document Collection', 'Asha R (cv-4821)']). Omit to upload flat into the
 *   parent folder, which is what every pre-existing caller does.
 * @returns {Promise<string>} The SharePoint/OneDrive webUrl of the uploaded file
 */
export async function uploadFileToOneDrive(localFilePath, originalName, options = {}) {
  const item = await uploadFileToOneDriveDetailed(localFilePath, originalName, options);
  return item.webUrl;
}

/**
 * Graph's encoding for "resolve this sharing URL to a drive item".
 * https://learn.microsoft.com/en-us/graph/api/shares-get
 */
function encodeShareUrl(webUrl) {
  const b64 = Buffer.from(webUrl, 'utf8').toString('base64');
  return `u!${b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

/**
 * A Graph failure with the response body kept OFF the message.
 *
 * Errors from this path can end up quoted in a candidate dossier — a file that
 * is emailed outside the company by design. A raw Graph error body carries
 * request ids, drive and item identifiers and sometimes internal host names,
 * none of which belongs in a stranger's inbox. So the message stays short and
 * safe to repeat, and the detail rides on `.detail` for the server log.
 *
 * @param {string} what - short, human, safe to show
 * @param {number} status - HTTP status
 * @param {string} body - Graph's response body, for logging only
 */
function graphError(what, status, body) {
  const err = new Error(`${what} (HTTP ${status}).`);
  err.status = status;
  err.detail = String(body || '').slice(0, 400);
  return err;
}

/**
 * Fetch a drive item's BYTES, app-only, so a file can travel INSIDE a dossier.
 *
 * Two routes, in order of preference:
 *
 *   by id   GET /users/{owner}/drive/items/{itemId}/content     direct
 *   by url  GET /shares/{encoded}/driveItem[/content]           legacy rows
 *
 * The URL route exists only because rows written before 2026-09-02 have no
 * stored id. It costs an extra round trip, so the resolved id is returned for
 * the caller to write back — the backfill is lazy, happens only for files
 * somebody actually asks for, and costs that extra trip exactly once per file.
 *
 * PERMISSIONS: this runs on the existing Sites.Selected grant, verified against
 * staging on 2026-09-02 (Files.Read.All was requested and declined by IT, and is
 * not needed). Production uses a separate app registration whose per-site grant
 * is issued separately — re-test there before relying on it.
 *
 * NEVER THROWS FOR THE CALLER'S BENEFIT — it throws, but callers are expected to
 * catch. A resume that cannot be fetched must degrade to a line in the dossier's
 * manifest, not a failed download: the pack is still worth sending without it.
 *
 * @param {{itemId?: string|null, webUrl?: string|null, maxBytes?: number, timeoutMs?: number}} args
 * @returns {Promise<{buffer: Buffer, name: string|null, itemId: string|null, contentType: string|null, resolvedFromUrl: boolean}>}
 * @throws {Error} on a missing locator, a Graph failure, or an oversized file
 */
export async function downloadDriveItem({ itemId, webUrl, maxBytes, timeoutMs = 10_000 } = {}) {
  if (!itemId && !webUrl) throw new Error('downloadDriveItem needs an itemId or a webUrl.');

  const accessToken = await getAccessToken();
  const owner = config.microsoft.defaultSender;
  const driveBase = owner
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(owner)}/drive`
    : 'https://graph.microsoft.com/v1.0/drive';
  const auth = { Authorization: `Bearer ${accessToken}` };

  let resolvedId = itemId || null;
  let name = null;
  let resolvedFromUrl = false;

  // Legacy row: resolve the stored URL to an item first, so we learn its id and
  // its real filename (which the URL only approximates).
  if (!resolvedId) {
    const metaRes = await fetch(`https://graph.microsoft.com/v1.0/shares/${encodeShareUrl(webUrl)}/driveItem`, {
      headers: auth,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!metaRes.ok) {
      throw graphError('Could not resolve the stored file link', metaRes.status, await metaRes.text().catch(() => ''));
    }
    const meta = await metaRes.json();
    resolvedId = meta.id;
    name = meta.name || null;
    resolvedFromUrl = true;
    // Refuse before downloading rather than after — the point of a size cap is
    // not to pull 200 MB into memory to discover it was too big.
    if (maxBytes && Number(meta.size) > maxBytes) {
      throw new Error(`File is ${Math.round(meta.size / 1024 / 1024)} MB, over the ${Math.round(maxBytes / 1024 / 1024)} MB attachment limit.`);
    }
  }

  const res = await fetch(`${driveBase}/items/${resolvedId}/content`, {
    headers: auth,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw graphError('Could not read the file from OneDrive', res.status, await res.text().catch(() => ''));
  }

  const declared = Number(res.headers.get('content-length'));
  if (maxBytes && Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`File is ${Math.round(declared / 1024 / 1024)} MB, over the ${Math.round(maxBytes / 1024 / 1024)} MB attachment limit.`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  // Content-Length can be absent on a redirected download, so the real size is
  // checked again once the bytes are in hand.
  if (maxBytes && buffer.length > maxBytes) {
    throw new Error(`File is ${Math.round(buffer.length / 1024 / 1024)} MB, over the ${Math.round(maxBytes / 1024 / 1024)} MB attachment limit.`);
  }

  return {
    buffer,
    name,
    itemId: resolvedId,
    contentType: res.headers.get('content-type'),
    resolvedFromUrl,
  };
}
