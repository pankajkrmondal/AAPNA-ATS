/**
 * Settings › MRF Approval & Hold.
 *
 *   Approvers                 read-only (the mrf_approvers roster)
 *   Who can decide on behalf  read-only: users whose role is HR Admin Recruiter,
 *                             Admin or Super Admin (the role is the control)
 *   Approver absence          Admin / Super Admin edit
 *   Hold rules                HR Admin Recruiter and above edit; Recruiters read
 *   Held MRFs                 HR Admin Recruiter and above: change date, release now
 *
 * The server sends `can.*` so the card enables exactly what it will accept.
 * Plan: docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md §7
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Input, InputNumber, Modal, Space, Switch, Table, Tag, TimePicker, Tooltip, Typography, message } from 'antd';
import { CalendarOutlined, PauseCircleOutlined, PlayCircleOutlined, SafetyCertificateOutlined, TeamOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import mrfService from '../../services/mrfService';
import HoldDateField from '../mrf/HoldDateField';

const { Title, Text } = Typography;
const ISO = 'YYYY-MM-DD';
const HOLD_BLUE = '#234e8c';

const sectionLabel = { fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-3)' };
const box = { border: '1px solid var(--border-light)', borderRadius: 10, padding: 16 };

export default function MrfApprovalHoldSettings() {
  const [data, setData] = useState(null);
  const [held, setHeld] = useState([]);
  const [loading, setLoading] = useState(false);

  // Hold rules form
  const [rules, setRules] = useState({ defaultDays: 30, maxDays: 180, releaseTime: '09:00' });
  const [savingRules, setSavingRules] = useState(false);

  // Absence form
  const [absence, setAbsence] = useState({ active: false, from: null, to: null, note: '' });
  const [savingAbsence, setSavingAbsence] = useState(false);

  // Change-date modal
  const [dateFor, setDateFor] = useState(null);
  const [newDate, setNewDate] = useState('');
  const [savingDate, setSavingDate] = useState(false);
  const [releasingId, setReleasingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, heldRows] = await Promise.all([mrfService.getApprovalSettings(), mrfService.listHeld()]);
      setData(settings);
      setHeld(Array.isArray(heldRows) ? heldRows : []);
      setRules(settings.hold_rules);
      setAbsence({
        active: Boolean(settings.absence?.active),
        from: settings.absence?.from || null,
        to: settings.absence?.to || null,
        note: settings.absence?.note || '',
      });
    } catch (err) {
      message.error(err?.message || 'Could not load the MRF approval settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const can = data?.can || {};

  const saveRules = async () => {
    setSavingRules(true);
    try {
      const res = await mrfService.saveHoldRules(rules);
      message.success(res?.message || 'Hold rules saved.');
      await load();
    } catch (err) {
      message.error(err?.message || 'Could not save the hold rules.');
    } finally {
      setSavingRules(false);
    }
  };

  const saveAbsence = async () => {
    setSavingAbsence(true);
    try {
      const res = await mrfService.saveApproverAbsence(absence);
      message.success(res?.message || 'Saved.');
      await load();
    } catch (err) {
      message.error(err?.message || 'Could not save the absence.');
    } finally {
      setSavingAbsence(false);
    }
  };

  const openDate = (row) => { setDateFor(row); setNewDate(row.held_until); };
  const saveDate = async () => {
    setSavingDate(true);
    try {
      const res = await mrfService.changeHoldDate(dateFor.id, { holdUntil: newDate });
      message.success(res?.message || 'Hold date changed.');
      setDateFor(null);
      await load();
    } catch (err) {
      message.error(err?.message || 'Could not change the hold date.');
    } finally {
      setSavingDate(false);
    }
  };

  const release = (row) => {
    Modal.confirm({
      title: `Release MRF #${row.id} from hold now?`,
      content: 'It goes back to pending and the approval request is emailed to every approver again.',
      okText: 'Release now',
      onOk: async () => {
        setReleasingId(row.id);
        try {
          const res = await mrfService.releaseHold(row.id);
          message.success(res?.message || 'Released from hold.');
          await load();
        } catch (err) {
          message.error(err?.message || 'Could not release the hold.');
        } finally {
          setReleasingId(null);
        }
      },
    });
  };

  const absenceStatus = data?.absence?.in_effect
    ? <Tag color="green" style={{ margin: 0 }}>On-behalf decisions open until {data.absence.to_label}</Tag>
    : data?.absence?.active
      ? <Tag color="gold" style={{ margin: 0 }}>Scheduled {data.absence.from_label} – {data.absence.to_label}</Tag>
      : <Tag style={{ margin: 0 }}>Off — approvers available</Tag>;

  const heldColumns = [
    { title: 'MRF', dataIndex: 'id', key: 'id', width: 70, render: (v) => `#${v}` },
    { title: 'Role', dataIndex: 'position', key: 'position', render: (v) => <Text strong>{v || '—'}</Text> },
    { title: 'Held by', dataIndex: 'held_by_name', key: 'by', render: (v) => v || '—' },
    { title: 'Held on', dataIndex: 'held_at_ist', key: 'at', render: (v) => (v ? v.replace(/,.*$/, '') : '—') },
    {
      title: 'Hold until',
      key: 'until',
      render: (_, r) => (
        <span>
          <b>{r.held_until_label}</b>
          <Text type="secondary" style={{ fontSize: 12 }}> · {r.days_left} day{r.days_left === 1 ? '' : 's'}</Text>
          {r.closed ? <Tag color="red" style={{ marginLeft: 6 }}>closed</Tag> : null}
        </span>
      ),
    },
    { title: 'Note', dataIndex: 'hold_note', key: 'note', ellipsis: { showTitle: true } },
    { title: 'Times', dataIndex: 'hold_count', key: 'count', width: 70 },
    ...(can.manage_held ? [{
      title: '',
      key: 'actions',
      width: 230,
      render: (_, r) => (
        <Space size={6}>
          <Button size="small" icon={<CalendarOutlined />} onClick={() => openDate(r)}>Change date</Button>
          <Tooltip title={r.closed ? 'Re-open the requisition first' : ''}>
            <Button size="small" icon={<PlayCircleOutlined />} disabled={r.closed} loading={releasingId === r.id} onClick={() => release(r)} style={{ color: HOLD_BLUE, borderColor: HOLD_BLUE }}>
              Release now
            </Button>
          </Tooltip>
        </Space>
      ),
    }] : []),
  ];

  return (
    <Card bordered={false} className="glass-card" style={{ marginTop: 24 }} loading={loading && !data}>
      <div style={{ marginBottom: 20 }}>
        <Title level={3} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: '0 0 6px 0' }}>
          MRF Approval &amp; Hold
        </Title>
        <Text type="secondary">
          Who approves MRFs, who can decide when they are away, and how long an MRF can be held.
          Approver absence: Admins. Hold rules and held MRFs: HR Admin Recruiter and above. Recruiters: view only.
        </Text>
        {data && (!data.features?.hold || !data.features?.on_behalf) && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12, borderRadius: 8 }}
            message={`Switched off on this server: ${[!data.features.hold && 'Hold', !data.features.on_behalf && 'deciding on behalf of approvers'].filter(Boolean).join(' and ')}.`}
          />
        )}
      </div>

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
            <div style={box}>
              <div style={sectionLabel}><SafetyCertificateOutlined /> Approvers</div>
              <Space wrap style={{ marginTop: 10 }}>
                {data.approvers.length ? data.approvers.map((a) => (
                  <Tag key={a.email} style={{ padding: '4px 10px', borderRadius: 16, fontSize: 13 }}>{a.name}{a.title ? ` · ${a.title}` : ''}</Tag>
                )) : <Text type="secondary">No approvers configured.</Text>}
              </Space>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
                Every new MRF, and every MRF coming back from hold, is emailed to all of them. The first decision counts.
              </div>
            </div>

            <div style={box}>
              <div style={sectionLabel}><TeamOutlined /> Who can decide on behalf</div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-3)' }}>
                HR Admin Recruiter, Admin or Super Admin — only while the approvers are marked away.
              </div>
              <Space wrap style={{ marginTop: 10 }}>
                {data.on_behalf_users.map((u) => (
                  <Tag key={u.id} color={u.role === 'hr_admin_recruiter' ? 'purple' : 'default'} style={{ padding: '4px 10px', borderRadius: 16, fontSize: 13 }}>
                    {u.name} · {u.roleLabel}
                  </Tag>
                ))}
              </Space>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
                To add someone, change their role in Admin Portal › Users.
              </div>
            </div>
          </div>

          <div style={{ ...box, border: '2px solid var(--brand-primary, #5b6e1e)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={sectionLabel}>Approver absence</div>
              {absenceStatus}
            </div>
            <Space wrap align="end" size={18} style={{ marginTop: 12 }}>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}>
                <Switch checked={absence.active} disabled={!can.edit_absence} onChange={(v) => setAbsence((a) => ({ ...a, active: v }))} />
                Approvers are away
              </label>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>From – To</div>
                <DatePicker.RangePicker
                  disabled={!can.edit_absence}
                  value={absence.from && absence.to ? [dayjs(absence.from), dayjs(absence.to)] : null}
                  onChange={(v) => setAbsence((a) => ({ ...a, from: v?.[0]?.format(ISO) || null, to: v?.[1]?.format(ISO) || null }))}
                  format="DD MMM YYYY"
                />
              </div>
              <div style={{ minWidth: 240, flex: 1 }}>
                <label htmlFor="absence-note" style={{ fontSize: 12, fontWeight: 600 }}>Note</label>
                <Input id="absence-note" disabled={!can.edit_absence} value={absence.note} maxLength={500} onChange={(e) => setAbsence((a) => ({ ...a, note: e.target.value }))} placeholder="e.g. Both travelling" style={{ marginTop: 4 }} />
              </div>
              {can.edit_absence && (
                <Button type="primary" loading={savingAbsence} onClick={saveAbsence} disabled={absence.active && (!absence.from || !absence.to)}>
                  Save absence
                </Button>
              )}
            </Space>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>
              {data.absence?.setByName ? `Last set by ${data.absence.setByName}. ` : ''}
              Saving a window emails the approvers and every HR Admin Recruiter. Outside these dates nobody can decide on behalf, not even Admins.
            </div>
          </div>

          <div style={box}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={sectionLabel}><PauseCircleOutlined /> Hold rules</div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {can.edit_hold_rules ? 'No limit on how many times an MRF is held; each hold is capped by the maximum.' : 'View only — HR Admin Recruiter and above can change these.'}
              </Text>
            </div>
            <Space wrap align="end" size={24} style={{ marginTop: 12 }}>
              <div>
                <label htmlFor="hold-default-days" style={{ fontSize: 12, fontWeight: 600 }}>Default hold length</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <InputNumber id="hold-default-days" min={1} max={rules.maxDays} disabled={!can.edit_hold_rules} value={rules.defaultDays} onChange={(v) => setRules((r) => ({ ...r, defaultDays: v }))} />
                  <Text type="secondary">days</Text>
                </div>
              </div>
              <div>
                <label htmlFor="hold-max-days" style={{ fontSize: 12, fontWeight: 600 }}>Maximum hold length</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <InputNumber id="hold-max-days" min={1} max={365} disabled={!can.edit_hold_rules} value={rules.maxDays} onChange={(v) => setRules((r) => ({ ...r, maxDays: v }))} />
                  <Text type="secondary">days</Text>
                </div>
              </div>
              <div>
                <label htmlFor="hold-release-time" style={{ fontSize: 12, fontWeight: 600 }}>Release time (IST, daily)</label>
                <div style={{ marginTop: 4 }}>
                  <TimePicker
                    id="hold-release-time"
                    format="HH:mm"
                    minuteStep={15}
                    allowClear={false}
                    disabled={!can.edit_hold_rules}
                    value={dayjs(rules.releaseTime, 'HH:mm')}
                    onChange={(v) => v && setRules((r) => ({ ...r, releaseTime: v.format('HH:mm') }))}
                  />
                </div>
              </div>
              {can.edit_hold_rules && (
                <Button type="primary" loading={savingRules} onClick={saveRules}>Save hold rules</Button>
              )}
            </Space>
          </div>

          <div style={box}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={sectionLabel}>Held MRFs · {held.length}</div>
              {can.manage_held && <Text type="secondary" style={{ fontSize: 12 }}>Change a date or release early</Text>}
            </div>
            {held.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No MRF is on hold" />
            ) : (
              <Table rowKey="id" size="small" pagination={false} columns={heldColumns} dataSource={held} scroll={{ x: 900 }} />
            )}
          </div>
        </div>
      )}

      <Modal
        open={Boolean(dateFor)}
        title={dateFor ? `Change the hold-until date — MRF #${dateFor.id}` : ''}
        okText="Save date"
        onOk={saveDate}
        okButtonProps={{ disabled: !newDate || newDate === dateFor?.held_until, loading: savingDate }}
        onCancel={() => setDateFor(null)}
        destroyOnHidden
      >
        <HoldDateField value={newDate} onChange={setNewDate} config={data?.hold_bounds} id="settings-hold-until" label="New hold-until date" />
      </Modal>
    </Card>
  );
}
