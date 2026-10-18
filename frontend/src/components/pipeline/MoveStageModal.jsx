/**
 * MoveStageModal — the confirmation popup every stage move goes through
 * (flexible stages, docs/phase3/pipeline/FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md C8).
 *
 * Shared by the card's "Move to…" menu, the drawer's "Move to…" button and the
 * board's drag and drop, so all three say exactly the same thing. Nothing moves
 * until "Yes, move" is clicked, and Cancel holds the focus, so an Enter pressed
 * by accident cancels rather than confirms (D5). No reason is asked (D6).
 */
import { Alert, Button, Modal, Space, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { describeMove } from './stageMove';

const { Text } = Typography;

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {{ candidate_name?: string, position?: string }|null} props.candidate
 * @param {object|null} props.fromStage - { stage_key, label }
 * @param {object|null} props.toStage - { stage_key, label }
 * @param {object[]} props.stages - board stages in order ({ stage_key, label })
 * @param {string[]} [props.passedStageKeys] - stages the candidate already passed
 * @param {boolean} [props.loading]
 * @param {() => void} props.onCancel
 * @param {() => void} props.onConfirm
 */
export default function MoveStageModal({ open, candidate, fromStage, toStage, stages, passedStageKeys = [], loading = false, onCancel, onConfirm }) {
  if (!fromStage || !toStage) return null;
  const move = describeMove({ stages, fromKey: fromStage.stage_key, toKey: toStage.stage_key, passedStageKeys });
  const backward = move.direction === 'backward';
  const fromLabel = fromStage.label || fromStage.stage_key;
  const toLabel = toStage.label || toStage.stage_key;
  const fromPassed = passedStageKeys.includes(fromStage.stage_key);

  return (
    <Modal
      open={open}
      title="Move candidate?"
      onCancel={loading ? undefined : onCancel}
      maskClosable={!loading}
      closable={!loading}
      destroyOnHidden
      width={520}
      footer={(
        <Space>
          {/* autoFocus: Cancel is the default button (C8). */}
          <Button autoFocus onClick={onCancel} disabled={loading} data-testid="move-cancel">Cancel</Button>
          <Button type="primary" danger={backward} loading={loading} onClick={onConfirm} data-testid="move-confirm">
            Yes, move
          </Button>
        </Space>
      )}
    >
      <div data-testid="move-stage-modal">
        <Text strong>{candidate?.candidate_name || 'Unnamed candidate'}</Text>
        {candidate?.position && <Text type="secondary"> · {candidate.position}</Text>}

        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', margin: '14px 0', alignItems: 'center' }}>
          <Text type="secondary">From:</Text>
          <Text data-testid="move-from">{fromLabel}</Text>
          <Text type="secondary">To:</Text>
          <Space size={8} wrap>
            <Text strong data-testid="move-to">{toLabel}</Text>
            <Tag
              color={backward ? 'orange' : 'blue'}
              icon={backward ? <ArrowLeftOutlined /> : <ArrowRightOutlined />}
              data-testid="move-direction"
              style={{ marginInlineEnd: 0 }}
            >
              {backward ? 'BACKWARD' : 'FORWARD'}
              {move.skippedCount > 0 ? ` (skips ${move.skippedCount} stage${move.skippedCount === 1 ? '' : 's'})` : ''}
            </Tag>
          </Space>
        </div>

        <ul style={{ paddingInlineStart: 18, margin: 0 }}>
          {fromPassed
            ? <li>{fromLabel} stays marked "Passed".</li>
            : <li>{fromLabel} will be marked "Skipped". You can move back to it later.</li>}
          <li>No email is sent to the candidate or the vendor.</li>
          <li>This move is recorded under your name.</li>
        </ul>

        {move.bigJump && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            data-testid="move-bigjump-warning"
            message={`This moves the candidate to ${toLabel} without the interview rounds in between.`}
          />
        )}
      </div>
    </Modal>
  );
}
