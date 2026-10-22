/**
 * ApprovalTrail — the MRF approval audit trail inside the MRF details modal.
 *
 * Answers the question production could not on 24 Sep 2026: who approved (or
 * declined), when, from where, and who else was told. Data comes from
 * GET /api/mrf/:mrfId/approval-trail; the server only includes IP address and
 * device for admin-tier users, so nothing here needs to hide them by role.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Modal, Space, Spin, Tag, Timeline, Tooltip, Typography, message } from 'antd';
import { ReloadOutlined, SendOutlined } from '@ant-design/icons';
import mrfService from '../../services/mrfService';

const { Text } = Typography;
const OPEN = ['pending', 'waiting'];

const word = (status) => (status === 'rejected' ? 'declined' : status || 'processed');

/** One line of plain English per event, plus the colour of its timeline dot. */
function describe(e) {
  const who = e.actor_name || e.actor_email || 'Someone';
  const m = e.meta || {};
  switch (e.type) {
    case 'request_sent':
      if (m.emailSent === false) return { color: 'red', text: <>Approval request to <b>{who}</b> could <b>not</b> be emailed</> };
      return { color: 'blue', text: <>{m.reason === 'reissued' ? 'Approval request re-sent' : 'Approval request emailed'} to <b>{who}</b></> };
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
  if (a.used_at) return <Tag color="success">Decided</Tag>;
  if (a.revoked_reason === 'decided_by_other') return <Tag>Closed — decided by another approver</Tag>;
  if (a.revoked_reason === 'reissued') return <Tag>Replaced by a newer link</Tag>;
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

  return (
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
              {' '}on <b>{decision.decided_at_ist}</b>
              {decision.ip ? <Text type="secondary"> · IP {decision.ip}</Text> : null}
              {decision.comments ? <div style={{ marginTop: 4 }}><Text type="secondary">Comment:</Text> {decision.comments}</div> : null}
            </div>
          ) : (
            <div style={{ marginBottom: 12, fontSize: 13 }}>
              <Text type="secondary">
                {isOpen ? 'Waiting for a decision. Only one approval is needed.' : 'No decision recorded in the audit trail.'}
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
                      {e.comments && ['approved', 'rejected', 'attempt_after_decision'].includes(e.type) ? (
                        <div><Text type="secondary">Comment:</Text> {e.comments}</div>
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
  );
}
