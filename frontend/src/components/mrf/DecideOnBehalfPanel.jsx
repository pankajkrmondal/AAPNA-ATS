/**
 * DecideOnBehalfPanel — approve / reject / hold an MRF from the ATS on behalf
 * of the approvers (Abhijit and Sanghamitra), shown in the MRF details modal.
 *
 * Usable only by the one person chosen in Settings › MRF Approval & Hold, any
 * time an MRF is awaiting a decision (U06b). Admins who are not that person see
 * it locked, with the reason, so they know who decides. The server decides;
 * this panel only mirrors what it allows (`on_behalf` from the approval trail).
 *
 * Plan: docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md §6.3, §8
 */
import { useState } from 'react';
import { Button, Checkbox, Input, Segmented, Tag, Typography, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LockOutlined, PauseCircleOutlined } from '@ant-design/icons';
import mrfService from '../../services/mrfService';
import useAuth from '../../hooks/useAuth';
import HoldDateField from './HoldDateField';

const { Text } = Typography;

const isAdminTier = (role) => ['admin', 'superadmin'].includes(String(role || '').toLowerCase());

/**
 * Why the panel is locked. Only an Admin or Super Admin chooses the person
 * (mrfHoldSettings.controller), so they are pointed at Settings. Other refusals
 * keep the server's words.
 */
function lockedReason(onBehalf, role) {
  const name = onBehalf?.designee?.name;
  switch (onBehalf?.reason) {
    case 'no_designee':
      return isAdminTier(role)
        ? 'no one is set to decide on behalf. Choose the person in Settings › MRF Approval & Hold.'
        : 'no one is set to decide on behalf. An Admin can choose the person in Settings › MRF Approval & Hold.';
    case 'not_designated':
      return name
        ? `only ${name} can decide on behalf of the approvers.${isAdminTier(role) ? ' You can change the person in Settings › MRF Approval & Hold.' : ''}`
        : (onBehalf?.message || 'not available to you.');
    case 'designee_inactive':
      return `${name || 'the person set to decide on behalf'} is no longer active. ${isAdminTier(role) ? 'Choose another person' : 'An Admin can choose another person'} in Settings › MRF Approval & Hold.`;
    default:
      return onBehalf?.message || 'not available right now.';
  }
}

const ACTION_COPY = {
  approve: { button: 'Approve on behalf', color: '#5b6e1e', icon: <CheckCircleOutlined /> },
  reject: { button: 'Reject on behalf', color: '#b42318', icon: <CloseCircleOutlined /> },
  hold: { button: 'Put on hold on behalf', color: '#234e8c', icon: <PauseCircleOutlined /> },
};

/**
 * @param {{
 *   mrfId: string,
 *   onBehalf: { can_decide: boolean, reason?: string|null, message?: string|null, designee?: { name: string }|null, hold_enabled: boolean },
 *   holdConfig?: object|null,
 *   onDone: () => void,
 * }} props
 */
export default function DecideOnBehalfPanel({ mrfId, onBehalf, holdConfig, onDone }) {
  const { user } = useAuth();
  const [action, setAction] = useState('approve');
  const [reason, setReason] = useState('');
  const [holdUntil, setHoldUntil] = useState(holdConfig?.defaultDate || '');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  const locked = !onBehalf?.can_decide;
  const canHold = Boolean(onBehalf?.hold_enabled && holdConfig);
  const copy = ACTION_COPY[action];
  const ready = reason.trim() && confirmed && (action !== 'hold' || holdUntil);

  const submit = async () => {
    setSaving(true);
    try {
      const res = await mrfService.decideOnBehalf(mrfId, {
        action,
        comments: reason.trim(),
        ...(action === 'hold' ? { holdUntil } : {}),
      });
      message.success(res?.message || 'Decision recorded.');
      setReason('');
      setConfirmed(false);
      onDone?.();
    } catch (err) {
      message.error(err?.message || 'Could not record the decision.');
      onDone?.(); // refresh: someone may have decided meanwhile
    } finally {
      setSaving(false);
    }
  };

  if (locked) {
    return (
      <div style={{ border: '1px dashed var(--border-light, #c9ccbe)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <LockOutlined style={{ color: 'var(--text-3)' }} aria-hidden="true" />
        <Text type="secondary" style={{ fontSize: 13 }}>
          <b>Decide on behalf of approvers</b> — {lockedReason(onBehalf, user?.role)}
        </Text>
      </div>
    );
  }

  return (
    <div style={{ border: '2px solid #5b6e1e', background: 'var(--ink-4, #fafbf5)', borderRadius: 10, padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#4b5d17' }}>
          Decide on behalf of approvers
        </div>
        <Tag color="purple" style={{ margin: 0 }}>Chosen in Settings</Tag>
      </div>

      <Segmented
        block
        value={action}
        onChange={setAction}
        options={[
          { label: 'Approve', value: 'approve', icon: <CheckCircleOutlined /> },
          { label: 'Reject', value: 'reject', icon: <CloseCircleOutlined /> },
          ...(canHold ? [{ label: 'Hold', value: 'hold', icon: <PauseCircleOutlined /> }] : []),
        ]}
        style={{ marginBottom: 12 }}
      />

      {action === 'hold' && (
        <div style={{ border: '1px solid var(--info-border)', background: 'var(--info-bg)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <HoldDateField value={holdUntil} onChange={setHoldUntil} config={holdConfig} id="on-behalf-hold-until" />
        </div>
      )}

      <label htmlFor="on-behalf-reason" style={{ fontWeight: 600, fontSize: 13 }}>
        Reason (shared with both approvers) <Text type="danger">*</Text>
      </label>
      <Input.TextArea
        id="on-behalf-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={2000}
        autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder={action === 'hold' ? 'Why it is on hold' : "e.g. Client start date is 15 Nov; approved per Abhijit's call on 26 Oct."}
        style={{ marginTop: 6, marginBottom: 10 }}
      />

      <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginBottom: 12 }}>
        I am deciding on behalf of the approvers. Both will be emailed straight away and the decision is recorded under my name.
      </Checkbox>

      <div>
        <Button
          type="primary"
          icon={copy.icon}
          loading={saving}
          disabled={!ready}
          onClick={submit}
          style={{ background: ready ? copy.color : undefined, borderColor: ready ? copy.color : undefined, fontWeight: 600 }}
        >
          {copy.button}
        </Button>
      </div>
    </div>
  );
}
