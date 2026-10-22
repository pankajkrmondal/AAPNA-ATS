/**
 * MoveStageModal — the confirmation popup every stage move goes through
 * (flexible stages, docs/phase3/pipeline/FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md C8).
 *
 * Shared by the card's "Move to…" menu, the drawer's "Move to…" button and the
 * board's drag and drop, so all three say exactly the same thing. Nothing moves
 * until "Yes, move" is clicked, and Cancel holds the focus, so an Enter pressed
 * by accident cancels rather than confirms (D5). No reason is asked (D6) —
 * except to RE-DO a passed stage (L02-C), where a reason is required.
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Space } from 'antd';
import {
  ArrowLeftOutlined, ArrowRightOutlined, AuditOutlined, CheckCircleOutlined, MailOutlined, MinusCircleOutlined, SwapOutlined,
} from '@ant-design/icons';
import { describeMove } from './stageMove';

const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

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
 * @param {(reason: string|null) => void} props.onConfirm - reason only for a re-do
 */
export default function MoveStageModal({ open, candidate, fromStage, toStage, stages, passedStageKeys = [], loading = false, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open, toStage?.stage_key]);
  if (!fromStage || !toStage) return null;
  // L02-C: moving into a passed stage re-does it.
  const redo = passedStageKeys.includes(toStage.stage_key);
  const move = describeMove({ stages, fromKey: fromStage.stage_key, toKey: toStage.stage_key, passedStageKeys });
  const backward = move.direction === 'backward';
  const fromLabel = fromStage.label || fromStage.stage_key;
  const toLabel = toStage.label || toStage.stage_key;
  const fromPassed = passedStageKeys.includes(fromStage.stage_key);
  const dir = backward ? 'back' : 'fwd';
  const skips = move.skippedCount > 0 ? ` · skips ${move.skippedCount} stage${move.skippedCount === 1 ? '' : 's'}` : '';

  return (
    <Modal
      open={open}
      className="cp-move-modal"
      title={(
        <div className="cp-move-modal__head">
          <span className={`cp-move-modal__icon cp-move-modal__icon--${dir}`}><SwapOutlined /></span>
          <div>
            <div className="cp-move-modal__title">{redo ? `Re-do ${toStage.label || toStage.stage_key}?` : 'Move candidate?'}</div>
            <div className="cp-move-modal__sub">Review the change before you confirm.</div>
          </div>
        </div>
      )}
      onCancel={loading ? undefined : onCancel}
      maskClosable={!loading}
      closable={!loading}
      destroyOnHidden
      width={520}
      footer={(
        <Space>
          {/* autoFocus: Cancel is the default button (C8). */}
          <Button autoFocus onClick={onCancel} disabled={loading} data-testid="move-cancel">Cancel</Button>
          <Button
            type="primary"
            danger={backward && !redo}
            loading={loading}
            disabled={redo && !reason.trim()}
            onClick={() => onConfirm(redo ? reason.trim() : null)}
            data-testid="move-confirm"
          >
            {redo ? 'Re-do stage' : 'Yes, move'}
          </Button>
        </Space>
      )}
    >
      <div data-testid="move-stage-modal">
        <div className="cp-move-modal__who">
          <span className="cp-move-modal__avatar">{initials(candidate?.candidate_name)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="cp-move-modal__name">{candidate?.candidate_name || 'Unnamed candidate'}</div>
            {candidate?.position && <div className="cp-move-modal__pos">{candidate.position}</div>}
          </div>
        </div>

        {/* The route: where the candidate is → where they go, direction in the middle. */}
        <div className={`cp-move-route cp-move-route--${dir}`}>
          <div className="cp-move-route__stage cp-move-route__stage--from">
            <span className="cp-move-route__cap">From</span>
            <span className="cp-move-route__label" data-testid="move-from">{fromLabel}</span>
          </div>
          <div className="cp-move-route__arrow" aria-hidden="true">{backward ? <ArrowLeftOutlined /> : <ArrowRightOutlined />}</div>
          <div className="cp-move-route__stage cp-move-route__stage--to">
            <span className="cp-move-route__cap">To</span>
            <span className="cp-move-route__label" data-testid="move-to">{toLabel}</span>
          </div>
        </div>
        <div className="cp-move-route__dir-wrap">
          <span className={`cp-move-route__dir cp-move-route__dir--${dir}`} data-testid="move-direction">
            {backward ? <ArrowLeftOutlined /> : <ArrowRightOutlined />}
            {backward ? 'BACKWARD' : 'FORWARD'}{skips}
          </span>
        </div>

        <ul className="cp-move-notes">
          {fromPassed
            ? <li><CheckCircleOutlined className="cp-move-notes__icon cp-move-notes__icon--ok" /><span><strong>{fromLabel}</strong> stays marked "Passed".</span></li>
            : <li><MinusCircleOutlined className="cp-move-notes__icon cp-move-notes__icon--warn" /><span><strong>{fromLabel}</strong> will be marked "Skipped". You can move back to it later.</span></li>}
          <li><MailOutlined className="cp-move-notes__icon" /><span>No email is sent to the candidate or the vendor.</span></li>
          <li><AuditOutlined className="cp-move-notes__icon" /><span>This move is recorded under your name.</span></li>
        </ul>

        {redo && (
          <div style={{ marginTop: 12 }} data-testid="move-redo">
            <Alert
              type="warning"
              showIcon
              message={`${candidate?.candidate_name || 'The candidate'} already passed ${toLabel}. Moving back starts it again.`}
              description="The earlier interview, scorecards and results stay as an earlier attempt and do not count for the new one. Approving it brings the candidate back here."
            />
            <div style={{ marginTop: 10, fontWeight: 600, fontSize: 13 }}>
              Reason <span style={{ color: 'var(--danger, #b42318)' }}>*</span>
            </div>
            <Input.TextArea
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Interviewer changed; panel wants a second technical round"
              style={{ marginTop: 4 }}
              data-testid="move-redo-reason"
            />
          </div>
        )}

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
