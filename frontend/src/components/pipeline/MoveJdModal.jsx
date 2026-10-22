/**
 * Move to another JD (L02-A, design approved 22 Oct 2026).
 *
 * Closes this journey silently (no candidate or vendor email; it stays
 * viewable with all its results) and opens a new journey on the chosen JD,
 * from the first stage ("Start from scratch") or a chosen stage. The new
 * journey shows the old one under "Earlier roles for this candidate".
 *
 * On open it asks the server whether the move is allowed, which stages it can
 * land on and which JDs the candidate is already on; the server checks again
 * when saving.
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal, Select, Input, Checkbox, Alert, Typography, Space, Tag, Spin, Radio, message } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import pipelineService from '../../services/pipeline';
import { useApprovedRoles } from '../../hooks/useScreeningData';
import { mrfOptionLabel } from '../../utils/mrfLabel';

const { Text } = Typography;

/**
 * @param {{
 *   open: boolean,
 *   pipelineId: number|string|null,
 *   onClose: () => void,
 *   onMoved?: (result: { from_pipeline_id: number, to_pipeline_id: number, to_mrf_id: number,
 *                        role: string, landing_stage_key: string, email: string }) => void,
 * }} props
 */
export default function MoveJdModal({ open, pipelineId, onClose, onMoved }) {
  const queryClient = useQueryClient();
  const rolesQuery = useApprovedRoles({ enabled: open });
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [targetMrfId, setTargetMrfId] = useState(null);
  const [landingMode, setLandingMode] = useState('scratch');
  const [landingStageKey, setLandingStageKey] = useState(null);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !pipelineId) return undefined;
    let alive = true;
    setStatus(null);
    setLoadError(null);
    setTargetMrfId(null);
    setLandingMode('scratch');
    setLandingStageKey(null);
    setReason('');
    setNotify(false);
    pipelineService.getMoveJdStatus(pipelineId)
      .then((res) => {
        if (!alive) return;
        const data = res?.data?.data ?? res?.data ?? null;
        setStatus(data);
        // "A chosen stage" starts on the stage the candidate is on now.
        setLandingStageKey(data?.current?.stage_key || null);
      })
      .catch((err) => { if (alive) setLoadError(err?.response?.data?.message || err?.message || 'Could not check this record.'); });
    return () => { alive = false; };
  }, [open, pipelineId]);

  const jdOptions = useMemo(() => {
    const excluded = new Set((status?.excluded_mrf_ids || []).map(String));
    if (status?.current?.mrf_id) excluded.add(String(status.current.mrf_id));
    return (rolesQuery.data || [])
      .filter((r) => !r.closed && !excluded.has(String(r.id)))
      .map((r) => ({ value: r.id, label: mrfOptionLabel(r), isLatest: r.isLatest }));
  }, [rolesQuery.data, status]);

  const stageOptions = useMemo(
    () => (status?.stages || []).map((s) => ({ value: s.stage_key, label: s.label })),
    [status],
  );
  const firstStage = status?.stages?.[0];

  const allowed = Boolean(status?.allowed);
  const chosenStage = landingMode === 'scratch' ? null : landingStageKey;
  const canSave = allowed && targetMrfId && reason.trim().length > 0 && (landingMode === 'scratch' || landingStageKey);

  const handleOk = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await pipelineService.moveJourneyToMrf(pipelineId, {
        target_mrf_id: targetMrfId,
        landing_stage_key: chosenStage,
        reason: reason.trim(),
        notify_candidate: notify,
      });
      const result = res?.data?.data ?? res?.data;
      if (result?.email === 'failed') {
        message.warning(`Moved to ${result.role}, but the email was not sent: ${result.email_failure?.reason || 'unknown error'}`);
      } else {
        message.success(`Moved to ${result?.role}${result?.email === 'sent' ? ' and the candidate was emailed' : ''}.`);
      }
      queryClient.invalidateQueries({ queryKey: ['screening', 'roleCandidates'] });
      if (status?.cv_id) queryClient.invalidateQueries({ queryKey: ['candidate-pipeline-scores', String(status.cv_id)] });
      onMoved?.(result);
      onClose();
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Could not move the candidate.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`Move ${status?.candidate_name || 'candidate'} to another JD`}
      onCancel={onClose}
      onOk={handleOk}
      okText="Move candidate"
      okButtonProps={{ disabled: !canSave, loading: saving, 'data-testid': 'move-jd-confirm' }}
      cancelText={allowed ? 'Cancel' : 'Close'}
      destroyOnClose
      width={580}
    >
      {!status && !loadError && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
      {loadError && <Alert type="error" showIcon message={loadError} />}
      {status && (
        <Space direction="vertical" size={14} style={{ width: '100%' }} data-testid="move-jd-modal">
          <Alert
            type="info"
            message={(
              <Text style={{ fontSize: 13 }}>
                Now on <Text strong>{status.current?.role}</Text>
                {status.current?.mrf_id ? <> (MRF-{status.current.mrf_id})</> : null} at{' '}
                <Text strong>{status.current?.stage_label}</Text>. That record is closed as "Moved to another JD" and
                stays viewable with all its scores and history.
              </Text>
            )}
          />

          {!allowed && <Alert type="warning" showIcon message={status.block?.message || 'This candidate cannot be moved.'} />}

          {allowed && (
            <>
              <div>
                <Text strong style={{ fontSize: 13 }}>New JD <Text type="danger">*</Text></Text>
                <Select
                  style={{ width: '100%', marginTop: 4 }}
                  placeholder="Select an open JD"
                  value={targetMrfId ?? undefined}
                  onChange={setTargetMrfId}
                  showSearch
                  optionFilterProp="label"
                  loading={rolesQuery.isLoading}
                  options={jdOptions}
                  optionRender={(opt) => (
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                      <span>{opt.data.label}</span>
                      {opt.data.isLatest && <Tag color="green" style={{ margin: 0 }}>Latest</Tag>}
                    </Space>
                  )}
                  data-testid="move-jd-select"
                />
                <Text type="secondary" style={{ fontSize: 12 }}>Open MRFs only. MRFs this candidate is already on are not listed.</Text>
              </div>

              <div>
                <Text strong style={{ fontSize: 13 }}>Start the new role at</Text>
                <Radio.Group
                  value={landingMode}
                  onChange={(e) => setLandingMode(e.target.value)}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}
                  data-testid="move-jd-landing"
                >
                  <Radio value="scratch">
                    <Text strong>Start from scratch</Text>
                    {firstStage ? <Text type="secondary"> · {firstStage.label}</Text> : null}
                    <div><Text type="secondary" style={{ fontSize: 12 }}>Every stage is open again for this role.</Text></div>
                  </Radio>
                  {/* The Select sits BESIDE the radio, not inside it: a Radio
                      renders a <label>, which swallows the click and the
                      dropdown never opens. Picking a stage also picks this option. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Radio value="stage">
                      <Text strong>A chosen stage</Text>
                    </Radio>
                    <Select
                      size="small"
                      style={{ minWidth: 220 }}
                      value={landingStageKey ?? undefined}
                      onChange={(v) => { setLandingStageKey(v); setLandingMode('stage'); }}
                      onFocus={() => setLandingMode('stage')}
                      options={stageOptions}
                      aria-label="Stage to start the new role at"
                      data-testid="move-jd-stage"
                    />
                  </div>
                </Radio.Group>
              </div>

              <div>
                <Text strong style={{ fontSize: 13 }}>Reason <Text type="danger">*</Text></Text>
                <Input.TextArea
                  style={{ marginTop: 4 }}
                  rows={2}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Better fit for the mid-level role"
                  data-testid="move-jd-reason"
                />
              </div>

              <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} data-testid="move-jd-notify">
                <Text strong>Email the candidate</Text> about the new role, with its JD attached
                <div><Text type="secondary" style={{ fontSize: 12 }}>Off by default. The vendor is not emailed either way.</Text></div>
              </Checkbox>

              <Alert
                type="warning"
                message="Upcoming interviews on the old role are cancelled and their panel is told. Not available once an offer has been shared."
                style={{ fontSize: 12.5 }}
              />
            </>
          )}
        </Space>
      )}
    </Modal>
  );
}
