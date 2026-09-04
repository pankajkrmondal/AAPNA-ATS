/**
 * ReferralPanel — mark a candidate as an employee referral, and see who changed
 * it and when.
 *
 * Lives inside the Edit Candidate modal but saves through its OWN buttons rather
 * than the modal's "Update Candidate", and that is deliberate on three counts:
 *
 *   1. The server has separate endpoints, because setting and removing carry
 *      different permissions — any recruiter may set, only admin-tier may remove.
 *      One "Save" that silently needs two permission levels is a lie.
 *   2. Every change writes an audit row. Bundling an audited action into a
 *      generic save makes it feel incidental, which is the opposite of intended.
 *   3. A removal needs a typed reason first, so it cannot be part of a bulk save
 *      at all.
 *
 * WHO SEES THIS: logged-in superadmin / admin / recruiter only. The referral must
 * never reach an interviewer — not on a scorecard, not in an invite, not in a
 * dossier (Sanghamitra, 2026-08-28: "none of the interview process should know").
 * That is enforced server-side; this component is simply one of the surfaces
 * allowed to show it.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Checkbox, Input, Button, Space, Typography, Tooltip, Modal, AutoComplete, Spin, Alert, Tag, message,
} from 'antd';
import { DeleteOutlined, HistoryOutlined } from '@ant-design/icons';
import candidateService from '../../services/candidateService';
import useAuth from '../../hooks/useAuth';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const LABEL = { fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.4px' };

/** Same idiom the router guards and MainLayout use. */
const isAdminTier = (role) => ['admin', 'superadmin'].includes((role || '').toLowerCase());

