/**
 * ExportButton — the one Export control used across every list screen.
 *
 * Owns the loading state, the large-export confirmation, the row-count toast
 * and the error path, so a page wires an export in two lines:
 *
 *   <ExportButton
 *     request={(cfg) => mrfService.exportCsv(filters, cfg)}
 *     fallbackName="AAPNA-ATS_MRF-Requests.csv"
 *     rowCount={total}
 *   />
 *
 * The file itself is built server-side (see backend/src/exports/) — this only
 * asks for it and hands the result to the browser.
 */
import { useState } from 'react';
import { Button, App as AntApp, Tooltip } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';

import { downloadFile } from '../../utils/downloadFile';

export default function ExportButton({
  /** (config) => Promise<AxiosResponse>. Receives the blob/timeout config. */
  request,
  /** Used only if the server's Content-Disposition is unreadable. */
  fallbackName = 'export.csv',
  /**
   * Rows the user can see. Drives the empty-disable and the confirm prompt.
   * Pass null when unknown — the server row cap is the backstop either way.
   */
  rowCount = null,
  /** Ask before starting at or above this many rows. */
  confirmThreshold = 2000,
  /**
   * Set when the on-screen table is a top-N summary but the export returns
   * everything, so the success toast can say so instead of looking wrong.
   */
  fullSetNote = null,
  label = 'Export CSV',
  disabled = false,
  size,
  style,
  /**
   * What this particular file contains, e.g. "every candidate stuck in a stage".
   * Appended to the shared explanation below so each Export says what it exports
   * rather than leaving the user to guess from the nearest heading.
   */
  tooltip = null,
}) {
  const { message, modal } = AntApp.useApp();
  const [loading, setLoading] = useState(false);

  const isDisabled = disabled || loading || rowCount === 0;

  const run = async () => {
    setLoading(true);
    try {
      const { rowCount: exported, degraded } = await downloadFile(request, { fallbackName });
      const rows = exported != null ? `${exported.toLocaleString('en-IN')} rows` : 'CSV';

      if (degraded) {
        // The screening search fell back to an unranked list — the file is
        // complete but the ordering does not match the screen.
        message.warning(
          `Exported ${rows}, but AI ranking was unavailable — the order may differ from the screen.`,
          6,
        );
      } else if (fullSetNote) {
        message.success(`Exported ${rows}. ${fullSetNote}`, 5);
      } else {
        message.success(`Exported ${rows}.`);
      }
    } catch (err) {
      message.error(err?.message || 'Failed to export CSV.');
    } finally {
      setLoading(false);
    }
  };

  const handleClick = () => {
    if (rowCount != null && rowCount >= confirmThreshold) {
      modal.confirm({
        title: `Export ${rowCount.toLocaleString('en-IN')} rows?`,
        content: 'Large exports can take up to a minute. The download starts on its own once the file is ready.',
        okText: 'Export',
        cancelText: 'Cancel',
        onOk: run,
      });
      return;
    }
    run();
  };

  /**
   * A disabled Export with no explanation reads as broken, so the greyed-out
   * state says WHY. Otherwise: what the file holds, plus the two things that
   * routinely surprise people — the download is a spreadsheet-ready CSV, and it
   * follows the filters currently on screen.
   */
  const tooltipText = rowCount === 0
    ? 'Nothing to export — there are no rows in this view. Widen the filters to get data first.'
    : [
      tooltip || 'Downloads this table as a CSV file you can open in Excel.',
      fullSetNote ? 'The file contains the complete list, not just the rows shown here.' : null,
      'It follows the filters currently applied on screen.',
    ].filter(Boolean).join(' ');

  return (
    <Tooltip title={tooltipText}>
      {/* span wrapper: AntD tooltips do not fire on a disabled button, and the
          disabled case is exactly when the explanation is most needed. */}
      <span style={{ display: 'inline-block', cursor: isDisabled ? 'not-allowed' : 'pointer' }}>
        <Button
          icon={<FileExcelOutlined />}
          onClick={handleClick}
          loading={loading}
          disabled={isDisabled}
          size={size}
          style={{
            borderRadius: 6,
            fontWeight: 600,
            ...(isDisabled ? { pointerEvents: 'none' } : { color: '#7a922e', borderColor: '#7a922e' }),
            ...style,
          }}
        >
          {label}
        </Button>
      </span>
    </Tooltip>
  );
}
