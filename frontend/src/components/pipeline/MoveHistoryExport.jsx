/**
 * MoveHistoryExport — the "Move history" report next to Export CSV on the
 * pipeline page (flexible stages, docs/phase3/pipeline/FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md C12).
 * Downloads every stage move, filterable by date range, user and position.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, DatePicker, Modal, Select, Space, Typography } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import pipelineService from '../../services/pipeline';
import ExportButton from '../common/ExportButton';

const { Text } = Typography;

/**
 * @param {object} props
 * @param {object[]} props.positionOptions - the board's Position select options (value 'mrf:<id>' | 'text:<role>')
 * @param {string} [props.mrfId] - the board's current MRF filter, used as the default
 */
export default function MoveHistoryExport({ positionOptions = [], mrfId }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(null);
  const [movedBy, setMovedBy] = useState();
  const [mrf, setMrf] = useState(mrfId);

  const { data: users = [] } = useQuery({
    queryKey: ['move-history-users'],
    queryFn: async () => {
      const res = await pipelineService.listMoveHistoryUsers();
      return res.data?.data || res.data || [];
    },
    enabled: open,
  });

  // Only requisitions can be filtered on: a keyword shortlist has no MRF id.
  const flat = positionOptions.flatMap((o) => (o.options ? o.options : [o]));
  const mrfOptions = flat.filter((o) => String(o.value).startsWith('mrf:'))
    .map((o) => ({ value: String(o.value).slice(4), label: o.label }));

  const params = {
    date_from: range?.[0] ? range[0].format('YYYY-MM-DD') : undefined,
    date_to: range?.[1] ? range[1].format('YYYY-MM-DD') : undefined,
    moved_by: movedBy || undefined,
    mrf_id: mrf || undefined,
  };

  return (
    <>
      <Button icon={<HistoryOutlined />} onClick={() => { setMrf(mrfId); setOpen(true); }} data-testid="move-history-open">
        Move history
      </Button>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        title="Move history report"
        footer={null}
        width={520}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }} data-testid="move-history-modal">
          <Text type="secondary">
            Every stage move: candidate, from and to stage, direction, stages skipped, who moved them and when.
          </Text>
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Date range</Text>
            <DatePicker.RangePicker style={{ width: '100%', marginTop: 4 }} value={range} onChange={setRange} format="DD MMM YYYY" data-testid="move-history-range" />
          </div>
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Moved by</Text>
            <Select
              allowClear
              placeholder="Anyone"
              style={{ width: '100%', marginTop: 4 }}
              value={movedBy}
              onChange={setMovedBy}
              options={users.map((u) => ({ value: u.id, label: u.username }))}
              data-testid="move-history-user"
            />
          </div>
          <div>
            <Text strong style={{ fontSize: 12.5 }}>Position / MRF</Text>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="All positions"
              style={{ width: '100%', marginTop: 4 }}
              value={mrf}
              onChange={setMrf}
              options={mrfOptions}
              data-testid="move-history-mrf"
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportButton
              request={(cfg) => pipelineService.exportMoveHistory(params, cfg)}
              fallbackName="AAPNA-ATS_Pipeline-Move-History.csv"
              label="Download CSV"
            />
          </div>
        </Space>
      </Modal>
    </>
  );
}
