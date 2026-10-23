/**
 * ApprovalTrail — the MRF approval audit trail inside the MRF details modal.
 *
 * Answers the question production could not on 24 Sep 2026: who approved (or
 * declined), when, from where, and who else was told. Data comes from
 * GET /api/mrf/:mrfId/approval-trail; the server only includes IP address and
 * device for admin-tier users, so nothing here needs to hide them by role.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Modal, Space, Spin, Tag, Timeline, Tooltip, Typography, message } from 'antd';
import { PauseCircleOutlined, ReloadOutlined, SendOutlined, CalendarOutlined, PlayCircleOutlined } from '@ant-design/icons';
import mrfService from '../../services/mrfService';
import HoldDateField from './HoldDateField';
import DecideOnBehalfPanel from './DecideOnBehalfPanel';

const { Text } = Typography;
const OPEN = ['pending', 'waiting'];
const HOLD_BLUE = '#234e8c';

const word = (status) => (status === 'rejected' ? 'declined' : status === 'held' ? 'put on hold' : status || 'processed');

/** "on behalf of the approvers" chip for decisions taken in the ATS. */
const OnBehalfTag = () => <Tag color="purple" style={{ marginLeft: 6 }}>on behalf of approvers</Tag>;

/** One line of plain English per event, plus the colour of its timeline dot. */
function describe(e) {
  const who = e.actor_name || e.actor_email || 'Someone';
  const m = e.meta || {};
  const onBehalf = m.via === 'ats_delegate';
  switch (e.type) {
    case 'request_sent':
      if (m.emailSent === false) return { color: 'red', text: <>Approval request to <b>{who}</b> could <b>not</b> be emailed</> };
      return {
        color: 'blue',
        text: <>{m.reason === 'reissued' ? 'Approval request re-sent' : m.reason === 'hold_released' ? 'Back from hold — approval request emailed again' : 'Approval request emailed'} to <b>{who}</b></>,
      };
    case 'held':
      return {
        color: HOLD_BLUE,
        text: (
          <>
            <Tag color="blue" style={{ fontWeight: 700 }}>ON HOLD</Tag>
            by <b>{who}</b>{m.holdUntil ? <> until <b>{m.holdUntil}</b></> : null}
            {onBehalf ? <OnBehalfTag /> : null}
          </>
        ),
      };
    case 'hold_date_changed':
      return { color: HOLD_BLUE, text: <>Hold date changed {m.from ? <>from <b>{m.from}</b> </> : null}to <b>{m.to}</b> by <b>{who}</b></> };
    case 'hold_released':
      return {
        color: 'green',
        text: m.trigger === 'manual'
          ? <><b>{who}</b> released the hold — back to pending</>
          : <>Hold-until date reached — back to pending</>,
      };
    case 'hold_notice_sent':
      return { color: 'blue', text: <>Hold notice emailed to HR, the hiring manager and the other approvers</> };
    case 'delegate_notice_sent':
      return { color: 'blue', text: <><b>{who}</b> was emailed that it was {m.hold ? 'put on hold' : 'decided'} on their behalf</> };
    case 'link_opened':
      return {
        color: e.likely_scanner ? 'gray' : 'blue',
        text: (
          <>
            <b>{who}</b> opened their approval link
            {m.statusAtOpen && !OPEN.includes(m.statusAtOpen) ? ' (after the decision)' : ''}
            {e.likely_scanner ? <Text type="secondary"> — possibly an email security scanner</Text> : null}
          </>
        ),
      };
    case 'approved':
    case 'rejected':
      return {
        color: e.type === 'approved' ? 'green' : 'red',
        text: (
          <>
            <b>{e.type === 'approved' ? 'APPROVED' : 'DECLINED'}</b> by <b>{who}</b>
            {onBehalf ? <OnBehalfTag /> : null}
            {e.identity_source === 'legacy_shared_link' ? <Text type="secondary"> (older shared link — approver not identifiable)</Text> : null}
          </>
        ),
      };
    case 'attempt_after_decision':
      return { color: 'orange', text: <><b>{who}</b> tried to {word(m.attemptedAction)} after the decision — refused</> };
    case 'token_expired':
      return { color: 'orange', text: <><b>{who}</b> used an expired approval link — refused</> };
    case 'token_invalid':
      return { color: 'orange', text: <>An invalid approval link was used — refused</> };
    case 'token_revoked_used':
      return { color: 'orange', text: <><b>{who}</b> used a replaced approval link — refused</> };
    case 'other_approvers_notified':
      return { color: 'blue', text: <><b>{who}</b> was emailed that it is already decided</> };
    case 'decision_confirmation_sent':
      return { color: 'blue', text: <>Confirmation emailed to <b>{who}</b></> };
    case 'links_reissued':
      return { color: 'purple', text: <><b>{who}</b> re-sent the approval links ({m.revokedLinks ?? 0} old link(s) closed)</> };
    case 'backfilled':
      return {
        color: 'gray',
        text: <>{word(e.new_status).toUpperCase()} before the audit trail existed — <Text type="secondary">who decided was never recorded</Text></>,
      };
    default:
      return { color: 'gray', text: e.type };
  }
}

