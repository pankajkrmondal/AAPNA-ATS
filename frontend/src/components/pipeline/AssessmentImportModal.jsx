/**
 * AssessmentImportModal.jsx — Phase 3 M2: bulk-CSV import of Evalground
 * assessment results, opened from the Assessment round panel (never a
 * standalone screen, per RT's 2026-07-10 UI-placement decision).
 *
 * Steps: Upload -> AI reads rows -> [Mapping review, only when the batch has
 * new/unconfirmed test-name clusters] -> Validation report -> Commit. A
 * repeat import against only already-remembered test names skips straight
 * from "AI reads rows" to the validation report, matching the simplicity
 * CandidatePipelinePrototype.jsx's v5 pass settled on for this same flow.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  App as AntApp, Alert, Button, Card, Col, Input, Modal, Row, Select, Space, Statistic, Steps, Table, Tag, Typography, Upload,
} from 'antd';
import { InboxOutlined, ImportOutlined, RobotOutlined } from '@ant-design/icons';
import assessmentImportService from '../../services/assessmentImportService';
import UploadCelebration from '../common/UploadCelebration';
import { MODAL_WIDTH } from './modalWidths';

const { Text, Paragraph } = Typography;
const { Dragger } = Upload;

const LEGACY_FIELD_OPTIONS = [
  { value: 'IQScore', label: 'General Aptitude (IQScore)' },
  { value: 'TechScore', label: 'Technical (TechScore)' },
  { value: null, label: 'Not used (record only)' },
];

export default function AssessmentImportModal({ open, onClose, onImported }) {
  const { message } = AntApp.useApp();
  const [fileList, setFileList] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [clusterEdits, setClusterEdits] = useState({}); // testName -> mapping
  const [rowOverrides, setRowOverrides] = useState({}); // rowNumber -> pipelineId
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const reset = () => {
    setFileList([]);
    setPreviewData(null);
    setClusterEdits({});
    setRowOverrides({});
    setMappingConfirmed(false);
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('file', fileList[0]);
      const res = await assessmentImportService.preview(formData);
      return res.data?.data || res.data;
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setClusterEdits(Object.fromEntries(data.clusters.map((c) => [c.testName, c.mapping])));
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to parse the file.');
    },
  });

  const commitMutation = useMutation({
    mutationFn: () => assessmentImportService.commit({
      batchId: previewData.batchId,
      clusterMappings: Object.entries(clusterEdits).map(([testName, mapping]) => ({ testName, mapping })),
      rowOverrides,
    }),
    onSuccess: (res) => {
      const summary = res.data?.data || res.data;
      setCelebrate(true);
      message.success(`Import complete — ${summary.matched} matched, ${summary.unmatched} unmatched, ${summary.duplicateSkipped} unchanged (skipped).`);
      setTimeout(() => setCelebrate(false), 1300);
      onImported?.();
      handleClose();
    },
    onError: (err) => {
      message.error(err?.message || 'Failed to commit the import.');
    },
  });

  const handleClose = () => {
    reset();
    onClose?.();
  };

  const needsMappingReview = (previewData?.clusters || []).some((c) => !c.remembered);
  const showMappingStep = previewData && needsMappingReview && !mappingConfirmed;
  const showReportStep = previewData && (!needsMappingReview || mappingConfirmed);
  const step = !previewData ? 0 : showMappingStep ? 1 : 2;
  const stepItems = needsMappingReview
    ? [{ title: 'Upload file' }, { title: 'Review mapping' }, { title: 'Validation & import' }]
    : [{ title: 'Upload file' }, { title: 'AI reads rows' }, { title: 'Validation & import' }];

  const updateClusterMapping = (testName, sectionKey, field, value) => {
    setClusterEdits((prev) => ({
      ...prev,
      [testName]: {
        ...prev[testName],
        [sectionKey]: { ...prev[testName]?.[sectionKey], [field]: value },
      },
    }));
  };

  const rowColumns = [
    { title: 'Row', dataIndex: 'rowNumber', width: 60 },
    { title: 'Email', dataIndex: 'email', ellipsis: true },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 150,
      render: (status) => {
        const map = {
          matched: { color: 'green', label: 'Matched' },
          score_overwritten: { color: 'blue', label: 'Retake — score will update' },
          duplicate_skipped: { color: 'default', label: 'Unchanged — skipped' },
          unmatched: { color: 'gold', label: 'Unmatched' },
          error: { color: 'red', label: 'Malformed' },
        };
        const info = map[status] || { color: 'default', label: status };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    { title: 'Detail', dataIndex: 'matchNote', ellipsis: true, render: (v, row) => v || row.detail || '—' },
    {
      title: 'Journey',
      key: 'journey',
      width: 220,
      render: (_, row) => {
        if (!row.otherOpenPipelineIds?.length) return row.matchedPipelineId ? `Pipeline ${row.matchedPipelineId}` : '—';
        const options = [row.matchedPipelineId, ...row.otherOpenPipelineIds].map((id) => ({ value: id, label: `Pipeline ${id}` }));
        return (
          <Select
            size="small"
            style={{ width: '100%' }}
            value={rowOverrides[row.rowNumber]?.pipelineId || row.matchedPipelineId}
            options={options}
            onChange={(pipelineId) => setRowOverrides((prev) => ({ ...prev, [row.rowNumber]: { pipelineId } }))}
          />
        );
      },
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title="IQ / Tech Assessment — import Evalground results"
      width={MODAL_WIDTH.EMAIL}
      footer={
        showReportStep ? [
          <Button key="cancel" onClick={handleClose}>Cancel</Button>,
          <Button
            key="commit"
            type="primary"
            icon={<ImportOutlined />}
            loading={commitMutation.isPending}
            onClick={() => commitMutation.mutate()}
          >
            Import {previewData.matched + previewData.scoreWillOverwrite} matched result{(previewData.matched + previewData.scoreWillOverwrite) === 1 ? '' : 's'}
          </Button>,
        ] : !previewData ? [
          <Button key="cancel" onClick={handleClose}>Cancel</Button>,
          <Button
            key="preview"
            type="primary"
            icon={<RobotOutlined />}
            loading={previewMutation.isPending}
            disabled={fileList.length === 0}
            onClick={() => previewMutation.mutate()}
          >
            Read file
          </Button>,
        ] : [
          <Button key="cancel" onClick={handleClose}>Cancel</Button>,
        ]
      }
    >
      <UploadCelebration show={celebrate} />
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Matched by candidate email. Nothing is written until you confirm the import at the end.
        A row already on file is skipped unless the score changed — a changed score only overwrites the score, nothing else.
      </Paragraph>
      <Steps size="small" current={step} items={stepItems} style={{ marginBottom: 16 }} />

      {!previewData && (
        <Dragger
          multiple={false}
          fileList={fileList}
          beforeUpload={(file) => {
            setFileList([file]);
            return false;
          }}
          onRemove={() => setFileList([])}
          accept=".csv,.xlsx"
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">Click or drag an Evalground CSV/Excel export here</p>
          <p className="ant-upload-hint">.csv or .xlsx — one file per test export</p>
        </Dragger>
      )}

      {showMappingStep && (
        <>
          <Alert
            type="info"
            showIcon
            icon={<RobotOutlined />}
            message={`${previewData.fileName} — ${previewData.totalRows} rows read. AI-suggested section-to-skill mapping below — review once, applies to every row in this file.`}
            style={{ marginBottom: 12 }}
          />
          {previewData.clusters.map((cluster) => (
            <Card key={cluster.testName} size="small" title={`${cluster.testName} (${cluster.rowCount} rows)`} style={{ marginBottom: 12 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {['section_1', 'section_2', 'section_3'].map((sectionKey, idx) => {
                  const mapping = clusterEdits[cluster.testName]?.[sectionKey] || {};
                  return (
                    <Row key={sectionKey} gutter={8} align="middle">
                      <Col span={4}><Text type="secondary">Section {idx + 1}</Text></Col>
                      <Col span={10}>
                        <Input
                          size="small"
                          placeholder="Skill label"
                          value={mapping.skill_label || ''}
                          onChange={(e) => updateClusterMapping(cluster.testName, sectionKey, 'skill_label', e.target.value)}
                        />
                      </Col>
                      <Col span={10}>
                        <Select
                          size="small"
                          style={{ width: '100%' }}
                          value={mapping.legacy_field ?? null}
                          options={LEGACY_FIELD_OPTIONS}
                          onChange={(value) => updateClusterMapping(cluster.testName, sectionKey, 'legacy_field', value)}
                        />
                      </Col>
                    </Row>
                  );
                })}
              </Space>
            </Card>
          ))}
          <Button type="primary" onClick={() => setMappingConfirmed(true)}>
            Confirm mapping for this batch
          </Button>
        </>
      )}

      {showReportStep && (
        <>
          <Alert
            type="success"
            showIcon
            icon={<RobotOutlined />}
            message={`${previewData.fileName} — ${previewData.totalRows} rows read, no column mapping needed.`}
            style={{ marginBottom: 12 }}
          />
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={5}><Card size="small"><Statistic title="Matched" value={previewData.matched} valueStyle={{ color: '#3f8600' }} /></Card></Col>
            <Col span={5}><Card size="small"><Statistic title="Retakes (score update)" value={previewData.scoreWillOverwrite} valueStyle={{ color: '#1677ff' }} /></Card></Col>
            <Col span={5}><Card size="small"><Statistic title="Unchanged (skipped)" value={previewData.duplicateSkipped} /></Card></Col>
            <Col span={5}><Card size="small"><Statistic title="Unmatched" value={previewData.unmatched} valueStyle={{ color: '#d4a017' }} /></Card></Col>
            <Col span={4}><Card size="small"><Statistic title="Malformed" value={previewData.malformed} valueStyle={{ color: '#cf1322' }} /></Card></Col>
          </Row>
          <Table
            size="small"
            rowKey="rowNumber"
            columns={rowColumns}
            dataSource={previewData.rows}
            pagination={{ pageSize: 8 }}
            scroll={{ x: true }}
          />
        </>
      )}
    </Modal>
  );
}
