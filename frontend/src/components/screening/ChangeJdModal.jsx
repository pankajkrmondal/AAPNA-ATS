/**
 * Change JD (Phase 3 section G, G3): a candidate shortlisted to the wrong JD
 * gets the right one in place. The candidate stays at the stage they are on;
 * nothing is sent unless "Send corrected shortlist email" is ticked.
 *
 * Opened from a journey chip on the Keyword tab and from a JD card in Search
 * Candidate's candidate view. On open it asks the server whether the change is
 * allowed (and which JDs the candidate is already on); the server checks again
 * when saving.
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal, Select, Input, Checkbox, Alert, Typography, Space, Tag, Spin, message } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import screeningService from '../../services/screeningService';
import { useApprovedRoles } from '../../hooks/useScreeningData';
import { mrfOptionLabel } from '../../utils/mrfLabel';

const { Text } = Typography;

/**
 * @param {{
 *   open: boolean,
 *   shortlistId: number|null,
 *   candidateName?: string,
 *   onClose: () => void,
 *   onChanged?: (result: { shortlist_id: number, pipeline_id: number|null, from_mrf_id: number|null,
 *                          to_mrf_id: number, role: string, email: string }) => void,
 * }} props
 */
export default function ChangeJdModal({ open, shortlistId, candidateName, onClose, onChanged }) {
  const queryClient = useQueryClient();
  const rolesQuery = useApprovedRoles({ enabled: open });
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [newMrfId, setNewMrfId] = useState(null);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !shortlistId) return undefined;
    let alive = true;
    setStatus(null);
    setLoadError(null);
    setNewMrfId(null);
    setReason('');
    setNotify(false);
    screeningService.getChangeJdStatus(shortlistId)
      .then((res) => { if (alive) setStatus(res?.data?.data ?? res?.data ?? null); })
      .catch((err) => { if (alive) setLoadError(err?.message || 'Could not check this shortlist.'); });
    return () => { alive = false; };
  }, [open, shortlistId]);

  const options = useMemo(() => {
    const excluded = new Set((status?.excluded_mrf_ids || []).map(String));
    if (status?.current_mrf) excluded.add(String(status.current_mrf.id));
    return (rolesQuery.data || [])
      .filter((r) => !r.closed && !excluded.has(String(r.id)))
      .map((r) => ({ value: r.id, label: mrfOptionLabel(r), isLatest: r.isLatest }));
  }, [rolesQuery.data, status]);

  const isSet = status && !status.current_mrf;
  const allowed = Boolean(status?.allowed);
  const canSave = allowed && newMrfId && reason.trim().length > 0;

  const handleOk = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await screeningService.changeShortlistJd(shortlistId, { newMrfId, reason: reason.trim(), notifyCandidate: notify });
      const result = res?.data?.data ?? res?.data;
      if (result?.email === 'failed') {
        message.warning(`JD changed to ${result.role}, but the corrected email was not sent: ${result.email_failure?.reason || 'unknown error'}`);
      } else {
        message.success(`JD changed to ${result?.role}${result?.email === 'sent' ? ' and the candidate was emailed' : ''}.`);
      }
      // Both JDs' result lists, and the candidate's per-JD cards, are now stale.
      queryClient.invalidateQueries({ queryKey: ['screening', 'roleCandidates'] });
      if (status?.cv_id) queryClient.invalidateQueries({ queryKey: ['candidate-pipeline-scores', String(status.cv_id)] });
      onChanged?.(result);
      onClose();
    } catch (err) {
      message.error(err?.message || 'Could not change the JD.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isSet ? 'Set JD' : 'Change JD'}
      onCancel={onClose}
      onOk={handleOk}
      okText={isSet ? 'Set JD' : 'Change JD'}
      okButtonProps={{ disabled: !canSave, loading: saving, 'data-testid': 'change-jd-confirm' }}
      cancelText={allowed ? 'Cancel' : 'Close'}
      destroyOnClose
      width={560}
    >
      {!status && !loadError && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
      {loadError && <Alert type="error" showIcon message={loadError} />}
      {status && (
        <Space direction="vertical" size={12} style={{ width: '100%' }} data-testid="change-jd-modal">
          <Text>
            <Text strong>{candidateName || status.candidate_name || 'Candidate'}</Text>
            {status.current_mrf
              ? <> is shortlisted to <Text strong>{status.current_mrf.role || 'Untitled role'}</Text> (MRF-{status.current_mrf.id}).</>
              : <> was shortlisted from a keyword search with no JD.</>}
          </Text>

          {!allowed && <Alert type="warning" showIcon message={status.block?.message || 'The JD cannot be changed.'} />}

          {allowed && (
            <>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                The candidate stays at the stage they are on; only the saved JD is replaced.
              </Text>
              <div>
                <Text strong style={{ fontSize: 12.5 }}>Correct JD <Text type="danger">*</Text></Text>
                <Select
                  style={{ width: '100%', marginTop: 4 }}
                  placeholder="Select the correct open JD"
                  value={newMrfId ?? undefined}
                  onChange={setNewMrfId}
                  showSearch
                  optionFilterProp="label"
                  loading={rolesQuery.isLoading}
                  options={options}
                  optionRender={(opt) => (
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                      <span>{opt.data.label}</span>
                      {opt.data.isLatest && <Tag color="green" style={{ margin: 0 }}>Latest</Tag>}
                    </Space>
                  )}
                  data-testid="change-jd-select"
                />
              </div>
              <div>
                <Text strong style={{ fontSize: 12.5 }}>Reason <Text type="danger">*</Text></Text>
                <Input.TextArea
                  style={{ marginTop: 4 }}
                  rows={2}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Picked the QA JD by mistake; he applied for Automation"
                  data-testid="change-jd-reason"
                />
              </div>
              <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} data-testid="change-jd-notify">
                Send corrected shortlist email to the candidate (with the new JD)
              </Checkbox>
            </>
          )}
        </Space>
      )}
    </Modal>
  );
}