function approverTag(a) {
  if (a.used_at && a.revoked_reason === 'held') return <Tag color="blue">Put it on hold</Tag>;
  if (a.used_at) return <Tag color="success">Decided</Tag>;
  if (a.revoked_reason === 'decided_by_other') return <Tag>Closed — decided by another approver</Tag>;
  if (a.revoked_reason === 'reissued') return <Tag>Replaced by a newer link</Tag>;
  if (a.revoked_reason === 'held') return <Tag color="blue">Closed — put on hold</Tag>;
  if (a.revoked_reason === 'decided_by_delegate') return <Tag color="purple">Closed — decided on behalf</Tag>;
  if (a.revoked_at) return <Tag>Closed</Tag>;
  if (a.expires_at && new Date(a.expires_at) < new Date()) return <Tag color="warning">Link expired</Tag>;
  if (a.open_count > 0) return <Tag color="processing">Opened ×{a.open_count}</Tag>;
  return <Tag color="gold">Not opened yet</Tag>;
}

/**
 * @param {string} mrfId  rpa_mrf id
 * @param {(status: string) => void} [onStatus]  called with the live approval
 *   status on every load, so the modal's "MRF Approval Status" tag does not keep
 *   showing the value from when the list was fetched
 * @param {() => void} [onChanged]  called after a re-send
 */
