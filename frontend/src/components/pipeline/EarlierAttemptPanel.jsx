/**
 * "Earlier attempt" for a re-done stage in the pipeline drawer (L02-C, design
 * approved 22 Oct 2026).
 *
 * When a passed stage is re-done, what the earlier attempt left behind stays
 * here as read-only history: its interview booking (real status kept), its
 * scorecards and recording, its Zeko job, its Evalground result, and the
 * re-do reason. None of it counts for the new attempt.
 */
import { Collapse, Space, Tag, Typography } from 'antd';
import { fmtDate, fmtDateTime } from '../../utils/dateFormat';

const { Text } = Typography;

const STATUS_WORD = { completed: 'held', no_show: 'no-show', scheduled: 'scheduled' };

/**
 * @param {{
 *   attempt: { attempt_started_at: string, bookings?: object[], zeko?: object[], assessment?: object[] } | null,
 *   scorecards?: object[],   // this stage's cards that belong to the earlier bookings
 *   redoEvent?: object|null, // the 'moved' event that started the re-do (reason, who, when)
 * }} props
 */
export default function EarlierAttemptPanel({ attempt, scorecards = [], redoEvent = null }) {
  if (!attempt) return null;
  const bookings = attempt.bookings || [];
  const zeko = attempt.zeko || [];
  const assessment = attempt.assessment || [];
  if (!bookings.length && !zeko.length && !assessment.length && !scorecards.length && !redoEvent) return null;

  const body = (
    <Space direction="vertical" size={6} style={{ width: '100%', fontSize: 12.5 }}>
      {bookings.map((b) => (
        <div key={`b-${b.id}`}>
          <Text strong style={{ fontSize: 12.5 }}>Interview</Text>{' '}
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {fmtDateTime(b.scheduled_start_at)}
            {b.interviewer_name || b.interviewer_email ? ` · ${b.interviewer_name || b.interviewer_email}` : ''}
            {` · ${STATUS_WORD[b.status] || b.status}`}
          </Text>
        </div>
      ))}
      {scorecards.map((c) => (
        <div key={`c-${c.scorecard_id}`}>
          <Text strong style={{ fontSize: 12.5 }}>Scorecard</Text>{' '}
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {[c.recipient_email || c.recipient_role, c.avg_score != null ? `avg ${Number(c.avg_score).toFixed(1)} / 5` : null, c.recommendation]
              .filter(Boolean).join(' · ')}
            {c.submitted_at ? ` · ${fmtDate(c.submitted_at)}` : ''}
          </Text>
          {c.recording_url && <> · <a href={c.recording_url} target="_blank" rel="noopener noreferrer">Recording</a></>}
        </div>
      ))}
      {zeko.map((z) => (
        <div key={`z-${z.zeko_job_id}-${z.created_at}`}>
          <Text strong style={{ fontSize: 12.5 }}>Zeko</Text>{' '}
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            job {z.zeko_job_id} · {z.status}{z.link_sent_at ? ` · link sent ${fmtDate(z.link_sent_at)}` : ''}
          </Text>
        </div>
      ))}
      {assessment.map((a) => (
        <div key={`a-${a.test_name}-${a.created_at}`}>
          <Text strong style={{ fontSize: 12.5 }}>Evalground</Text>{' '}
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {[a.test_name, a.overall_result, a.overall_percentage != null ? `${Number(a.overall_percentage)}%` : null].filter(Boolean).join(' · ')}
          </Text>
          {a.public_report_url && <> · <a href={a.public_report_url} target="_blank" rel="noopener noreferrer">Report</a></>}
        </div>
      ))}
      {redoEvent && (
        <div>
          <Text style={{ fontSize: 12.5 }}>
            Re-done {fmtDate(redoEvent.created_at)}
            {redoEvent.rpa_users?.username ? ` by ${redoEvent.rpa_users.username}` : ''}
            {redoEvent.reason_text ? `: "${redoEvent.reason_text}"` : ''}
          </Text>
        </div>
      )}
    </Space>
  );

  return (
    <Collapse
      size="small"
      style={{ marginTop: 10 }}
      data-testid="earlier-attempt"
      items={[{
        key: 'earlier',
        label: (
          <Space size={8}>
            <Text strong>Earlier attempt</Text>
            <Tag style={{ margin: 0 }}>before {fmtDate(attempt.attempt_started_at)}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>history · does not count for this attempt</Text>
          </Space>
        ),
        children: body,
      }]}
    />
  );
}
