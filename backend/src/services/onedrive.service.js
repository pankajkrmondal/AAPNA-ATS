import fs from 'fs';
import path from 'path';
import logger from '../config/logger.js';
import config from '../config/index.js'; // updated env config with gemini and local uploads

let cachedToken = null;
let tokenExpiry = null;

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
    body: params.toString()
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

/**
 * Upload a local file to MS OneDrive target folder.
 * @param {string} localFilePath - Path of the file on disk
 * @param {string} originalName - The original name of the uploaded file
 * @returns {Promise<string>} The SharePoint/OneDrive webUrl of the uploaded file
 */
export async function uploadFileToOneDrive(localFilePath, originalName) {
  try {
    const accessToken = await getAccessToken();
    const parentId = config.microsoft.oneDriveParentId; // Target parent folder ID from config/env
    
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
      body: fileBuffer
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
