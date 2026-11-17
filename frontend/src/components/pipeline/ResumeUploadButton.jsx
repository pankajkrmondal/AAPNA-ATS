/**
 * ResumeUploadButton — U01: attach the candidate's real resume (pdf, doc or
 * docx) from the drawer or the Schedule window, when the record has none or
 * holds something that is not a resume (an Excel-upload row's workbook).
 *
 * POST /api/candidates/:id/resume. On success the pipeline detail and the
 * Schedule window's pre-send check reload, so the warning clears by itself.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import candidateService from '../../services/candidateService';

const ACCEPT = '.pdf,.doc,.docx';
const MAX_BYTES = 10 * 1024 * 1024;

export default function ResumeUploadButton({ candidateId, pipelineId, size = 'small', type = 'default', label = 'Upload resume', onUploaded }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  if (!candidateId) return null;

  const upload = async (file) => {
    const ext = (/\.[a-z0-9]+$/i.exec(file.name)?.[0] || '').toLowerCase();
    if (!ACCEPT.split(',').includes(ext)) {
      message.error('Upload the resume as a pdf, doc or docx file.');
      return;
    }
    if (file.size > MAX_BYTES) {
      message.error('The resume must be 10 MB or smaller.');
      return;
    }
    setBusy(true);
    try {
      await candidateService.uploadResume(candidateId, file);
      message.success('Resume uploaded. It will go to the panel with the invite.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] }),
        queryClient.invalidateQueries({ queryKey: ['schedule-preview'] }),
      ]);
      onUploaded?.();
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Could not upload the resume.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Upload
      accept={ACCEPT}
      showUploadList={false}
      maxCount={1}
      // Never let antd post the file itself: the service call owns the request.
      beforeUpload={(file) => { upload(file); return false; }}
    >
      <Button size={size} type={type} icon={<UploadOutlined />} loading={busy}>
        {label}
      </Button>
    </Upload>
  );
}
