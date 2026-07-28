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

const { Title, Text, Paragraph } = Typography;
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
  const [hr, setHr] = useState({ notice: '', currentCtc: '', expectedCtc: '', relocation: '', strengths: '' });

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
        skills: skills.filter((s) => s.label.trim()).map((s) => ({ label: s.label, rating: s.rating || null, remark: s.remark })),
        communication: communication || null,
        attitude: attitude || null,
        final_rating: finalRating || null,
        recommendation,
        comments,
        recording_url: recordingUrl,
        ...(isHr ? {
          hr_notice_period: hr.notice,
          hr_current_ctc: hr.currentCtc,
          hr_expected_ctc: hr.expectedCtc,
          hr_relocation: hr.relocation,
          hr_strengths: hr.strengths,
        } : {}),
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
    return <Centered><Spin size="large" tip="Loading scorecard…" /></Centered>;
  }

  if (done === 'submitted' || view?.state === 'submitted') {
    return (
      <Centered>
        <Result status="success" title="Feedback submitted"
          subTitle="Thank you. This scorecard link is now closed." />
      </Centered>
    );
  }
  if (done === 'no_show') {
    return (
      <Centered>
        <Result status="info" title="Recorded — interview did not take place"
          subTitle="Thanks for letting us know. The recruiter will follow up. No scorecard is needed." />
      </Centered>
    );
  }
  if (view?.state === 'expired') {
    return (
      <Centered>
        <Result status="warning" title="This scorecard link has expired"
          subTitle="Please contact the recruitment team if you still need to submit feedback." />
      </Centered>
    );
  }
  if (view?.state === 'no_show') {
    return (
      <Centered>
        <Result status="info" title="This interview was marked as not held"
          subTitle="No scorecard can be submitted for it." />
      </Centered>
    );
  }
  if (error && !view) {
    return <Centered><Result status="error" title="Link unavailable" subTitle={error} /></Centered>;
  }

  return (
    <Centered wide>
      <Card style={{ width: '100%', maxWidth: 620 }}>
        <Title level={4} style={{ marginBottom: 4 }}>Interviewer scorecard</Title>
        <Text type="secondary">Interview Evaluation Format · no login needed</Text>
        <Divider style={{ margin: '14px 0' }} />

        {/* Pre-filled read-only context */}
        <Space direction="vertical" size={2} style={{ width: '100%', marginBottom: 12 }}>
          <Text><strong>Candidate:</strong> {ctx.candidate_name || '—'}</Text>
          <Text><strong>Position:</strong> {ctx.position || '—'}</Text>
          <Text><strong>Round:</strong> {ctx.stage_label || ctx.stage_key || '—'}</Text>
          {ctx.interviewer_name ? <Text><strong>Interviewer:</strong> {ctx.interviewer_name}</Text> : null}
        </Space>

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
            {/* One skill (schema supports more) */}
            {skills.map((s, i) => (
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

            <RatingRow label="Communication" value={communication} onChange={setCommunication} />
            <RatingRow label="Attitude" value={attitude} onChange={setAttitude} />
            <RatingRow label="Final rating" required value={finalRating} onChange={setFinalRating} />

            {isHr && (
              <>
                <Divider style={{ margin: '4px 0' }} orientation="left" plain>HR details</Divider>
                <Input size="small" placeholder="Notice period" value={hr.notice} onChange={(e) => setHr({ ...hr, notice: e.target.value })} />
                <Space style={{ width: '100%' }}>
                  <Input size="small" placeholder="Current CTC" value={hr.currentCtc} onChange={(e) => setHr({ ...hr, currentCtc: e.target.value })} />
                  <Input size="small" placeholder="Expected CTC" value={hr.expectedCtc} onChange={(e) => setHr({ ...hr, expectedCtc: e.target.value })} />
                </Space>
                <Input size="small" placeholder="Relocation" value={hr.relocation} onChange={(e) => setHr({ ...hr, relocation: e.target.value })} />
                <TextArea rows={2} placeholder="Strengths" value={hr.strengths} onChange={(e) => setHr({ ...hr, strengths: e.target.value })} />
              </>
            )}

            <div>
              <Text strong style={{ fontSize: 12.5 }}>Status <Text type="danger">*</Text></Text>
              <Radio.Group value={recommendation} onChange={(e) => setRecommendation(e.target.value)}
                optionType="button" buttonStyle="solid" style={{ display: 'block', marginTop: 4 }}
                options={[{ value: 'approve', label: '✓ Shortlisted' }, { value: 'hold', label: '◔ On Hold' }, { value: 'reject', label: '✕ Rejected' }]} />
            </div>

            <TextArea rows={2} placeholder="Final comments" value={comments} onChange={(e) => setComments(e.target.value)} />
            <Input size="small" placeholder="Interview recording link (optional)" value={recordingUrl} onChange={(e) => setRecordingUrl(e.target.value)} />

            <Button type="primary" block loading={submitting} onClick={submit}>Submit feedback</Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              This link works once. After you submit, it closes and cannot be reopened.
            </Text>
          </Space>
        )}
      </Card>
    </Centered>
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

function Centered({ children, wide }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: wide ? 640 : 480 }}>{children}</div>
    </div>
  );
}
