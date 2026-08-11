/**
 * InterviewScorecard.jsx — PUBLIC (no-login) interviewer scorecard page, opened
 * from an emailed tokenized link (/scorecard/:token). Mirrors the prototype's
 * "Interviewer scorecard — Interview Evaluation Format" but wired to the real
 * backend, and gated: it first asks "did the interview take place?" — only a
 * "Yes, we met" reveals the form; "No" records a no-show and closes the link.
 * The link is single-use and expires after one submit.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Button, Typography, Alert, Spin, Rate, Input, Radio, Space, Result, Divider, message,
} from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import scorecardService from '../services/scorecardService';
import PublicPageShell, { BRAND } from '../components/common/PublicPageShell';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

export default function InterviewScorecard() {
  const { token } = useParams();

  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(null);      // { state, occurrence_status, card, context }
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState('');         // '' | 'submitted' | 'no_show'

  // Gate + form state
  const [gate, setGate] = useState(null);       // null | 'held' — local echo before form shows
  const [skills, setSkills] = useState([{ label: '', rating: 0, remark: '' }]);
  const [communication, setCommunication] = useState(0);
  const [attitude, setAttitude] = useState(0);
  const [finalRating, setFinalRating] = useState(0);
  const [recommendation, setRecommendation] = useState('approve');
  const [comments, setComments] = useState('');
  const [recordingUrl, setRecordingUrl] = useState('');
  // Keyed by the API/DB field names so submit needs no translation layer.
  const [hr, setHr] = useState({});
  const setHrField = (field, value) => setHr((prev) => ({ ...prev, [field]: value }));

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await scorecardService.getScorecard(token);
      // API envelope is { status, message, data: <viewModel> }; unwrap to the view model.
      const data = res?.data?.data ?? res?.data ?? res;
      setView(data);
      // Seed the skill row from any pre-seeded skills on the card.
      const seeded = data?.card?.rpa_interview_scorecard_skill;
      if (Array.isArray(seeded) && seeded.length) {
        setSkills(seeded.map((s) => ({ label: s.skill_label || '', rating: Number(s.rating) || 0, remark: s.remark || '' })));
      }
      if (data?.state === 'submitted') setDone('submitted');
    } catch (err) {
      setError(err?.message || 'This scorecard link is invalid or could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); /* eslint-disable-next-line */ }, [token]);

  const ctx = view?.context || {};
  const isHr = ctx.card_type === 'hr';
  // The form is shown once the interview is confirmed held — either it already
  // was (server state) or the interviewer just answered the gate.
  const showForm = useMemo(
    () => view?.state === 'open' && (view?.occurrence_status === 'held' || gate === 'held'),
    [view, gate],
  );
  const showGate = view?.state === 'open' && !showForm;

  const answerGate = async (outcome) => {
    setSubmitting(true);
    setError('');
    try {
      await scorecardService.confirmOccurrence(token, outcome === 'held' ? { outcome: 'held' } : { outcome: 'no_show', party: 'candidate' });
      if (outcome === 'held') {
        setGate('held');
        message.success('Thanks — please complete your scorecard below.');
      } else {
        setDone('no_show');
      }
    } catch (err) {
      setError(err?.message || 'Could not record your answer. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    if (!finalRating) {
      message.warning('Please give a final rating before submitting.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        // The HR round scores the conversation, not a skill matrix — its card
        // has no skill rows at all (per the Interview Evaluation Format).
        skills: isHr ? [] : skills.filter((s) => s.label.trim()).map((s) => ({ label: s.label, rating: s.rating || null, remark: s.remark })),
        communication: communication || null,
        attitude: attitude || null,
        final_rating: finalRating || null,
        recommendation,
        comments,
        recording_url: recordingUrl,
        ...(isHr ? hr : {}),
      };
      await scorecardService.submit(token, payload);
      setDone('submitted');
    } catch (err) {
      setError(err?.message || 'Could not submit your feedback. The link may have expired.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateSkill = (i, patch) => setSkills((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  // ── Render states ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <PublicPageShell title="Interviewer scorecard" subtitle="Loading this interview…">
        <div style={{ textAlign: 'center', padding: '32px 0' }}><Spin size="large" /></div>
      </PublicPageShell>
    );
  }

  if (done === 'submitted' || view?.state === 'submitted') {
    return (
      <PublicPageShell title="Thank you" subtitle="Your feedback has reached the recruitment team.">
        <Result status="success" title="Feedback submitted"
          subTitle="Thank you. This scorecard link is now closed." />
      </PublicPageShell>
    );
  }
  if (done === 'no_show') {
    return (
      <PublicPageShell title="Thanks for letting us know" subtitle="We have recorded that this interview did not take place.">
        <Result status="info" title="Recorded — interview did not take place"
          subTitle="The recruiter will follow up. No scorecard is needed." />
      </PublicPageShell>
    );
  }
  if (view?.state === 'expired') {
    return (
      <PublicPageShell title="This link has expired" subtitle="Feedback can no longer be submitted here.">
        <Result status="warning" title="This scorecard link has expired"
          subTitle="Please contact the recruitment team if you still need to submit feedback." />
      </PublicPageShell>
    );
  }
  if (view?.state === 'no_show') {
    return (
      <PublicPageShell title="Interview not held" subtitle="This round was marked as not having taken place.">
        <Result status="info" title="This interview was marked as not held"
          subTitle="No scorecard can be submitted for it." />
      </PublicPageShell>
    );
  }
  if (error && !view) {
    return (
      <PublicPageShell title="Link unavailable" subtitle="We could not open this scorecard.">
        <Result status="error" title="Link unavailable" subTitle={error} />
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell
      title="Interviewer scorecard"
      subtitle={`Share your assessment of ${ctx.candidate_name || 'the candidate'} for the ${ctx.stage_label || ctx.stage_key || 'interview'} round.`}
      maxWidth={720}
    >
      {/* Pre-filled read-only context */}
      <div
        style={{
          background: BRAND.page,
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 18,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 28px',
        }}
      >
        <ContextItem label="CANDIDATE" value={ctx.candidate_name} />
        <ContextItem label="POSITION" value={ctx.position} />
        <ContextItem label="ROUND" value={ctx.stage_label || ctx.stage_key} />
        {ctx.interviewer_name ? <ContextItem label="INTERVIEWER" value={ctx.interviewer_name} /> : null}
      </div>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}

        {showGate && (
          <Card size="small" style={{ background: '#fffbe6', borderColor: '#ffe58f' }}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Text strong><WarningOutlined /> Did this interview actually take place?</Text>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Please confirm before scoring. If the candidate did not join, we won’t ask you to fill a scorecard.
              </Paragraph>
              <Space>
                <Button type="primary" loading={submitting} onClick={() => answerGate('held')}>Yes, we met — score now</Button>
                <Button danger loading={submitting} onClick={() => answerGate('no_show')}>No — it didn’t happen</Button>
              </Space>
            </Space>
          </Card>
        )}

        {showForm && (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            {/* The technical card rates skills; the HR card doesn't have them. */}
            {!isHr && skills.map((s, i) => (
              <div key={i}>
                <Text strong style={{ fontSize: 13 }}>Skill <Text type="danger">*</Text></Text>
                <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 4 }} wrap>
                  <Input
                    size="small" placeholder="Skill (e.g. React, SQL)…" value={s.label}
                    onChange={(e) => updateSkill(i, { label: e.target.value })} style={{ width: 180 }}
                  />
                  <Space>
                    <Rate allowHalf value={s.rating} onChange={(v) => updateSkill(i, { rating: v })} />
                    <Input size="small" placeholder="Remark" value={s.remark}
                      onChange={(e) => updateSkill(i, { remark: e.target.value })} style={{ width: 150 }} />
                  </Space>
                </Space>
              </div>
            ))}

            {isHr && (
              <>
                <Divider style={{ margin: '4px 0' }} orientation="left" plain>Candidate background</Divider>
                <HrField label="Family background" rows={2} value={hr.hr_family_background} onChange={(v) => setHrField('hr_family_background', v)} />
                <HrField label="General / other" rows={2} value={hr.hr_general_other} onChange={(v) => setHrField('hr_general_other', v)} />
                <HrField label="Timings" maxLength={255} value={hr.hr_timings} onChange={(v) => setHrField('hr_timings', v)} />
              </>
            )}

            <RatingRow label="Communication" value={communication} onChange={setCommunication} />
            {isHr && (
              <HrField label="Communication comments" rows={2} value={hr.hr_communication_comments} onChange={(v) => setHrField('hr_communication_comments', v)} />
            )}
            <RatingRow label="Attitude" value={attitude} onChange={setAttitude} />
            {isHr && (
              <HrField label="Attitude comments" rows={2} value={hr.hr_attitude_comments} onChange={(v) => setHrField('hr_attitude_comments', v)} />
            )}

            {isHr && (
              <>
                <Divider style={{ margin: '4px 0' }} orientation="left" plain>Availability &amp; compensation</Divider>
                <HrField label="Relocation" maxLength={100} value={hr.hr_relocation} onChange={(v) => setHrField('hr_relocation', v)} />
                <HrField label="Notice period" maxLength={100} value={hr.hr_notice_period} onChange={(v) => setHrField('hr_notice_period', v)} />
                <HrField label="Current CTC" maxLength={100} value={hr.hr_current_ctc} onChange={(v) => setHrField('hr_current_ctc', v)} />
                <HrField label="Expected CTC" maxLength={100} value={hr.hr_expected_ctc} onChange={(v) => setHrField('hr_expected_ctc', v)} />

                <Divider style={{ margin: '4px 0' }} orientation="left" plain>Assessment</Divider>
                <HrField label="Strength" rows={2} value={hr.hr_strengths} onChange={(v) => setHrField('hr_strengths', v)} />
                <HrField label="Weakness" rows={2} value={hr.hr_weakness} onChange={(v) => setHrField('hr_weakness', v)} />
                <HrField label="Only negative" rows={2} value={hr.hr_only_negative} onChange={(v) => setHrField('hr_only_negative', v)} />
                <HrField label="Any other observation / request" rows={2} value={hr.hr_other_observation} onChange={(v) => setHrField('hr_other_observation', v)} />
                <HrField label="Final feedback" rows={2} value={hr.hr_final_feedback} onChange={(v) => setHrField('hr_final_feedback', v)} />
                <HrField label="Next step for recruitment team" rows={2} value={hr.hr_next_step} onChange={(v) => setHrField('hr_next_step', v)} />
                <Divider style={{ margin: '4px 0' }} />
              </>
            )}

            <RatingRow label="Final rating" required value={finalRating} onChange={setFinalRating} />

            <div>
              <Text strong style={{ fontSize: 12.5 }}>Status <Text type="danger">*</Text></Text>
              <Radio.Group value={recommendation} onChange={(e) => setRecommendation(e.target.value)}
                optionType="button" buttonStyle="solid" style={{ display: 'block', marginTop: 4 }}
                options={[{ value: 'approve', label: '✓ Shortlisted' }, { value: 'hold', label: '◔ On Hold' }, { value: 'reject', label: '✕ Rejected' }]} />
            </div>

            <TextArea rows={2} placeholder="Final comments" value={comments} onChange={(e) => setComments(e.target.value)} />
            <Input size="small" placeholder="Interview recording link (optional)" value={recordingUrl} onChange={(e) => setRecordingUrl(e.target.value)} />

            <Button
              type="primary"
              size="large"
              block
              loading={submitting}
              onClick={submit}
              style={{ background: BRAND.accent, borderColor: BRAND.accent, fontWeight: 600 }}
            >
              Submit feedback
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              This link works once. After you submit, it closes and cannot be reopened.
            </Text>
          </Space>
        )}
    </PublicPageShell>
  );
}

/** One labelled read-only fact in the context strip. */
function ContextItem({ label, value }) {
  return (
    <div>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', letterSpacing: 0.3 }}>{label}</Text>
      <Text strong style={{ fontSize: 13.5 }}>{value || '—'}</Text>
    </div>
  );
}

function RatingRow({ label, value, onChange, required }) {
  return (
    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
      <Text strong style={{ fontSize: 13 }}>{label} {required ? <Text type="danger">*</Text> : null}</Text>
      <Rate allowHalf value={value} onChange={onChange} />
    </Space>
  );
}

/**
 * A labelled free-text field on the HR card — single line, or `rows` for a
 * textarea. Single-line fields back VARCHAR columns, so `maxLength` stops the
 * interviewer from typing past what the column accepts (the server also caps).
 */
function HrField({ label, value, onChange, rows, maxLength }) {
  return (
    <div>
      <Text strong style={{ fontSize: 12.5 }}>{label}</Text>
      {rows ? (
        <TextArea rows={rows} value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ marginTop: 4 }} />
      ) : (
        <Input
          size="small"
          maxLength={maxLength}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          style={{ marginTop: 4 }}
        />
      )}
    </div>
  );
}

