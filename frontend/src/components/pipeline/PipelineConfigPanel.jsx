/**
 * PipelineConfigPanel — admin screens for the pipeline's own configuration:
 * stages, the outcomes each stage offers, and the Reject/Hold reason taxonomy.
 *
 * This closes RT's "changeable without development" ask (2026-07-13). The API
 * and the client methods in services/pipeline.js have existed since M1, but no
 * screen ever called them — stages, outcomes and reasons could only be changed
 * with raw SQL or a hand-rolled API call, which is the opposite of the ask.
 *
 * Mounted from Settings.jsx behind the same admin-tier check the server
 * enforces (requireAdmin in backend middleware/auth.js). The client check is a
 * courtesy so the UI doesn't offer actions that will 403; the server one is the
 * real gate.
 *
 * Table/modal/Card conventions follow Settings.jsx and EmailManagement.jsx
 * rather than introducing a third style.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Switch, Select,
  Tabs, Tag, Space, Typography, message,
} from 'antd';
import { PlusOutlined, EditOutlined, ApartmentOutlined } from '@ant-design/icons';
import pipelineService from '../../services/pipeline';

const { Title, Text } = Typography;

/**
 * Stage types the engine actually branches on. 'zeko' drives the Zeko round
 * detection in config/pipelineStages.js, so it is a fixed list rather than free
 * text — an admin inventing a new type would produce a stage the engine cannot
 * reason about.
 */
const STAGE_TYPES = [
  { value: 'manual', label: 'Manual — recruiter records the outcome' },
  { value: 'zeko', label: 'Zeko — AI screening round' },
  { value: 'assessment', label: 'Assessment — Evalground test' },
  { value: 'interview', label: 'Interview — scheduled, with scorecards' },
  { value: 'system', label: 'System — documents / offer' },
];

/** Outcome keys the stage engine treats specially; see STAGE_OUTCOMES. */
const CORE_OUTCOME_KEYS = ['approved', 'rejected', 'hold', 'future_prospect'];

