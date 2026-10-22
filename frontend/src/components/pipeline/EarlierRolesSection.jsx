/**
 * "Earlier roles for this candidate" in the pipeline drawer (L02-A, design
 * approved 22 Oct 2026).
 *
 * Every OTHER journey of the candidate, closed ones included, read-only:
 * role and outcome, each round's results (Zeko scores and report, Evalground
 * result and report, interview scorecards and recordings) and the stage
 * history. Nothing is copied between journeys, so a moved candidate's old
 * results are always here, and "Open full record" opens that journey itself.
 */
import { useQuery } from '@tanstack/react-query';
import { Collapse, Tag, Typography, Button, Space, Empty, Spin } from 'antd';
import pipelineService from '../../services/pipeline';
import { fmtDate } from '../../utils/dateFormat';

const { Text } = Typography;

const fmtScore = (v) => (v == null || v === '' ? '–' : String(v));

export function roundSummary(r) {
  if (r.kind === 'zeko') {
    const parts = [
      r.scores?.interview != null && `Interview ${fmtScore(r.scores.interview)}`,
      r.scores?.coding != null && `Coding ${fmtScore(r.scores.coding)}`,
      r.scores?.communication != null && `Communication ${fmtScore(r.scores.communication)}`,
    ].filter(Boolean);
    return parts.join(' · ') || 'Score recorded';
  }
  if (r.kind === 'assessment') {
    return [r.result, r.percentage != null ? `${r.percentage}%` : null].filter(Boolean).join(' · ') || 'Result recorded';
  }
  return (r.cards || [])
    .map((c) => [c.interviewer, c.avg_score != null ? `avg ${Number(c.avg_score).toFixed(1)} / 5` : null, c.recommendation]
      .filter(Boolean).join(' · '))
    .join('; ') || 'Scorecard submitted';
}

function JourneyCard({ journey, onOpenJourney }) {
  const outcome = journey.final_outcome
    ? <Tag color={journey.final_outcome === 'moved_to_other_jd' ? 'blue' : 'purple'} style={{ margin: 0 }}>{journey.final_outcome_label || journey.final_outcome}</Tag>
    : <Tag color="green" style={{ margin: 0 }}>Open · {journey.current_stage_label}</Tag>;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 10 }} data-testid="earlier-role-card">
      <div style={{ padding: '10px 14px', background: 'var(--ink-3)' }}>
        <Space wrap size={8}>
          <Text strong>{journey.role}{journey.mrf_id ? ` · MRF-${journey.mrf_id}` : ''}</Text>
          {outcome}
        </Space>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Shortlisted {fmtDate(journey.shortlisted_at) || '–'}
            {' · '}reached {journey.current_stage_label}
            {journey.closed_at ? ` · closed ${fmtDate(journey.closed_at)}` : ''}
          </Text>
        </div>
      </div>

      {journey.rounds?.length > 0 ? (
        <div style={{ padding: '4px 14px' }}>
          {journey.rounds.map((r) => (
            <div key={`${r.kind}-${r.stage_key}`} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <Text strong style={{ fontSize: 12.5, flex: '0 0 170px' }}>{r.label}</Text>
              <Text type="secondary" style={{ fontSize: 12.5, flex: '1 1 200px' }}>{roundSummary(r)}</Text>
              <Space size={10}>
                {r.report_link && <a href={r.report_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5 }}>Report</a>}
                {r.recording_url && <a href={r.recording_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5 }}>Recording</a>}
              </Space>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '8px 14px' }}><Text type="secondary" style={{ fontSize: 12.5 }}>No scores recorded on this role.</Text></div>
      )}

      {journey.events?.length > 0 && (
        <div style={{ padding: '8px 14px' }}>
          <Text strong style={{ fontSize: 12.5 }}>Stage history</Text>
          {journey.events.map((e, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>
              {fmtDate(e.created_at)} · {e.stage_label}
              {e.status_label ? ` · ${e.status_label}` : ''}
              {e.notes ? ` — ${e.notes}` : ''}
            </div>
          ))}
        </div>
      )}

      {onOpenJourney && (
        <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)' }}>
          <Button size="small" onClick={() => onOpenJourney(Number(journey.pipeline_id))} data-testid="earlier-role-open">
            Open full record
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The candidate's other journeys (one request, shared by the drawer header's
 * "Moved from / to" links and this section).
 * @param {number|string|null} pipelineId
 */
export function useRelatedJourneys(pipelineId) {
  return useQuery({
    queryKey: ['pipeline-related', String(pipelineId)],
    queryFn: () => pipelineService.getRelatedJourneys(pipelineId),
    select: (res) => res?.data?.data ?? res?.data ?? { journeys: [] },
    enabled: Boolean(pipelineId),
  });
}

/**
 * @param {{ pipelineId: number|string, movedFrom: boolean, onOpenJourney?: (id: number) => void }} props
 *   movedFrom: this journey came from a move, so the section starts expanded.
 */
export default function EarlierRolesSection({ pipelineId, movedFrom, onOpenJourney }) {
  const query = useRelatedJourneys(pipelineId);
  const journeys = query.data?.journeys || [];
  if (!query.isLoading && journeys.length === 0) return null;

  return (
    <Collapse
      id="earlier-roles"
      size="small"
      style={{ marginBottom: 12 }}
      defaultActiveKey={movedFrom ? ['earlier'] : []}
      data-testid="earlier-roles"
      items={[{
        key: 'earlier',
        label: (
          <Space size={8}>
            <Text strong>Earlier roles for this candidate</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{query.isLoading ? '' : `${journeys.length} · read-only`}</Text>
          </Space>
        ),
        children: query.isLoading
          ? <div style={{ textAlign: 'center', padding: 12 }}><Spin size="small" /></div>
          : journeys.length === 0
            ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No other roles" />
            : journeys.map((j) => <JourneyCard key={j.pipeline_id} journey={j} onOpenJourney={onOpenJourney} />),
      }]}
    />
  );
}
