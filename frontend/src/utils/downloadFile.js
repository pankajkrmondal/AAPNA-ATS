/**
 * Shared authenticated file download.
 *
 * Every Export button in the app goes through here, so blob handling, filename
 * parsing, error unwrapping and object-URL cleanup exist once rather than
 * twelve times. (The page-local exporter this replaced leaked one object URL
 * per click and never read the server's filename.)
 *
 * A caller passes a `request` function that takes the per-download axios
 * config, so it can reuse its own service module:
 *
 *   downloadFile((cfg) => mrfService.exportCsv(params, cfg))
 *
 * NOTE: we deliberately do NOT use `window.open('…/export?token=' + jwt)`.
 * The backend's authenticate() does accept a ?token= query param, but morgan
 * logs the full URL — that would write live JWTs into the access log.
 */

/** Exports run unpaginated queries; the api.js default of 120s is too tight. */
export const exportRequestConfig = { responseType: 'blob', timeout: 300000 };

/**
 * Pull the filename out of a Content-Disposition header, preferring the
 * RFC 5987 `filename*=UTF-8''…` form.
 *
 * Returns `fallback` when the header is absent — which in practice means CORS
 * is not exposing it (see the exposedHeaders list in backend app.js).
 */
export function filenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // Malformed percent-encoding — fall through to the plain form.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : fallback;
}

/**
 * Recover a human-readable message from a failed blob request.
 *
 * api.js's response interceptor normalises every error to
 * `{ status, message, data }` where `data` is the raw response body. With
 * `responseType: 'blob'` that body is a Blob, so `data.message` is undefined
 * and the user would otherwise see "Request failed with status code 500".
 */
async function readBlobError(err) {
  const body = err?.data;

  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    try {
      const text = await body.text();
      const parsed = JSON.parse(text);
      if (parsed?.message) return parsed.message;
    } catch {
      // Not JSON (or unreadable) — fall through to the generic message.
    }
  }

  return err?.message || 'Export failed. Please try again.';
}

/**
 * Perform the request and hand the browser the resulting file.
 *
 * @param {(config: object) => Promise<import('axios').AxiosResponse>} request
 * @param {{ fallbackName?: string }} [options]
 * @returns {Promise<{ filename: string, rowCount: number|null, degraded: boolean }>}
 */
export async function downloadFile(request, { fallbackName = 'export.csv' } = {}) {
  let objectUrl;

  try {
    const res = await request(exportRequestConfig);

    const blob = res.data instanceof Blob
      ? res.data
      : new Blob([res.data], { type: 'text/csv;charset=utf-8;' });

    const filename = filenameFromDisposition(
      res.headers?.['content-disposition'],
      fallbackName,
    );

    objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();

    const count = Number(res.headers?.['x-export-row-count']);

    return {
      filename,
      rowCount: Number.isFinite(count) ? count : null,
      degraded: res.headers?.['x-export-degraded'] === 'true',
    };
  } catch (err) {
    throw new Error(await readBlobError(err));
  } finally {
    // Revoke on the next macrotask. click() has already handed the download to
    // the browser, but revoking synchronously aborts it in Safari and older
    // Chrome. Not revoking at all (the previous behaviour) leaks the blob for
    // the lifetime of the tab.
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

export default downloadFile;