export default function PipelineConfigPanel() {
  const [stages, setStages] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // One modal per entity kind; `editing` null means "create".
  const [stageModal, setStageModal] = useState({ open: false, editing: null });
  const [outcomeModal, setOutcomeModal] = useState({ open: false, stageKey: null, editing: null });
  const [reasonModal, setReasonModal] = useState({ open: false, editing: null });

  const [stageForm] = Form.useForm();
  const [outcomeForm] = Form.useForm();
  const [reasonForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stageRes, reasonRes] = await Promise.all([
        pipelineService.listStages(),
        // Inactive ones included: this is the only screen that can bring one back.
        pipelineService.listReasons(true),
      ]);
      setStages(stageRes.data?.data || []);
      setReasons(reasonRes.data?.data || []);
    } catch (err) {
      message.error(err.response?.data?.message || err?.message || 'Could not load the pipeline configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Shared submit path. The server owns every real rule (duplicate keys,
   * deactivating a stage that still has candidates on it), so this deliberately
   * surfaces the server's message rather than second-guessing it locally — the
   * "3 open candidates are on this stage" explanation is far more useful than a
   * generic failure.
   */
  const submit = async (fn, successMsg, closeModal) => {
    setSaving(true);
    try {
      await fn();
      message.success(successMsg);
      closeModal();
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || err?.message || 'That change could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  // ── Stages ───────────────────────────────────────────────────────────

  const openStage = (stage = null) => {
    stageForm.resetFields();
    if (stage) {
      stageForm.setFieldsValue({
        label: stage.label,
        sort_order: stage.sort_order,
        is_optional: !!stage.is_optional,
        is_active: stage.is_active !== false,
        stage_type: stage.stage_type || 'manual',
      });
    } else {
      stageForm.setFieldsValue({
        sort_order: (stages.reduce((m, s) => Math.max(m, s.sort_order ?? 0), 0) || 0) + 10,
        is_optional: false,
        is_active: true,
        stage_type: 'manual',
      });
    }
    setStageModal({ open: true, editing: stage });
  };

  const saveStage = async () => {
    const values = await stageForm.validateFields();
    const editing = stageModal.editing;
    await submit(
      () => (editing
        ? pipelineService.updateStage(editing.stage_key, values)
        : pipelineService.createStage(values)),
      editing ? 'Stage updated.' : 'Stage created.',
      () => setStageModal({ open: false, editing: null })
    );
  };

  const stageColumns = [
    {
      title: 'Order',
      dataIndex: 'sort_order',
      width: 80,
      sorter: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      defaultSortOrder: 'ascend',
    },
    {
      title: 'Stage',
      dataIndex: 'label',
      render: (label, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{label}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.stage_key}</Text>
        </Space>
      ),
    },
    { title: 'Type', dataIndex: 'stage_type', width: 130, render: (t) => <Tag>{t || 'manual'}</Tag> },
    {
      title: 'Flags',
      width: 190,
      render: (_, row) => (
        <Space size={4} wrap>
          {row.is_optional && <Tag color="blue">Optional</Tag>}
          {row.is_active === false
            ? <Tag color="default">Inactive</Tag>
            : <Tag color="green">Active</Tag>}
        </Space>
      ),
    },
    {
      title: 'Outcomes',
      width: 110,
      render: (_, row) => (
        <Button size="small" onClick={() => setOutcomeModal({ open: true, stageKey: row.stage_key, editing: null })}>
          {(row.rpa_stage_outcomes || []).length || 0} outcome(s)
        </Button>
      ),
    },
    {
      title: '',
      width: 90,
      render: (_, row) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openStage(row)}>Edit</Button>
      ),
    },
  ];

  // ── Outcomes ─────────────────────────────────────────────────────────

  const outcomeStage = stages.find((s) => s.stage_key === outcomeModal.stageKey);
  const outcomesForStage = outcomeStage?.rpa_stage_outcomes || [];

  const openOutcome = (outcome = null) => {
    outcomeForm.resetFields();
    if (outcome) {
      outcomeForm.setFieldsValue({
        label: outcome.label,
        is_advance: !!outcome.is_advance,
        is_final: !!outcome.is_final,
        is_active: outcome.is_active !== false,
        sort_order: outcome.sort_order,
      });
    } else {
      outcomeForm.setFieldsValue({ is_advance: false, is_final: false, is_active: true, sort_order: 0 });
    }
    setOutcomeModal((m) => ({ ...m, editing: outcome, formOpen: true }));
  };

  const saveOutcome = async () => {
    const values = await outcomeForm.validateFields();
    const { stageKey, editing } = outcomeModal;
    await submit(
      () => (editing
        ? pipelineService.updateStageOutcome(stageKey, editing.outcome_key, values)
        : pipelineService.createStageOutcome(stageKey, values)),
      editing ? 'Outcome updated.' : 'Outcome added.',
      () => setOutcomeModal((m) => ({ ...m, editing: null, formOpen: false }))
    );
  };

  // ── Reasons ──────────────────────────────────────────────────────────

  const openReason = (reason = null) => {
    reasonForm.resetFields();
    if (reason) {
      reasonForm.setFieldsValue({
        reason_label: reason.reason_label,
        is_active: reason.is_active !== false,
        sort_order: reason.sort_order,
      });
    } else {
      reasonForm.setFieldsValue({ outcome_key: 'rejected', is_other: false, is_active: true, sort_order: 0 });
    }
    setReasonModal({ open: true, editing: reason });
  };

  const saveReason = async () => {
    const values = await reasonForm.validateFields();
    const editing = reasonModal.editing;
    await submit(
      () => (editing
        // Only these three are editable — changing a reason's stage/outcome
        // scope after the fact would silently re-file every past decision that
        // cited it.
        ? pipelineService.updateReason(editing.id, {
          reason_label: values.reason_label,
          is_active: values.is_active,
          sort_order: values.sort_order,
        })
        : pipelineService.createReason(values)),
      editing ? 'Reason updated.' : 'Reason created.',
      () => setReasonModal({ open: false, editing: null })
    );
  };

  const reasonColumns = [
    { title: 'Reason', dataIndex: 'reason_label', render: (v, r) => (
      <Space size={6}>
        <Text>{v}</Text>
        {r.is_other && <Tag color="purple">free text</Tag>}
      </Space>
    ) },
    { title: 'Applies to', dataIndex: 'outcome_key', width: 120, render: (v) => <Tag>{v}</Tag> },
    { title: 'Stage', dataIndex: 'stage_key', width: 150, render: (v) => v || <Text type="secondary">All stages</Text> },
    { title: 'Order', dataIndex: 'sort_order', width: 80 },
    { title: 'Status', dataIndex: 'is_active', width: 100, render: (v) => (v === false ? <Tag>Inactive</Tag> : <Tag color="green">Active</Tag>) },
    { title: '', width: 90, render: (_, row) => <Button size="small" icon={<EditOutlined />} onClick={() => openReason(row)}>Edit</Button> },
  ];

  const uppercaseLabel = (t) => (
    <span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-2)', letterSpacing: '0.4px' }}>{t}</span>
  );

  return (
    <Card
      bordered={false}
      style={{ borderRadius: 12, boxShadow: 'var(--shadow-md)', borderTop: '4px solid var(--gold)', marginTop: 24 }}
    >
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: '0 0 6px 0' }}>
          <ApartmentOutlined style={{ marginRight: 10 }} />
          Pipeline Configuration
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          The stages candidates move through, the outcomes each stage offers, and the reasons
          recorded on a Reject or Hold. Changes apply immediately to the Candidate Pipeline board.
        </Text>
      </div>

      <div
        style={{
          background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: 8,
          padding: '16px 20px', color: 'var(--info-text)', fontSize: 13.5, lineHeight: 1.6, marginBottom: 24,
        }}
      >
        <strong>Before you change a stage:</strong> stage order defines the route candidates take, so
        re-ordering affects everyone currently mid-pipeline. A stage cannot be deactivated while open
        candidates are sitting on it — move them on first, or they would be left unable to advance.
      </div>

      <Tabs
        items={[
          {
            key: 'stages',
            label: 'Stages & Outcomes',
            children: (
              <>
                <Space style={{ marginBottom: 12 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openStage(null)}>Add stage</Button>
                </Space>
                <Table
                  rowKey="stage_key"
                  loading={loading}
                  columns={stageColumns}
                  dataSource={stages}
                  pagination={false}
                  size="middle"
                  style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}
                />
              </>
            ),
          },
          {
            key: 'reasons',
            label: 'Reject / Hold Reasons',
            children: (
              <>
                <Space style={{ marginBottom: 12 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openReason(null)}>Add reason</Button>
                </Space>
                <Table
                  rowKey="id"
                  loading={loading}
                  columns={reasonColumns}
                  dataSource={reasons}
                  pagination={{ pageSize: 12 }}
                  size="middle"
                  style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}
                />
              </>
            ),
          },
        ]}
      />

      {/* ── Stage modal ── */}
      <Modal
        title={stageModal.editing ? `Edit stage — ${stageModal.editing.label}` : 'Add a stage'}
        open={stageModal.open}
        onCancel={() => setStageModal({ open: false, editing: null })}
        onOk={saveStage}
        confirmLoading={saving}
        okText={stageModal.editing ? 'Save' : 'Create'}
        destroyOnClose
      >
        <Form form={stageForm} layout="vertical" style={{ marginTop: 16 }}>
          {!stageModal.editing && (
            <Form.Item
              name="stage_key"
              label={uppercaseLabel('Stage key')}
              // Immutable after creation: every stage event, email-template
              // mapping and legacy status string is keyed on it.
              extra="Lowercase, no spaces (e.g. tech4). This cannot be changed later."
              rules={[
                { required: true, message: 'A stage key is required.' },
                { pattern: /^[a-z][a-z0-9_]*$/, message: 'Lowercase letters, digits and underscores only.' },
              ]}
            >
              <Input placeholder="tech4" />
            </Form.Item>
          )}
          <Form.Item name="label" label={uppercaseLabel('Label')} rules={[{ required: true, message: 'A label is required.' }]}>
            <Input placeholder="Technical Round 4" />
          </Form.Item>
          <Form.Item name="stage_type" label={uppercaseLabel('Type')} rules={[{ required: true }]}>
            <Select options={STAGE_TYPES} />
          </Form.Item>
          <Form.Item name="sort_order" label={uppercaseLabel('Order')} extra="Lower numbers come first." rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_optional" label={uppercaseLabel('Optional stage')} valuePropName="checked" extra="Optional stages can be skipped without an outcome.">
            <Switch />
          </Form.Item>
          {stageModal.editing && (
            <Form.Item name="is_active" label={uppercaseLabel('Active')} valuePropName="checked" extra="Inactive stages leave the board and the advance route.">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* ── Outcomes for one stage ── */}
      <Modal
        title={`Outcomes — ${outcomeStage?.label || ''}`}
        open={outcomeModal.open}
        onCancel={() => setOutcomeModal({ open: false, stageKey: null, editing: null })}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Space style={{ marginBottom: 12, marginTop: 8 }}>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => openOutcome(null)}>Add outcome</Button>
        </Space>
        <Table
          rowKey="outcome_key"
          size="small"
          pagination={false}
          dataSource={outcomesForStage}
          columns={[
            { title: 'Outcome', dataIndex: 'label', render: (v, r) => (
              <Space direction="vertical" size={0}>
                <Text strong>{v}</Text>
                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  {r.outcome_key}
                  {CORE_OUTCOME_KEYS.includes(r.outcome_key) && ' · built-in'}
                </Text>
              </Space>
            ) },
            { title: 'Advances', dataIndex: 'is_advance', width: 90, render: (v) => (v ? 'Yes' : '—') },
            { title: 'Final', dataIndex: 'is_final', width: 70, render: (v) => (v ? 'Yes' : '—') },
            { title: 'Status', dataIndex: 'is_active', width: 90, render: (v) => (v === false ? <Tag>Inactive</Tag> : <Tag color="green">Active</Tag>) },
            { title: '', width: 70, render: (_, row) => <Button size="small" onClick={() => openOutcome(row)}>Edit</Button> },
          ]}
        />

        {outcomeModal.formOpen && (
          <Card size="small" style={{ marginTop: 16, background: 'var(--surface-2)' }}>
            <Form form={outcomeForm} layout="vertical">
              {!outcomeModal.editing && (
                <Form.Item
                  name="outcome_key"
                  label={uppercaseLabel('Outcome key')}
                  extra="approved / rejected / hold drive the engine's own behaviour. A new key is recorded and emailed, but does not auto-advance."
                  rules={[
                    { required: true, message: 'An outcome key is required.' },
                    { pattern: /^[a-z][a-z0-9_]*$/, message: 'Lowercase letters, digits and underscores only.' },
                  ]}
                >
                  <Input placeholder="deferred" />
                </Form.Item>
              )}
              <Form.Item name="label" label={uppercaseLabel('Label')} rules={[{ required: true, message: 'A label is required.' }]}>
                <Input placeholder="Deferred to next quarter" />
              </Form.Item>
              <Space size={24} wrap>
                <Form.Item name="is_advance" label={uppercaseLabel('Advances')} valuePropName="checked"><Switch /></Form.Item>
                <Form.Item name="is_final" label={uppercaseLabel('Final')} valuePropName="checked"><Switch /></Form.Item>
                {outcomeModal.editing && (
                  <Form.Item name="is_active" label={uppercaseLabel('Active')} valuePropName="checked"><Switch /></Form.Item>
                )}
                <Form.Item name="sort_order" label={uppercaseLabel('Order')}><InputNumber min={0} /></Form.Item>
              </Space>
              <Space>
                <Button type="primary" loading={saving} onClick={saveOutcome}>
                  {outcomeModal.editing ? 'Save outcome' : 'Add outcome'}
                </Button>
                <Button onClick={() => setOutcomeModal((m) => ({ ...m, editing: null, formOpen: false }))}>Cancel</Button>
              </Space>
            </Form>
          </Card>
        )}
      </Modal>

      {/* ── Reason modal ── */}
      <Modal
        title={reasonModal.editing ? 'Edit reason' : 'Add a Reject / Hold reason'}
        open={reasonModal.open}
        onCancel={() => setReasonModal({ open: false, editing: null })}
        onOk={saveReason}
        confirmLoading={saving}
        okText={reasonModal.editing ? 'Save' : 'Create'}
        destroyOnClose
      >
        <Form form={reasonForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="reason_label" label={uppercaseLabel('Reason')} rules={[{ required: true, message: 'A reason label is required.' }]}>
            <Input placeholder="Salary expectation out of range" />
          </Form.Item>
          {!reasonModal.editing && (
            <>
              <Form.Item name="outcome_key" label={uppercaseLabel('Applies to')} rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'rejected', label: 'Reject' },
                    { value: 'hold', label: 'Hold' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="stage_key"
                label={uppercaseLabel('Stage')}
                extra="Leave blank to offer this reason at every stage."
              >
                <Select
                  allowClear
                  placeholder="All stages"
                  options={stages.map((s) => ({ value: s.stage_key, label: s.label }))}
                />
              </Form.Item>
              <Form.Item
                name="is_other"
                label={uppercaseLabel('Free-text reason')}
                valuePropName="checked"
                extra='Marks this as the "Other" option — picking it forces the recruiter to type the real reason, and that text is what gets recorded.'
              >
                <Switch />
              </Form.Item>
            </>
          )}
          {reasonModal.editing && (
            <>
              <Form.Item name="is_active" label={uppercaseLabel('Active')} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Text type="secondary" style={{ fontSize: 12 }}>
                A reason&apos;s stage and outcome scope cannot be changed after creation — past decisions
                cite it, and re-scoping would silently re-file them. Deactivate it and add a new one instead.
              </Text>
            </>
          )}
          <Form.Item name="sort_order" label={uppercaseLabel('Order')} style={{ marginTop: 12 }}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
