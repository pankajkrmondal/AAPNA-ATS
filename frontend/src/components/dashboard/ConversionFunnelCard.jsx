/**
 * ConversionFunnelCard — the pipeline funnel upgraded with stage-to-stage conversion %,
 * a headline sourced→hired rate, and time-to-hire when derivable from the Zeko pipeline.
 * Keeps the gradient-bar look the dashboard already used.
 */
import { useMemo } from 'react';
import { Card, Typography, Tooltip } from 'antd';
import { ArrowDownOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { conversionStages, medianTimeToHire } from '../../utils/dashboardAggregations';
import MetricInfo from '../common/MetricInfo';

const { Title, Text } = Typography;

const STAGE_GRADIENTS = {
  sourced: 'linear-gradient(90deg, #0284c7 0%, #0ea5e9 100%)',
  aiScreened: 'linear-gradient(90deg, #7a922e 0%, #92a63c 100%)',
  shortlisted: 'linear-gradient(90deg, #d97706 0%, #f59e0b 100%)',
  hired: 'linear-gradient(90deg, #16a34a 0%, #22c55e 100%)',
};

const STAGE_DESC = {
  sourced: 'Every candidate sourced into the system.',
  aiScreened: 'Profiles analysed and scored by the AI screening engine.',
  shortlisted: 'Advanced to the shortlist / interview pipeline.',
  hired: 'Accepted an offer or joined.',
};

export default function ConversionFunnelCard({ funnel = {}, pipeline = [], loading = false }) {
  const stages = useMemo(() => conversionStages(funnel), [funnel]);
  const overall = stages.length ? stages[stages.length - 1].ofTop : 0;
  const tth = useMemo(() => medianTimeToHire(pipeline), [pipeline]);
  const maxVal = Math.max(1, ...stages.map((s) => s.value));

  return (
    <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }}>
      <div className="dash-card-head">
        <div>
          {/* The one widget on the page with a definition in the registry that it never
              rendered — so the only card whose title you could not hover for an
              explanation was the one describing the whole hiring process. */}
          <Title level={5} style={{ margin: 0 }}>
            Conversion Funnel <MetricInfo metric="conversionFunnel" size={12} />
          </Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>Sourced → hired conversion</Text>
        </div>
        <div className="dash-funnel-metrics">
          <Tooltip title={`${overall}% of everyone sourced has gone all the way through to hired.`}>
            <div className="dash-card-metric">
              <span className="dash-card-metric__num">{overall}%</span>
              <span className="dash-card-metric__cap">overall</span>
            </div>
          </Tooltip>
          {tth !== null && (
            <Tooltip title={`Half of your hires took less than ${tth} day${tth === 1 ? '' : 's'} from being shortlisted to joining, and half took longer. Measured only on candidates who have completed the journey.`}>
              <div className="dash-card-metric">
                <span className="dash-card-metric__num"><ClockCircleOutlined /> {tth}d</span>
                <span className="dash-card-metric__cap">time-to-hire</span>
              </div>
            </Tooltip>
          )}
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {stages.map((stage, idx) => {
          const pct = Math.round((stage.value / maxVal) * 100);
          return (
            <div key={stage.key}>
              <Tooltip
                title={(
                  <span>
                    {STAGE_DESC[stage.key]}
                    <br />
                    <strong>{stage.value.toLocaleString()}</strong> candidate{stage.value === 1 ? '' : 's'}
                    {idx > 0 && ` — ${stage.ofTop}% of everyone sourced`}
                  </span>
                )}
                placement="top"
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: 500 }}>{stage.label}</Text>
                    <Text style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--mono)' }}>
                      {stage.value.toLocaleString()}
                    </Text>
                  </div>
                  <div
                    className={loading ? 'shimmer' : ''}
                    style={{
                      height: 14,
                      borderRadius: 999,
                      background: 'var(--gold-subtle)',
                      overflow: 'hidden',
                      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.08)',
                    }}
                  >
                    {!loading && (
                      <div
                        style={{
                          width: `${pct}%`,
                          minWidth: stage.value > 0 ? 28 : 0,
                          height: '100%',
                          borderRadius: 999,
                          background: STAGE_GRADIENTS[stage.key],
                          transition: 'width 0.9s var(--ease-out-quint)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          paddingRight: 8,
                        }}
                      >
                        {stage.value > 0 && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
                            {stage.ofTop}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Tooltip>

              {/* Step conversion between this stage and the next */}
              {idx < stages.length - 1 && (
                <Tooltip
                  title={`${stages[idx + 1].stepPct}% of the ${stage.value.toLocaleString()} at ${stage.label} moved on to ${stages[idx + 1].label}. The rest are still at this stage or did not progress.`}
                  placement="right"
                >
                  <div className="dash-funnel-step">
                    <ArrowDownOutlined />
                    <span>{stages[idx + 1].stepPct}% advance</span>
                  </div>
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}