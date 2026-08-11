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
import { Button, App as AntApp } from 'antd';
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

  return (
    <Button
      icon={<FileExcelOutlined />}
      onClick={handleClick}
      loading={loading}
      disabled={isDisabled}
      size={size}
      style={{
        borderRadius: 6,
        fontWeight: 600,
        ...(isDisabled ? {} : { color: '#7a922e', borderColor: '#7a922e' }),
        ...style,
      }}
    >
      {label}
    </Button>
  );
}
