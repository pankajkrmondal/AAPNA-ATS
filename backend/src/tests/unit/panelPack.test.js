import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildEarlierRoundsBlock, earlierRoundLines, hasEarlierResults } from '../../utils/panelPackBlock.js';
import {
  INTERVIEW_EMAIL_TEMPLATE_DEFAULTS, INTERVIEW_EMAIL_TEMPLATE_NAMES,
} from '../../services/interviewEmailTemplates.js';

const model = () => ({
  scorecards: [
    { stage_label: 'Technical Round 1', interviewer: 'old@example.com', recommendation: 'hold', avg_score: 2, earlier_attempt: true },
    { stage_label: 'Technical Round 1', interviewer: 'rahul@example.com', recommendation: 'approve', avg_score: 4.2, earlier_attempt: false },
  ],
  zeko: [{ round: 'HR screening', overall_score: 78 }, { round: 'Functional screening', overall_score: null }],
  assessments: [{ test_name: 'Java MCQ', result: 'Passed', overall_percentage: 64 }],
  recordings: [
    { stage_label: 'Technical Round 1', share_url: 'https://ats.example.com/api/recording-share/aaa' },
    { stage_label: 'HR Round', share_url: 'https://ats.example.com/api/recording-share/bbb' },
  ],
  round_notes: [],
});

describe('panel pack: what counts as an earlier result', () => {
  test('a first round with nothing on file has none', () => {
    assert.equal(hasEarlierResults({ scorecards: [], zeko: [], assessments: [], recordings: [], round_notes: [] }), false);
    assert.equal(hasEarlierResults({ scorecards: [], zeko: [{ overall_score: null }], assessments: [], recordings: [] }), false);
    assert.equal(hasEarlierResults(null), false);
  });

  test('any scorecard, AI score, assessment, recording or round note counts', () => {
    assert.equal(hasEarlierResults(model()), true);
    assert.equal(hasEarlierResults({ scorecards: [], zeko: [], assessments: [], recordings: [], round_notes: [{ value: 'x' }] }), true);
  });
});

describe('panel pack: one line per earlier round', () => {
  const lines = earlierRoundLines(model());

  test('earlier attempts are left out; the current one carries its recording', () => {
    const tech1 = lines.filter((l) => l.round === 'Technical Round 1');
    assert.equal(tech1.length, 1);
    assert.equal(tech1[0].text, 'rahul@example.com · recommends moving forward · average 4.2/5');
    assert.equal(tech1[0].recordingUrl, 'https://ats.example.com/api/recording-share/aaa');
  });

  test('AI screening and assessments get a line; an unscored AI round does not', () => {
    assert.ok(lines.some((l) => l.round === 'HR screening' && l.text === 'AI screening score 78'));
    assert.ok(!lines.some((l) => l.round === 'Functional screening'));
    assert.ok(lines.some((l) => l.round === 'Java MCQ' && l.text === 'Passed · 64%'));
  });

  test('a recording with no scorecard still gets its link', () => {
    assert.ok(lines.some((l) => l.round === 'HR Round' && l.recordingUrl.endsWith('/bbb')));
  });
});

describe('panel pack: the block in the invite', () => {
  test('lists the rounds and says what is attached', () => {
    const html = buildEarlierRoundsBlock({
      lines: earlierRoundLines(model()),
      summary: { report: true, jd: 'attached', cv: 'attached' },
    });
    assert.match(html, /Earlier rounds/);
    assert.match(html, /Attached: the report so far \(every earlier round, with the scorecards\), the job description, the candidate's CV\./);
    assert.match(html, /watch the recording/);
    assert.match(html, /work for 14 days/);
  });

  test('a first round says only what is attached', () => {
    const html = buildEarlierRoundsBlock({ lines: [], summary: { report: false, jd: 'attached', cv: 'attached' } });
    assert.ok(!/Earlier rounds/.test(html));
    assert.match(html, /Attached: the job description, the candidate's CV\./);
  });

  test('a JD that could not travel becomes its link; a large CV says so', () => {
    const html = buildEarlierRoundsBlock({ lines: [], summary: { report: false, jd: 'link', cv: 'too_large' }, jdLink: 'https://od.example/jd?a=1&b=2' });
    assert.ok(html.includes('href="https://od.example/jd?a=1&amp;b=2"'));
    assert.match(html, /The CV was too large to attach/);
  });

  test('values are escaped', () => {
    const html = buildEarlierRoundsBlock({ lines: [{ round: '<b>x</b>', text: 'a & b', recordingUrl: null }], summary: {} });
    assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;') && html.includes('a &amp; b'));
  });
});

describe('L14 email templates', () => {
  const tokensIn = (s) => new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

  test('every named template has a default whose placeholders match its tokens', () => {
    for (const name of Object.values(INTERVIEW_EMAIL_TEMPLATE_NAMES)) {
      const t = INTERVIEW_EMAIL_TEMPLATE_DEFAULTS[name];
      assert.ok(t, name);
      const used = new Set([...tokensIn(t.subject), ...tokensIn(t.body_html)]);
      assert.deepEqual([...used].sort(), [...t.placeholders].sort(), name);
    }
  });

  test('defaults are fragments that leave the sign-off to the shell', () => {
    for (const t of Object.values(INTERVIEW_EMAIL_TEMPLATE_DEFAULTS)) {
      assert.ok(!/<html|<!doctype|<body/i.test(t.body_html));
      assert.ok(!/regards/i.test(t.body_html));
    }
  });
});
