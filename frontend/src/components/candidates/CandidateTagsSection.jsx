/**
 * JD tags on Search Candidate's candidate view (L02-B, design approved 22 Oct
 * 2026; rule from Harish the same day).
 *
 * - × removes a wrong tag, only while the candidate has another tag and is
 *   not in the pipeline for that JD (Popconfirm with a reason).
 * - "Switch JD" replaces a tag: the only tag can be switched but never
 *   removed. For a JD the candidate is in the pipeline for, it opens Move to
 *   another JD, which moves the pipeline record too.
 *
 * The server applies the same rules (utils/candidateTag.js tagChangeBlock).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Popconfirm, Select, Space, Spin, Tag, Tooltip, Typography, message } from 'antd';
import candidateService from '../../services/candidateService';
import { useApprovedRoles } from '../../hooks/useScreeningData';
import { mrfOptionLabel } from '../../utils/mrfLabel';
import MoveJdModal from '../pipeline/MoveJdModal';

const { Text } = Typography;

/** Short "how" for each tag source, on the chip. */
const SOURCE_SHORT = {
  hr_manual_upload: 'HR upload',
  vendor_portal: 'vendor upload',
  shortlist: 'shortlisted',
  search_candidate: 'added from Search Candidate',
  change_jd: 'JD changed',
  move: 'moved here',
  backfill: 'shortlisted',
};

function RemoveTag({ cvId, tag, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const remove = async () => {
    setSaving(true);
    try {
      await candidateService.removeTag(cvId, tag.mrf_id, reason.trim());
      message.success(`Tag "${tag.role}" removed.`);
      onDone();
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Could not remove the tag.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Popconfirm
      title={`Remove the tag "${tag.role} · MRF-${tag.mrf_id}"?`}
      description={(
        <Space direction="vertical" size={6} style={{ width: 300 }}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            The candidate stays in the database. They stop appearing under "Tagged to this JD only" for this JD.
          </Text>
          <Input
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            data-testid="tag-remove-reason"
          />
        </Space>
      )}
      okText="Remove tag"
      okButtonProps={{ danger: true, disabled: !reason.trim(), loading: saving }}
      onConfirm={remove}
      onOpenChange={(o) => { if (!o) setReason(''); }}
    >
      <Button type="text" size="small" aria-label={`Remove tag ${tag.role}`} style={{ padding: '0 4px', height: 22 }} data-testid="tag-remove">×</Button>
    </Popconfirm>
  );
}

function SwitchTagModal({ cvId, tag, taggedIds, onClose, onDone }) {
  const rolesQuery = useApprovedRoles({ enabled: Boolean(tag) });
  const [toMrfId, setToMrfId] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const options = useMemo(() => (rolesQuery.data || [])
    .filter((r) => !r.closed && !taggedIds.has(String(r.id)))
    .map((r) => ({ value: r.id, label: mrfOptionLabel(r) })), [rolesQuery.data, taggedIds]);

  const save = async () => {
    setSaving(true);
    try {
      await candidateService.switchTag(cvId, tag.mrf_id, { to_mrf_id: toMrfId, reason: reason.trim() });
      message.success('JD switched.');
      onDone();
      onClose();
    } catch (err) {
      message.error(err?.response?.data?.message || err?.message || 'Could not switch the JD.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(tag)}
      title={`Switch JD: ${tag?.role || ''}`}
      onCancel={onClose}
      onOk={save}
      okText="Switch JD"
      okButtonProps={{ disabled: !toMrfId || !reason.trim(), loading: saving, 'data-testid': 'tag-switch-confirm' }}
      destroyOnClose
      width={520}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 12.5 }}>The tag is replaced by the JD you pick. The change is logged.</Text>
        <div>
          <Text strong style={{ fontSize: 12.5 }}>Right JD <Text type="danger">*</Text></Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder="Select an open JD"
            value={toMrfId ?? undefined}
            onChange={setToMrfId}
            showSearch
            optionFilterProp="label"
            loading={rolesQuery.isLoading}
            options={options}
            data-testid="tag-switch-select"
          />
        </div>
        <div>
          <Text strong style={{ fontSize: 12.5 }}>Reason <Text type="danger">*</Text></Text>
          <Input.TextArea rows={2} maxLength={500} style={{ marginTop: 4 }} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="tag-switch-reason" />
        </div>
      </Space>
    </Modal>
  );
}

/** @param {{ cvId: number|string }} props */
export default function CandidateTagsSection({ cvId }) {
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState(null);
  const [movePipelineId, setMovePipelineId] = useState(null);
  const query = useQuery({
    queryKey: ['candidate-tags', String(cvId)],
    queryFn: () => candidateService.getTags(cvId),
    select: (res) => res?.data?.data ?? res?.data ?? { tags: [] },
    enabled: Boolean(cvId),
  });
  const tags = query.data?.tags || [];
  const taggedIds = useMemo(() => new Set(tags.map((t) => String(t.mrf_id))), [tags]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['candidate-tags', String(cvId)] });
    queryClient.invalidateQueries({ queryKey: ['candidate-pipeline-scores', String(cvId)] });
    queryClient.invalidateQueries({ queryKey: ['screening', 'roleCandidates'] });
  };

  if (query.isLoading) return <Spin size="small" />;
  if (tags.length === 0) {
    return <Text type="secondary" style={{ fontSize: 13 }}>Not tagged to any JD. Use "Add to JD" on Search Candidate to tag them.</Text>;
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }} data-testid="candidate-tags">
      <Space wrap size={8}>
        {tags.map((t) => (
          <Space key={t.mrf_id} size={2} style={{ border: '1px solid var(--border)', borderRadius: 16, padding: '1px 4px 1px 10px' }}>
            <Tag color={t.open_pipeline_id ? 'default' : 'green'} style={{ margin: 0, border: 'none', background: 'transparent' }}>
              {t.role} · MRF-{t.mrf_id} · {t.open_pipeline_id ? 'in pipeline' : (SOURCE_SHORT[t.source] || t.source)}
            </Tag>
            {t.can_remove && <RemoveTag cvId={cvId} tag={t} onDone={refresh} />}
            {!t.can_remove && (
              <Tooltip title={t.switch_via === 'move'
                ? 'In the pipeline for this JD: switching moves the pipeline record (Move to another JD).'
                : 'A candidate must stay tagged to a JD. Switch it to the right JD instead.'}
              >
                <Button
                  size="small"
                  type="link"
                  style={{ padding: '0 6px' }}
                  onClick={() => (t.switch_via === 'move' ? setMovePipelineId(t.open_pipeline_id) : setSwitching(t))}
                  data-testid="tag-switch"
                >
                  Switch JD
                </Button>
              </Tooltip>
            )}
          </Space>
        ))}
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>
        × removes a wrong tag while another remains. The only JD, or a JD in the pipeline, can only be switched.
      </Text>
      <SwitchTagModal cvId={cvId} tag={switching} taggedIds={taggedIds} onClose={() => setSwitching(null)} onDone={refresh} />
      <MoveJdModal
        open={Boolean(movePipelineId)}
        pipelineId={movePipelineId}
        onClose={() => setMovePipelineId(null)}
        onMoved={refresh}
      />
    </Space>
  );
}