export default function ApprovalTrail({ mrfId, onStatus, onChanged }) {
  const [trail, setTrail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const load = useCallback(async () => {
    if (!mrfId) return;
    setLoading(true);
    try {
      const data = await mrfService.getApprovalTrail(mrfId);
      setTrail(data);
      if (data?.approval_status) onStatus?.(data.approval_status);
    } catch (err) {
      message.error(err?.message || 'Could not load the approval trail.');
    } finally {
      setLoading(false);
    }
  }, [mrfId]); // eslint-disable-line react-hooks/exhaustive-deps -- onStatus is a fresh closure each render

  useEffect(() => { load(); }, [load]);

  const resend = () => {
    Modal.confirm({
      title: 'Re-send approval links?',
      content: 'Every approver gets a new personal link by email. The links sent earlier stop working.',
      okText: 'Re-send',
      onOk: async () => {
        setResending(true);
        try {
          const res = await mrfService.reissueApprovalLinks(mrfId);
          message.success(res?.message || 'Approval links re-sent.');
          await load();
          onChanged?.();
        } catch (err) {
          message.error(err?.message || 'Could not re-send the approval links.');
        } finally {
          setResending(false);
        }
      },
    });
  };

  const isOpen = trail && OPEN.includes(String(trail.approval_status || '').toLowerCase());
  const decision = trail?.decision;
  const hold = trail?.hold;
  const isHeld = Boolean(hold?.held);

  // ── Held MRF: change the date / release now (HR Admin Recruiter and above) ──
  const [dateModal, setDateModal] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [dateNote, setDateNote] = useState('');
  const [savingDate, setSavingDate] = useState(false);
  const [releasing, setReleasing] = useState(false);

  const openDateModal = () => {
    setNewDate(hold?.held_until || '');
    setDateNote('');
    setDateModal(true);
  };

  const saveDate = async () => {
    setSavingDate(true);
    try {
      const res = await mrfService.changeHoldDate(mrfId, { holdUntil: newDate, note: dateNote.trim() || undefined });
      message.success(res?.message || 'Hold date changed.');
      setDateModal(false);
      await load();
      onChanged?.();
    } catch (err) {
      message.error(err?.message || 'Could not change the hold date.');
    } finally {
      setSavingDate(false);
    }
  };

  const release = () => {
    Modal.confirm({
      title: 'Release this MRF from hold now?',
      content: 'It goes back to pending and the approval request is emailed to every approver again (the same email as the first time).',
      okText: 'Release now',
      onOk: async () => {
        setReleasing(true);
        try {
          const res = await mrfService.releaseHold(mrfId);
          message.success(res?.message || 'Released from hold.');
          await load();
          onChanged?.();
        } catch (err) {
          message.error(err?.message || 'Could not release the hold.');
        } finally {
          setReleasing(false);
        }
      },
    });
  };

  return (
    <>
    {trail?.on_behalf?.visible && (
      <DecideOnBehalfPanel
        mrfId={mrfId}
        onBehalf={trail.on_behalf}
        holdConfig={trail.hold?.config}
        onDone={async () => { await load(); onChanged?.(); }}
      />
    )}

    {isHeld && (
      <div style={{ border: '1px solid #9db6dd', background: '#e7eef9', borderRadius: 10, padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tag color="blue" icon={<PauseCircleOutlined />} style={{ fontWeight: 700, margin: 0 }}>ON HOLD</Tag>
            <span style={{ fontWeight: 700, color: '#1b3d6e' }}>
              until {hold.held_until_label}{hold.days_left !== null && hold.days_left !== undefined ? ` · ${hold.days_left} day${hold.days_left === 1 ? '' : 's'} left` : ''}
            </span>
            {hold.hold_count > 1 ? <Tag style={{ margin: 0 }}>Held {hold.hold_count}×</Tag> : null}
          </div>
          <div style={{ fontSize: 13, color: '#1b3d6e', marginTop: 4 }}>
            Put on hold by <b>{hold.held_by_name || 'an approver'}</b>{hold.held_at_ist ? ` on ${hold.held_at_ist}` : ''}.
            {hold.note ? <> Note: &ldquo;{hold.note}&rdquo;</> : null}
            {' '}On that date it goes back to pending and every approver is emailed again.
            {hold.closed ? <Text type="warning"> The requisition is closed, so nothing will be sent until it is re-opened.</Text> : null}
          </div>
        </div>
        {hold.can_manage && (
          <Space>
            <Button icon={<CalendarOutlined />} onClick={openDateModal} disabled={!hold.config}>Change date</Button>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={releasing} onClick={release} disabled={hold.closed} style={{ background: HOLD_BLUE, borderColor: HOLD_BLUE }}>
              Release now
            </Button>
          </Space>
        )}
      </div>
    )}

    <Modal
      open={dateModal}
      title="Change the hold-until date"
      okText="Save date"
      onOk={saveDate}
      okButtonProps={{ disabled: !newDate || newDate === hold?.held_until, loading: savingDate }}
      onCancel={() => setDateModal(false)}
      destroyOnHidden
    >
      <HoldDateField value={newDate} onChange={setNewDate} config={hold?.config} id="change-hold-until" label="New hold-until date" />
      <div style={{ marginTop: 14 }}>
        <label htmlFor="change-hold-note" style={{ fontWeight: 600, fontSize: 13 }}>Note (optional)</label>
        <Input.TextArea id="change-hold-note" value={dateNote} onChange={(e) => setDateNote(e.target.value)} maxLength={2000} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="Why the date changed" style={{ marginTop: 6 }} />
      </div>
      <Text type="secondary" style={{ display: 'block', marginTop: 10, fontSize: 12 }}>HR, the hiring manager and the approvers are emailed the new date.</Text>
    </Modal>

    <div style={{ background: 'var(--ink-4)', padding: '16px 24px', borderRadius: 8, border: '1px solid var(--border-light)', marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-3)' }}>
          Approval Trail
        </div>
        <Space size={6}>
          {isOpen && (
            <Button size="small" icon={<SendOutlined />} loading={resending} onClick={resend}>
              Re-send approval links
            </Button>
          )}
          <Tooltip title="Refresh">
            <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading} aria-label="Refresh approval trail" />
          </Tooltip>
        </Space>
      </div>

      {loading && !trail ? (
        <div style={{ textAlign: 'center', padding: 12 }}><Spin size="small" /></div>
      ) : !trail ? null : (
        <>
          {decision ? (
            <div style={{ marginBottom: 12, fontSize: 13 }}>
              <Tag color={trail.approval_status === 'rejected' ? 'error' : 'success'} style={{ fontWeight: 700 }}>
                {word(trail.approval_status).toUpperCase()}
              </Tag>
              by <b>{decision.decided_by_name || 'Unknown'}</b>
              {decision.decided_by_email ? <Text type="secondary"> ({decision.decided_by_email})</Text> : null}
              {decision.decided_via === 'ats_delegate' ? <OnBehalfTag /> : null}
              {' '}on <b>{decision.decided_at_ist}</b>
              {decision.ip ? <Text type="secondary"> · IP {decision.ip}</Text> : null}
              {decision.comments ? <div style={{ marginTop: 4 }}><Text type="secondary">Comment:</Text> {decision.comments}</div> : null}
            </div>
          ) : (
            <div style={{ marginBottom: 12, fontSize: 13 }}>
              <Text type="secondary">
                {isOpen
                  ? 'Waiting for a decision. Only one approval is needed.'
                  : isHeld ? 'On hold — no final decision yet.' : 'No decision recorded in the audit trail.'}
              </Text>
            </div>
          )}

          {trail.approvers.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {trail.approvers.map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '2px 0' }}>
                  <span style={{ minWidth: 180 }}><b>{a.name || a.email}</b> <Text type="secondary">{a.email}</Text></span>
                  {approverTag(a)}
                </div>
              ))}
            </div>
          )}

          {trail.events.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No approval activity recorded yet" />
          ) : (
            <Timeline
              style={{ marginTop: 8, marginBottom: -16 }}
              items={trail.events.map((e) => {
                const { color, text } = describe(e);
                return {
                  key: e.id,
                  color,
                  children: (
                    <div style={{ fontSize: 12.5 }}>
                      <Text type="secondary" style={{ marginRight: 6 }}>{e.at_ist}</Text>
                      {text}
                      {e.comments && ['approved', 'rejected', 'attempt_after_decision', 'held', 'hold_date_changed'].includes(e.type) ? (
                        <div><Text type="secondary">{e.type === 'held' ? 'Note:' : 'Comment:'}</Text> {e.comments}</div>
                      ) : null}
                      {trail.client_data_included && (e.ip || e.device) ? (
                        <div><Text type="secondary" style={{ fontSize: 11.5 }}>
                          {e.ip ? `IP ${e.ip}` : ''}{e.ip && e.device ? ' · ' : ''}{e.device || ''}{e.masked ? ' (masked after retention period)' : ''}
                        </Text></div>
                      ) : null}
                    </div>
                  ),
                };
              })}
            />
          )}
        </>
      )}
    </div>
    </>
  );
}
