/**
 * PipelineScoresSection — every score the pipeline holds for a candidate, per
 * MRF and round, read-only (N29). Search Candidate showed only the candidate
 * record's own score columns, so interview scorecards and per-round Zeko and
 * Evalground results never reached it. Read from the same sources as the
 * pipeline drawer, so the two always agree.
 *
 * Staff only: the endpoint refuses vendors, so the parent renders this only
 * for staff. With canChangeJd, each open JD card offers Change JD (G3).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Space, Spin, Tag, Typography } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import candidateService from '../../services/candidateService';
import ChangeJdModal from '../screening/ChangeJdModal';

const { Text } = Typography;

const RECOMMENDATION_COLOR = { approve: 'green', reject: 'red' };

function RoundLine({ round }) {
  if (round.kind === 'zeko') {
    const parts = [
      round.scores.interview != null && `Interview ${round.scores.interview}`,
      round.scores.coding != null && `Coding ${round.scores.coding}`,
      round.scores.communication != null && `Communication ${round.scores.communication}`,
    ].filter(Boolean);
    return (
      <Space size={8} wrap>
        <Text style={{ fontSize: 13 }}>{parts.join(' · ') || 'Synced — no numeric scores'}</Text>
        {round.report_link && (
          <a href={round.report_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5 }}>
            <LinkOutlined /> Zeko report
          </a>
        )}
      </Space>
    );
  }
  if (round.kind === 'assessment') {
    const parts = [
      round.result,
      round.percentage != null && `${round.percentage}%`,
      round.marks != null && `${round.marks} marks`,
    ].filter(Boolean);
    return (
      <Space size={8} wrap>
        <Text style={{ fontSize: 13 }}>{parts.join(' · ') || 'Result imported'}</Text>
        {round.report_link && (
          <a href={round.report_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5 }}>
            <LinkOutlined /> Evalground report
          </a>
        )}
      </Space>
    );
  }
  return (
    <Space direction="vertical" size={2}>
      {round.cards.map((card, i) => (
        <Space key={`${card.interviewer}-${i}`} size={8} wrap>
          <Text type="secondary" style={{ fontSize: 12.5 }}>{card.interviewer || 'Interviewer'}</Text>
          <Text strong style={{ fontSize: 13 }}>{card.avg_score != null ? `${card.avg_score} / 5` : 'No average'}</Text>
          {card.recommendation && (
            <Tag color={RECOMMENDATION_COLOR[card.recommendation] || 'orange'} style={{ margin: 0, fontSize: 11.5 }}>
              {card.recommendation}
            </Tag>
          )}
        </Space>
      ))}
    </Space>
  );
}

export default function PipelineScoresSection({ cvId, canChangeJd = false }) {
  // G3: the JD card whose JD is being changed.
  const [changeJdShortlistId, setChangeJdShortlistId] = useState(null);
  const { data: journeys = [], isLoading, isError } = useQuery({
    queryKey: ['candidate-pipeline-scores', String(cvId)],
    queryFn: async () => {
      const res = await candidateService.getPipelineScores(cvId);
      return res.data?.data || res.data || [];
    },
    enabled: !!cvId,
  });

  if (isLoading) return <Spin size="small" />;
  if (isError) return <Text type="secondary" style={{ fontSize: 13 }}>Pipeline scores could not be loaded.</Text>;
  if (journeys.length === 0) return <Text type="secondary" style={{ fontSize: 13 }}>Not in the pipeline for any MRF.</Text>;

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {journeys.map((j) => (
        <Card
          key={j.pipeline_id}
          size="small"
          title={<Text style={{ fontSize: 13 }}>{j.role}{j.mrf_id ? ` · MRF-${j.mrf_id}` : ''}</Text>}
          extra={(
            <Space size={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>{j.final_outcome ? `Closed: ${j.final_outcome}` : `At ${j.current_stage_label}`}</Text>
              {canChangeJd && j.shortlist_id && !j.final_outcome && (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setChangeJdShortlistId(j.shortlist_id)} data-testid="change-jd-link">
                  {j.mrf_id ? 'Change JD' : 'Set JD'}
                </Button>
              )}
            </Space>
          )}
        >
          {j.rounds.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 13 }}>No scores recorded yet.</Text>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, max-content) 1fr', gap: '6px 16px', alignItems: 'start' }}>
              {j.rounds.map((r) => (
                <div key={r.stage_key} style={{ display: 'contents' }}>
                  <Text type="secondary" style={{ fontSize: 12.5 }}>{r.label}</Text>
                  <RoundLine round={r} />
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}
      {canChangeJd && (
        <ChangeJdModal
          open={Boolean(changeJdShortlistId)}
          shortlistId={changeJdShortlistId}
          onClose={() => setChangeJdShortlistId(null)}
        />
      )}
    </Space>
  );
}
