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
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Switch, Select,
  Tabs, Tag, Space, Tooltip, Typography, message,
} from 'antd';
import {
  PlusOutlined, EditOutlined, ApartmentOutlined, ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import pipelineService from '../../services/pipeline';
import emailTemplateService from '../../services/emailTemplateService';
import settingsService from '../../services/settingsService';
import { MODAL_WIDTH } from './modalWidths';

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

// Tab keys the Tabs below actually use — a stale/foreign panelTab param falls
// back to the default rather than rendering a blank pane.
const PANEL_TAB_KEYS = new Set(['stages', 'reasons', 'stage-templates', 'flow-keys']);

export default function PipelineConfigPanel() {
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('panelTab');
  const initialPanelTab = PANEL_TAB_KEYS.has(requestedTab) ? requestedTab : undefined;
  const [stages, setStages] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [mappings, setMappings] = useState([]);
  // The generic per-outcome fallback each unmapped pair really lands on, plus
  // the outcomes the dispatcher refuses to email at all. Both come from the
  // server (stageNotification.service.js owns the chain) rather than being
  // restated here, so the screen cannot drift from what actually sends.
  const [fallbacks, setFallbacks] = useState([]);
  const [silentOutcomes, setSilentOutcomes] = useState([]);
  const [flowKeys, setFlowKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Reasons tab: scope the (potentially long, mixed) list down to one stage.
  const [reasonStageFilter, setReasonStageFilter] = useState(null);

  // Outcome Emails tab: rowKey -> the template_id it held before the most
  // recent change, so "Undo" can put it back. Cleared a few seconds after a
  // save — it's a brief safety net, not a change log.
  const [recentSaves, setRecentSaves] = useState({});
  const saveTimers = useRef({});
  useEffect(() => () => {
    Object.values(saveTimers.current).forEach(clearTimeout);
  }, []);

  // One modal per entity kind; `editing` null means "create".
  const [stageModal, setStageModal] = useState({ open: false, editing: null });
  const [outcomeModal, setOutcomeModal] = useState({ open: false, stageKey: null, editing: null });
  const [reasonModal, setReasonModal] = useState({ open: false, editing: null });
  const [flowKeyModal, setFlowKeyModal] = useState({ open: false, editing: null });

  const [stageForm] = Form.useForm();
  const [outcomeForm] = Form.useForm();
  const [reasonForm] = Form.useForm();
  const [flowKeyForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Flow keys and templates are admin-only reads and 403 for anyone else.
      // allSettled so one refused call cannot blank the tabs that did load —
      // this panel is already behind an admin check, but a role change
      // mid-session should degrade, not wipe the screen.
      const [stageRes, reasonRes, templateRes, mappingRes, flowRes] = await Promise.allSettled([
        pipelineService.listStages(),
        // Inactive ones included: this is the only screen that can bring one back.
        pipelineService.listReasons(true),
        emailTemplateService.getEmailTemplates(),
        pipelineService.listStageTemplates(),
        settingsService.getFlowKeys(),
      ]);
      if (stageRes.status === 'fulfilled') setStages(stageRes.value.data?.data || []);
      if (reasonRes.status === 'fulfilled') setReasons(reasonRes.value.data?.data || []);
      if (templateRes.status === 'fulfilled') setTemplates(templateRes.value.data?.data || []);
      if (mappingRes.status === 'fulfilled') {
        // GET /stage-templates returns the whole resolution chain as of
        // 2026-08-26; the `|| payload` keeps a cached/older array response
        // working as the plain mapping list it used to be.
        const payload = mappingRes.value.data?.data;
        setMappings(payload?.mappings || (Array.isArray(payload) ? payload : []));
        setFallbacks(payload?.fallbacks || []);
        setSilentOutcomes(payload?.silent_outcomes || []);
      }
      if (flowRes.status === 'fulfilled') setFlowKeys(flowRes.value.data?.data || []);

      if (stageRes.status === 'rejected') {
        message.error(stageRes.reason?.response?.data?.message || 'Could not load the pipeline configuration.');
      }
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
      // sort_order isn't editable here any more — the Move Up/Down buttons on
      // the table own reordering existing stages.
      stageForm.setFieldsValue({
        label: stage.label,
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

  /**
   * Swaps a stage with its immediate neighbor — the actual need behind
   * reordering (move this one above/below that one) without the round-trip of
   * opening two edit modals and retyping sort_order by hand. Optimistic: the
   * table reorders immediately and rolls back if either PUT fails.
   */
  const moveStage = async (index, direction) => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= stages.length) return;
    const a = stages[index];
    const b = stages[targetIndex];
    const aOrder = a.sort_order ?? 0;
    const bOrder = b.sort_order ?? 0;
    const prevStages = stages;
    const next = [...stages];
    next[index] = { ...b, sort_order: aOrder };
    next[targetIndex] = { ...a, sort_order: bOrder };
    setStages(next);
    try {
      await Promise.all([
        pipelineService.updateStage(a.stage_key, { sort_order: bOrder }),
        pipelineService.updateStage(b.stage_key, { sort_order: aOrder }),
      ]);
    } catch (err) {
      setStages(prevStages);
      message.error(err.response?.data?.message || err?.message || 'Could not reorder — try again.');
    }
  };

  // Table's dataSource is `stages` in its loaded (sort_order ascending) order
  // with no client-side sort applied, so the row index Table hands back lines
  // up exactly with the state array index moveStage expects.
  const stageColumns = [
    {
      title: '',
      width: 64,
      render: (_, row, index) => (
        <Space size={2}>
          <Button
            size="small"
            type="text"
            icon={<ArrowUpOutlined />}
            disabled={index === 0}
            onClick={() => moveStage(index, 'up')}
            aria-label="Move stage up"
          />
          <Button
            size="small"
            type="text"
            icon={<ArrowDownOutlined />}
            disabled={index === stages.length - 1}
            onClick={() => moveStage(index, 'down')}
            aria-label="Move stage down"
          />
        </Space>
      ),
    },
    {
      title: 'Order',
      dataIndex: 'sort_order',
      width: 70,
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
      // sort_order isn't editable here any more — Move Up/Down on the
      // outcomes table owns reordering existing outcomes.
      outcomeForm.setFieldsValue({
        label: outcome.label,
        is_advance: !!outcome.is_advance,
        is_final: !!outcome.is_final,
        is_active: outcome.is_active !== false,
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

  /** Same swap-with-neighbor approach as moveStage, scoped to one stage's outcomes. */
  const moveOutcome = async (index, direction) => {
    const list = outcomesForStage;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const a = list[index];
    const b = list[targetIndex];
    const aOrder = a.sort_order ?? 0;
    const bOrder = b.sort_order ?? 0;
    const nextList = [...list];
    nextList[index] = { ...b, sort_order: aOrder };
    nextList[targetIndex] = { ...a, sort_order: bOrder };
    const prevStages = stages;
    setStages((curr) => curr.map((s) => (
      s.stage_key === outcomeStage.stage_key ? { ...s, rpa_stage_outcomes: nextList } : s
    )));
    try {
      await Promise.all([
        pipelineService.updateStageOutcome(outcomeStage.stage_key, a.outcome_key, { sort_order: bOrder }),
        pipelineService.updateStageOutcome(outcomeStage.stage_key, b.outcome_key, { sort_order: aOrder }),
      ]);
    } catch (err) {
      setStages(prevStages);
      message.error(err.response?.data?.message || err?.message || 'Could not reorder — try again.');
    }
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

  // ── Stage → email template mappings ──────────────────────────────────
  //
  // One row per stage×outcome pair the engine can actually produce, built from
  // the stage list rather than from the mapping table: an unmapped pair is the
  // interesting case (it falls back to the generic template), and a table of
  // only-what-exists would hide every one of them. Staging had zero mapping
  // rows, so that view would have been empty.
  const mappingByPair = new Map(mappings.map((m) => [`${m.stage_key}:${m.outcome_key}`, m]));
  const fallbackByOutcome = new Map(fallbacks.map((f) => [f.outcome_key, f]));
  const silentOutcomeSet = new Set(silentOutcomes);
  const templateRows = stages
    .filter((s) => s.is_active !== false)
    .flatMap((stage) => (stage.rpa_stage_outcomes || [])
      .filter((o) => o.is_active !== false)
      .map((outcome) => {
        const mapped = mappingByPair.get(`${stage.stage_key}:${outcome.outcome_key}`);
        const fallback = fallbackByOutcome.get(outcome.outcome_key) || null;
        return {
          key: `${stage.stage_key}:${outcome.outcome_key}`,
          stage_key: stage.stage_key,
          stage_label: stage.label,
          outcome_key: outcome.outcome_key,
          outcome_label: outcome.label,
          template_id: mapped?.template_id ?? null,
          template_name: mapped?.rpa_email_templates?.name || null,
          // What this pair falls back to when nothing is picked above.
          fallback_name: fallback?.template_name || null,
          fallback_resolves: !!fallback?.resolves,
          // Silent outcomes short-circuit in resolveTemplate() before the
          // mapping is even read, so nothing picked here could ever send.
          is_silent: silentOutcomeSet.has(outcome.outcome_key),
        };
      }));

  /**
   * Autosaves on every Select change (unchanged), but a transient toast was
   * the only feedback and there was no way to undo a misclick. This tracks
   * what the row held before the change so an inline "Saved ✓ · Undo" can
   * offer to put it back, without adding a confirm-before-apply step.
   */
  const saveMapping = async (row, templateId) => {
    // Belt and braces with the disabled Select above: resolveTemplate()
    // short-circuits silent outcomes, so a mapping saved here would be dead
    // config that reads as if it works.
    if (row.is_silent) return;
    const previousValue = row.template_id;
    setSaving(true);
    try {
      await pipelineService.setStageTemplate({
        stage_key: row.stage_key,
        outcome_key: row.outcome_key,
        template_id: templateId ?? null,
      });
      await load();
      setRecentSaves((m) => ({ ...m, [row.key]: previousValue }));
      clearTimeout(saveTimers.current[row.key]);
      saveTimers.current[row.key] = setTimeout(() => {
        setRecentSaves((m) => {
          if (!(row.key in m)) return m;
          const next = { ...m };
          delete next[row.key];
          return next;
        });
      }, 6000);
    } catch (err) {
      message.error(err.response?.data?.message || err?.message || 'That change could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * The tag that answers "what does this row actually send today?".
   *
   * Nearly every pair is unmapped, so before this the honest answer to that
   * question was invisible: 38 identical blank dropdowns, with no way to tell a
   * pair that quietly sends the generic Approved mail from one that sends
   * nothing at all. The four states are deliberately distinct colours.
   */
  const renderEffectiveTemplate = (row) => {
    if (row.is_silent) {
      return (
        <Tooltip title="Recording something the candidate already knows — joined, withdrew, backed out. The dispatcher refuses these before it reads any mapping, so nothing set here can send.">
          <Tag color="default">No email — by design</Tag>
        </Tooltip>
      );
    }
    if (row.template_id) {
      return (
        <Tooltip title="This pair has its own template, chosen here. It overrides the generic.">
          <Tag color="green">{row.template_name || `Template #${row.template_id}`}</Tag>
        </Tooltip>
      );
    }
    if (row.fallback_name && row.fallback_resolves) {
      return (
        <Tooltip title={`Nothing specific is set, so this pair sends the generic “${row.fallback_name}” template.`}>
          <Tag color="blue">Generic · {row.fallback_name}</Tag>
        </Tooltip>
      );
    }
    return (
      <Tooltip title={row.fallback_name
        ? `The generic “${row.fallback_name}” template is missing or deactivated, so this pair currently sends nothing. Pick a template here, or reactivate it on the Email Templates screen.`
        : 'This outcome has no generic fallback, so unless a template is picked here it sends nothing.'}>
        <Tag color="red">Nothing sends</Tag>
      </Tooltip>
    );
  };

  const templateColumns = [
    { title: 'Stage', dataIndex: 'stage_label', width: 190 },
    { title: 'Outcome', dataIndex: 'outcome_label', width: 150, render: (v, r) => <Tag>{v || r.outcome_key}</Tag> },
    {
      title: 'Currently sends',
      key: 'effective',
      width: 260,
      render: (_, row) => renderEffectiveTemplate(row),
    },
    {
      title: 'Specific template',
      key: 'template_id',
      render: (_, row) => (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: '100%', maxWidth: 380 }}
            placeholder={row.fallback_name
              ? `Generic · ${row.fallback_name}`
              : 'Generic template for this outcome'}
            value={row.template_id}
            // Offering a working dropdown on a silent outcome was a lie: it
            // saved, said "Saved ✓", and could never send. Left disabled rather
            // than hidden so the row still reads as a real stage×outcome pair.
            disabled={saving || row.is_silent}
            onChange={(val) => saveMapping(row, val)}
            options={templates
              .filter((t) => t.is_active !== false)
              .map((t) => ({ value: t.id, label: t.name }))}
          />
          {row.key in recentSaves && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Saved ✓ ·{' '}
              <a onClick={() => saveMapping(row, recentSaves[row.key])}>Undo</a>
            </Text>
          )}
        </Space>
      ),
    },
  ];

  // ── Email flow keys ──────────────────────────────────────────────────

  const openFlowKey = (row) => {
    flowKeyForm.resetFields();
    flowKeyForm.setFieldsValue({ to: row.to || '', cc: row.cc || '' });
    setFlowKeyModal({ open: true, editing: row });
  };

  const submitFlowKey = () => flowKeyForm.validateFields().then((values) => submit(
    () => settingsService.saveFlowKey({ flowKey: flowKeyModal.editing.flowKey, ...values }),
    'Email routing updated — it takes effect on the next send.',
    () => setFlowKeyModal({ open: false, editing: null }),
  ));

  const flowKeyColumns = [
    { title: 'Flow', dataIndex: 'flowKey', width: 220, render: (v) => <Text code>{v}</Text> },
    {
      title: 'Goes to',
      dataIndex: 'to',
      render: (v, r) => {
        // A blank `to` on a dynamic flow is correct, not missing — the address
        // is worked out per send (the candidate, the vendor, the submitter).
        if (r.dynamic && !v) return <Text type="secondary">Resolved per send — the candidate, vendor or submitter</Text>;
        return v ? <Text style={{ fontSize: 12.5 }}>{v}</Text> : <Text type="secondary">Not set</Text>;
      },
    },
    { title: 'Cc', dataIndex: 'cc', width: 200, render: (v) => (v ? <Text style={{ fontSize: 12.5 }}>{v}</Text> : <Text type="secondary">—</Text>) },
    {
      title: 'On staging',
      key: 'redirectExempt',
      width: 150,
      render: (_, r) => (r.redirectExempt
        ? <Tag color="orange">Reaches real inbox</Tag>
        : <Tag color="green">Test inbox</Tag>),
    },
    { title: '', width: 90, render: (_, row) => <Button size="small" icon={<EditOutlined />} onClick={() => openFlowKey(row)}>Edit</Button> },
  ];

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
        defaultActiveKey={initialPanelTab}
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
                  <Select
                    allowClear
                    placeholder="Filter by stage"
                    style={{ width: 220 }}
                    value={reasonStageFilter}
                    onChange={(val) => setReasonStageFilter(val ?? null)}
                    options={stages.map((s) => ({ value: s.stage_key, label: s.label }))}
                  />
                </Space>
                <Table
                  rowKey="id"
                  loading={loading}
                  columns={reasonColumns}
                  dataSource={reasonStageFilter
                    ? reasons.filter((r) => r.stage_key === reasonStageFilter || !r.stage_key)
                    : reasons}
                  pagination={{ pageSize: 12 }}
                  size="middle"
                  style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}
                />
              </>
            ),
          },
          {
            key: 'stage-templates',
            label: 'Outcome Emails',
            children: (
              <>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
                  Which email a candidate receives for each stage outcome. <b>Currently sends</b> is
                  what actually goes out today: <Tag color="green" style={{ marginInlineEnd: 4 }}>green</Tag>
                  a template picked here, <Tag color="blue" style={{ marginInlineEnd: 4 }}>blue</Tag>
                  the generic Approved / Rejected / On&nbsp;Hold (or Closure) template used when nothing
                  specific is set, <Tag style={{ marginInlineEnd: 4 }}>grey</Tag> an outcome that never
                  emails by design, and <Tag color="red" style={{ marginInlineEnd: 4 }}>red</Tag> a pair
                  that would send nothing at all. Leaving a row blank is safe — it falls back to the
                  generic rather than going silent. Create new templates on the Email Templates screen.
                </Text>
                <Table
                  rowKey="key"
                  loading={loading}
                  columns={templateColumns}
                  dataSource={templateRows}
                  pagination={{ pageSize: 15 }}
                  size="middle"
                  style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}
                />
              </>
            ),
          },
          {
            key: 'flow-keys',
            label: 'Email Routing',
            children: (
              <>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
                  Who receives each kind of mail this system sends. Changes apply to the next send —
                  no restart. Most candidate-facing flows resolve their recipient at send time and
                  have nothing to set here.
                </Text>
                <Table
                  rowKey="flowKey"
                  loading={loading}
                  columns={flowKeyColumns}
                  dataSource={flowKeys}
                  pagination={{ pageSize: 15 }}
                  size="middle"
                  style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}
                />
              </>
            ),
          },
        ]}
      />

      {/* ── Flow-key modal ── */}
      <Modal
        title={`Email routing — ${flowKeyModal.editing?.flowKey || ''}`}
        open={flowKeyModal.open}
        onCancel={() => setFlowKeyModal({ open: false, editing: null })}
        onOk={submitFlowKey}
        confirmLoading={saving}
        okText="Save"
        width={MODAL_WIDTH}
        destroyOnClose
      >
        {flowKeyModal.editing?.dynamic && (
          <div
            style={{
              background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: 8,
              padding: '12px 16px', color: 'var(--info-text)', fontSize: 13, lineHeight: 1.6, marginBottom: 16,
            }}
          >
            This flow works out its own recipient at send time — the candidate, the vendor or whoever
            submitted the form. Anything set here is only a fallback for when that address is missing.
          </div>
        )}
        {flowKeyModal.editing?.redirectExempt && (
          <div
            style={{
              background: 'var(--warning-bg, #fff7e6)', border: '1px solid var(--warning-border, #ffd591)', borderRadius: 8,
              padding: '12px 16px', fontSize: 13, lineHeight: 1.6, marginBottom: 16,
            }}
          >
            <strong>This flow reaches real inboxes on staging.</strong> It is exempt from the test-inbox
            redirect — internal alerts, password mail, and addresses an operator typed in for that
            specific action. Whatever you put here will genuinely be emailed.
          </div>
        )}
        <Form form={flowKeyForm} layout="vertical">
          <Form.Item name="to" label={uppercaseLabel('To')} extra="Comma-separated. Leave blank for dynamic flows.">
            <Input placeholder="someone@aapnainfotech.com, someone.else@aapnainfotech.com" />
          </Form.Item>
          <Form.Item name="cc" label={uppercaseLabel('Cc')} extra="Comma-separated. Applies in production only.">
            <Input placeholder="Optional" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Stage modal ── */}
      <Modal
        title={stageModal.editing ? `Edit stage — ${stageModal.editing.label}` : 'Add a stage'}
        open={stageModal.open}
        onCancel={() => setStageModal({ open: false, editing: null })}
        onOk={saveStage}
        confirmLoading={saving}
        okText={stageModal.editing ? 'Save' : 'Create'}
        width={MODAL_WIDTH.CONFIRM}
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
          {!stageModal.editing && (
            <Form.Item name="sort_order" label={uppercaseLabel('Order')} extra="Lower numbers come first. Use the ▲▼ buttons on the table to reorder later." rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          )}
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
        width={MODAL_WIDTH.EMAIL}
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
            {
              title: '',
              width: 64,
              render: (_, row, index) => (
                <Space size={2}>
                  <Button
                    size="small"
                    type="text"
                    icon={<ArrowUpOutlined />}
                    disabled={index === 0}
                    onClick={() => moveOutcome(index, 'up')}
                    aria-label="Move outcome up"
                  />
                  <Button
                    size="small"
                    type="text"
                    icon={<ArrowDownOutlined />}
                    disabled={index === outcomesForStage.length - 1}
                    onClick={() => moveOutcome(index, 'down')}
                    aria-label="Move outcome down"
                  />
                </Space>
              ),
            },
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
                {!outcomeModal.editing && (
                  <Form.Item name="sort_order" label={uppercaseLabel('Order')}><InputNumber min={0} /></Form.Item>
                )}
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
        width={MODAL_WIDTH.CONFIRM}
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
