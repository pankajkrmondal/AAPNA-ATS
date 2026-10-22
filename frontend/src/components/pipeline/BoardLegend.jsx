/**
 * BoardLegend — the pipeline board's "What do these mean?" panel (Phase 3
 * "Do Now", N35). Lists every card chip and every stage column with a
 * one-line meaning, from constants/pipelineLabels.js — the same text the
 * chips and column headers show on hover.
 */
import { Button, Popover, Tag, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { CARD_STATUSES, STAGE_DESCRIPTIONS } from '../../constants/pipelineLabels';

const { Text } = Typography;

const rowStyle = { display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10, alignItems: 'baseline', padding: '3px 0' };
const headStyle = { display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', margin: '4px 0 6px' };

export default function BoardLegend({ stages = [] }) {
  const content = (
    <div style={{ maxWidth: 520, maxHeight: '70vh', overflowY: 'auto' }} data-testid="board-legend">
      <Text type="secondary" strong style={headStyle}>Card labels</Text>
      {Object.entries(CARD_STATUSES).map(([key, s]) => (
        <div key={key} style={rowStyle}>
          <span><Tag color={s.color} style={{ fontSize: 11, marginInlineEnd: 0 }}>{s.label}</Tag></span>
          <Text style={{ fontSize: 12.5 }}>{s.meaning}</Text>
        </div>
      ))}
      <Text type="secondary" style={{ display: 'block', fontSize: 12, margin: '6px 0 10px' }}>
        The number at the top right of a card is the days in the current stage (red after 10). The bar under a card shows the steps of the stage: in stage, invited or booked, results in, decision.
      </Text>
      <Text type="secondary" strong style={headStyle}>Stages (columns, left to right)</Text>
      {stages.map((st) => (
        <div key={st.stage_key} style={rowStyle}>
          <Text strong style={{ fontSize: 12.5 }}>
            {st.label}{st.is_optional ? <Text type="secondary" style={{ fontSize: 11 }}> (optional)</Text> : null}
          </Text>
          <Text style={{ fontSize: 12.5 }}>{STAGE_DESCRIPTIONS[st.stage_key] || '—'}</Text>
        </div>
      ))}
    </div>
  );
  return (
    <Popover content={content} title="What do these mean?" trigger="click" placement="bottomRight">
      <Button icon={<QuestionCircleOutlined />} data-testid="board-legend-button">What do these mean?</Button>
    </Popover>
  );
}