/** "4 Sep 2026, 12:30" — no dependency on a date library. */
function when(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** One audit row as a sentence. The verb carries the meaning, so it leads. */
function describe(row) {
  if (row.action === 'marked') return `Marked as referral — ${row.new_referred_by || '—'}`;
  if (row.action === 'updated') {
    return row.old_referred_by !== row.new_referred_by
      ? `Referrer changed — ${row.old_referred_by || '—'} → ${row.new_referred_by || '—'}`
      : 'Referral note updated';
  }
  return `Referral removed — was ${row.old_referred_by || '—'}`;
}

export default function ReferralPanel({ candidateId, onChanged }) {
  const { user } = useAuth();
  const canRemove = isAdminTier(user?.role);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [referral, setReferral] = useState(null);
  const [history, setHistory] = useState([]);
  const [referrers, setReferrers] = useState([]);

  const [checked, setChecked] = useState(false);
  const [referredBy, setReferredBy] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeReason, setRemoveReason] = useState('');
  const [removing, setRemoving] = useState(false);

  // Only the LATEST fetch may write state. Without this a slow first response can
  // land after the recruiter has already ticked the box and started typing, and
  // silently reset both — the form appears to undo itself, which on a slow
  // connection looks like the save was rejected.
  const reqRef = useRef(0);

  // `initial` distinguishes the first fetch from a refetch after a save. Only the
  // first shows a spinner INSTEAD of the panel; a refetch keeps the panel on
  // screen, because swapping a filled section for a spinner makes the modal jump
  // and loses the reader's place at the exact moment they want to see the result.
  const load = useCallback(async ({ initial = false } = {}) => {
    if (!candidateId) return;
    const seq = ++reqRef.current;
    if (initial) setLoading(true);
    setError('');
    try {
      const res = await candidateService.getReferral(candidateId);
      if (seq !== reqRef.current) return;          // superseded — drop it
      const data = res.data?.data ?? res.data ?? {};
      setReferral(data.referral || null);
      setHistory(data.history || []);
      setChecked(!!data.referral?.is_referral);
      setReferredBy(data.referral?.referred_by || '');
      setNote(data.referral?.referral_note || '');
    } catch (err) {
      if (seq !== reqRef.current) return;
      setError(err?.message || 'Could not load the referral status for this candidate.');
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => { load({ initial: true }); }, [load]);

  // Seeded from names already used, so the second person to type "Anuj" picks the
  // spelling the first one used instead of inventing a fourth. Best-effort: the
  // field works without it.
  useEffect(() => {
    let cancelled = false;
    candidateService.getReferrers()
      .then((res) => { if (!cancelled) setReferrers(res.data?.data ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const isReferral = !!referral?.is_referral;
  const trimmed = referredBy.replace(/\s+/g, ' ').trim();
  const dirty = trimmed !== (referral?.referred_by || '')
    || (note.trim() || '') !== (referral?.referral_note || '');

  const save = async () => {
    if (!trimmed) {
      message.warning('Please enter who referred this candidate.');
      return;
    }
    setSaving(true);
    try {
      const res = await candidateService.setReferral(candidateId, { referredBy: trimmed, note });
      message.success(res.data?.message || 'Referral saved');
      await load();
      onChanged?.();
    } catch (err) {
      message.error(err?.message || 'Could not save the referral.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!removeReason.trim()) {
      message.warning('Please give a reason. It is recorded against your name.');
      return;
    }
    setRemoving(true);
    try {
      await candidateService.removeReferral(candidateId, removeReason.trim());
      message.success('Referral removed');
      setRemoveOpen(false);
      setRemoveReason('');
      await load();
      onChanged?.();
    } catch (err) {
      message.error(err?.message || 'Could not remove the referral.');
    } finally {
      setRemoving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '18px 0', textAlign: 'center' }}><Spin size="small" /></div>
    );
  }

  return (
    <div
      data-testid="referral-panel"
      style={{
        border: '1px solid var(--border-1, #e5e7eb)',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 20,
        background: isReferral ? 'rgba(122, 154, 60, 0.06)' : 'transparent',
      }}
    >
      {/* Block, not inline: an antd <Space> is inline-flex and the Checkbox below
          is inline-block, so without this the section heading and the checkbox
          render on the same line as "REFERRAL ☐ This candidate was referred…". */}
      <div style={{ display: 'block', marginBottom: 10 }}>
        <Space align="center">
          <span style={LABEL}>Referral</span>
          {isReferral ? <Tag color="green" style={{ marginInlineEnd: 0 }}>Referral candidate</Tag> : null}
        </Space>
      </div>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 10 }} /> : null}

      <Checkbox
        checked={checked}
        // Once it IS a referral the box stays ticked and locked: un-ticking would
        // be a removal, which is a separate, admin-only, reason-carrying action.
        // A checkbox that quietly performs it would be the wrong affordance.
        disabled={isReferral}
        onChange={(e) => setChecked(e.target.checked)}
      >
        This candidate was referred by an employee
      </Checkbox>

      {checked && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...LABEL, marginBottom: 4 }}>
              Referred by <Text type="danger">*</Text>
            </div>
            {/* No child <Input>. AutoComplete renders its own, and a supplied
                child both swallows the wrapper's `placeholder` and makes antd warn
                that `maxLength` will not work ("input in BaseSelect is
                controlled") — which it does not. The 255 cap is enforced in
                onChange instead, matching the varchar(255) column; the server
                rejects anything longer with a readable message regardless. */}
            <AutoComplete
              value={referredBy}
              onChange={(v) => setReferredBy((v || '').slice(0, 255))}
              style={{ width: '100%' }}
              placeholder="e.g. Anuj Kumar"
              filterOption={(input, option) =>
                (option?.value || '').toLowerCase().includes(input.toLowerCase())}
              options={referrers.map((r) => ({ value: r }))}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ ...LABEL, marginBottom: 4 }}>Note (optional)</div>
            <TextArea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Context for the recruiting team — never shown to interviewers"
              style={{ borderRadius: 6 }}
            />
          </div>

          <Space>
            <Button
              type="primary"
              size="small"
              loading={saving}
              disabled={!trimmed || !dirty}
              onClick={save}
            >
              {isReferral ? 'Save referral' : 'Mark as referral'}
            </Button>

            {isReferral && (
              <Tooltip
                title={canRemove ? '' : 'Only an admin can remove a referral. Ask an administrator.'}
              >
                {/* Span wrapper: antd Tooltip needs a non-disabled child to fire. */}
                <span>
                  <Button
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    disabled={!canRemove}
                    onClick={() => setRemoveOpen(true)}
                  >
                    Remove referral
                  </Button>
                </span>
              </Tooltip>
            )}
          </Space>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px dashed var(--border-1, #e5e7eb)', paddingTop: 10 }}>
          <Space size={6} style={{ marginBottom: 6 }}>
            <HistoryOutlined style={{ color: 'var(--text-3)', fontSize: 12 }} />
            <span style={LABEL}>History</span>
          </Space>
          {history.map((h) => (
            <div key={h.id} style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-2)' }}>
              <Text strong style={{ fontSize: 12 }}>{describe(h)}</Text>
              {' · '}
              {h.acted_by_name}
              {' · '}
              {when(h.acted_at)}
              {h.reason ? (
                <div style={{ paddingLeft: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
                  Reason: {h.reason}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <Modal
        title="Remove referral"
        open={removeOpen}
        onOk={remove}
        onCancel={() => { setRemoveOpen(false); setRemoveReason(''); }}
        okText="Remove referral"
        okButtonProps={{ danger: true, loading: removing }}
        destroyOnClose
      >
        <Paragraph style={{ marginBottom: 12 }}>
          This clears the referral flag and the referrer&apos;s name
          {referral?.referred_by ? <> (<Text strong>{referral.referred_by}</Text>)</> : null}.
          The removal is recorded against your name and cannot be undone from here.
        </Paragraph>
        <div style={{ ...LABEL, marginBottom: 4 }}>Reason <Text type="danger">*</Text></div>
        <TextArea
          rows={3}
          value={removeReason}
          onChange={(e) => setRemoveReason(e.target.value)}
          placeholder="e.g. Marked by mistake — wrong candidate"
        />
      </Modal>
    </div>
  );
}
