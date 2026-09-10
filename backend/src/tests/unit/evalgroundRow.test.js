/**
 * Reading one row of an Evalground export.
 *
 * Run: node --test src/tests/unit/evalgroundRow.test.js
 *
 * The fixture below is a REAL row, copied from
 * `docs/General Aptitude, Python, SQL MCQ Test at AAPNA - 2026TestReport-3.xlsx`
 * (47 columns, identical in the 2025 and 2026 CSV exports) with the candidate's
 * name and email changed. Its oddities are the point of most of these tests:
 * blank section results, a phone number destroyed by Excel's scientific
 * notation, a "Candidate Resume" link truncated to the bare domain, and a
 * "Public Report" URL cut mid-UUID by the vendor's own exporter.
 *
 * What is pinned here is what the candidate dossier will show an interviewer
 * outside the company, so a wrong number is worse than a missing one.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanText, isSuspectTopicLabel, isUsableReportUrl, parseEvalgroundRow, parseStartedOn, toNumber,
} from '../../utils/evalgroundRow.js';

/** One real export row, as XLSX.utils.sheet_to_json hands it over. */
function sampleRow(overrides = {}) {
  return {
    'Candidate Name': 'Test Candidate',
    'Candidate Location': '-',
    'Candidate Email': 'candidate@example.com',
    'Contact Number': 8480000000,
    'Candidate Resume': 'https://docs.google.com/',
    'Started On': '27 Jul  2026, 15:59',
    'Previous Assessments': 'N/A',
    Duration: '  37 minutes  27 seconds ',
    'Marks Scored': '57',
    Percentage: '90.49122807',
    Result: 'Passed',
    Report: 'Completed',
    Certificate: 'N/A',
    'Public Report': 'https://evalground.com/code4/#/candidatereport/2c6f9fd3-0424-47',
    'Section 1 Marks': '24',
    'S1 Correct': '24',
    'S1 Wrong': '1',
    'S1 Unattempted': '0',
    'S1 Easy Correct': '8',
    'S1 Medium Correct': '8',
    'S1 Hard Correct': '7',
    'S1 Result': null,
    'Section 2 Marks': '23',
    'S2 Correct': '23',
    'S2 Wrong': '1',
    'S2 Unattempted': '0',
    'S2 Easy Correct': '8',
    'S2 Medium Correct': '9',
    'S2 Hard Correct': '7',
    'S2 Result': null,
    'Section 3 Marks': '8',
    'S3 Correct': '8',
    'S3 Wrong': '0',
    'S3 Unattempted': '0',
    'S3 Easy Correct': '8',
    'S3 Medium Correct': '0',
    'S3 Hard Correct': '0',
    'S3 Result': null,
    'Total Correct': '55',
    'Total Wrong': '2',
    'Total Unattempted': '0',
    Sql: '0',
    Coding: '0',
    Python: '6',
    'Py Test': '5',
    Playwright: '6',
    Pywinauto: '7',
    'Marked As': null,
    ...overrides,
  };
}

describe('parseEvalgroundRow — the breakdown the dossier renders', () => {
  const detail = parseEvalgroundRow(sampleRow());

  test('reads all three sections, with their counts and difficulty split', () => {
    assert.equal(detail.sections.length, 3);
    const [s1] = detail.sections;
    assert.equal(s1.index, 1);
    assert.equal(s1.marks, 24);
    assert.equal(s1.correct, 24);
    assert.equal(s1.wrong, 1);
    assert.equal(s1.unattempted, 0);
    assert.deepEqual(
      [s1.easy_correct, s1.medium_correct, s1.hard_correct],
      [8, 8, 7],
    );
  });

  test("keeps the vendor's totals as given", () => {
    assert.deepEqual(detail.totals, { correct: 55, wrong: 2, unattempted: 0 });
  });

  test('a blank section result is null, never a zero', () => {
    // Every real export leaves S1/S2/S3 Result empty. A falsy 0 here would tell
    // an interviewer the candidate scored nought on a section they passed.
    for (const s of detail.sections) assert.equal(s.result, null);
  });

  test('a genuine zero survives', () => {
    // The other half of the same rule: "Sql: 0" is an answer, not an absence.
    const sql = detail.topics.find((t) => t.label === 'Sql');
    assert.equal(sql.value, 0);
  });

  test('discovers the topic tail instead of hard-coding it', () => {
    assert.deepEqual(
      detail.topics.map((t) => t.label),
      ['Sql', 'Coding', 'Python', 'Py Test', 'Playwright', 'Pywinauto'],
    );
  });

  test("a different test's topics are read just as well", () => {
    // The tail changes with every test HR runs — that is why it is whatever is
    // not a known Evalground header, rather than a list in our code.
    const row = sampleRow({ 'Spring Boot': '9', Kafka: '4' });
    for (const topic of ['Sql', 'Coding', 'Python', 'Py Test', 'Playwright', 'Pywinauto']) {
      delete row[topic];
    }
    const other = parseEvalgroundRow(row);
    assert.deepEqual(other.topics, [{ label: 'Spring Boot', value: 9 }, { label: 'Kafka', value: 4 }]);
  });

  test('collapses the padding the export prints', () => {
    assert.equal(detail.durationText, '37 minutes 27 seconds');
    assert.equal(detail.startedOnText, '27 Jul 2026, 15:59');
  });

  test('keeps the whole row for the archive', () => {
    assert.equal(detail.rawRow['Candidate Name'], 'Test Candidate');
  });

  test('ignores unlabelled columns rather than calling them topics', () => {
    const withBlank = parseEvalgroundRow(sampleRow({ __EMPTY: 'x', __EMPTY_1: null }));
    assert.ok(!withBlank.topics.some((t) => /__EMPTY/.test(t.label)));
  });

  test('a header renamed by the vendor degrades to null, never to a wrong number', () => {
    const renamed = parseEvalgroundRow(sampleRow({ 'S1 Wrong': undefined, 'Sec 1 Wrong': '1' }));
    assert.equal(renamed.sections[0].wrong, null);
    // …and the unknown column is still visible somewhere rather than lost.
    assert.ok(renamed.topics.some((t) => t.label === 'Sec 1 Wrong'));
  });

  test('a discovered column that looks like contact or pay is NOT promoted to a topic', () => {
    // The topic tail is "anything we do not recognise", which is what makes the
    // parser survive a new test — and what would carry a column somebody added
    // called "Current CTC" or "Mobile" into a pack emailed outside the company.
    // The dossier's own guard cannot catch it: it checks key names, and topics
    // arrive as {label, value} data.
    const row = sampleRow({
      'Current CTC': '18 LPA',
      'Expected CTC': '26',
      Mobile: '9876543210',
      'Candidate Email ID': 'someone@example.com',
      'Home Address': '12 Example Street',
      'LinkedIn URL': 'https://linkedin.com/in/x',
      'Data Structures': '7',
    });
    const detail = parseEvalgroundRow(row);
    const labels = detail.topics.map((t) => t.label);
    for (const risky of ['Current CTC', 'Expected CTC', 'Mobile', 'Candidate Email ID', 'Home Address', 'LinkedIn URL']) {
      assert.ok(!labels.includes(risky), `${risky} must not reach the pack as a topic`);
    }
    assert.ok(labels.includes('Data Structures'), 'a genuine topic still comes through');
    // Still archived: rawRow keeps the whole row, and rawRow never renders.
    assert.equal(detail.rawRow['Current CTC'], '18 LPA');
  });

  test('the suspect-label test is not fooled by spacing or case', () => {
    assert.equal(isSuspectTopicLabel('current_ctc'), true);
    assert.equal(isSuspectTopicLabel('CTC'), true);
    assert.equal(isSuspectTopicLabel('e-mail'), true);
    assert.equal(isSuspectTopicLabel('Sql'), false);
    assert.equal(isSuspectTopicLabel('Playwright'), false);
  });

  test('a row from some other file yields null rather than a table of dashes', () => {
    assert.equal(parseEvalgroundRow({ Foo: null, Bar: '' }), null);
    assert.equal(parseEvalgroundRow(null), null);
    assert.equal(parseEvalgroundRow([]), null);
  });

  test('a section the test did not have is dropped, not rendered empty', () => {
    const twoSections = parseEvalgroundRow(sampleRow({
      'Section 3 Marks': null,
      'S3 Correct': null,
      'S3 Wrong': null,
      'S3 Unattempted': null,
      'S3 Easy Correct': null,
      'S3 Medium Correct': null,
      'S3 Hard Correct': null,
    }));
    assert.equal(twoSections.sections.length, 2);
  });
});

describe('parseStartedOn — the attempt date', () => {
  test('reads the vendor format, padding and all', () => {
    const d = parseStartedOn('27 Jul  2026, 15:59');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 6);
    assert.equal(d.getDate(), 27);
    assert.equal(d.getHours(), 15);
    assert.equal(d.getMinutes(), 59);
  });

  test('is null rather than a guess when the format is anything else', () => {
    assert.equal(parseStartedOn('sometime last week'), null);
    assert.equal(parseStartedOn('27 Xyz 2026, 15:59'), null);
    assert.equal(parseStartedOn(null), null);
  });
});

describe('isUsableReportUrl — the vendor truncates its own link', () => {
  test('rejects the truncated URL every sample export carries', () => {
    // Cut at 62 characters, 16 of the id's 36 — it cannot resolve, and a dead
    // link inside a pack we cannot correct once sent reads as our failure.
    assert.equal(
      isUsableReportUrl('https://evalground.com/code4/#/candidatereport/2c6f9fd3-0424-47'),
      false,
    );
  });

  test('accepts a full report id, should Evalground ever export one', () => {
    assert.equal(
      isUsableReportUrl('https://evalground.com/code4/#/candidatereport/2c6f9fd3-0424-47ab-9f21-0c1d2e3f4a5b'),
      true,
    );
  });

  test('is false for nothing at all', () => {
    assert.equal(isUsableReportUrl(null), false);
    assert.equal(isUsableReportUrl('N/A'), false);
    assert.equal(isUsableReportUrl('not a url'), false);
  });

  test('the row keeps the truncated URL verbatim anyway', () => {
    // Stored so the question can be answered from data rather than memory —
    // and flagged, so nothing renders it as a link.
    const detail = parseEvalgroundRow(sampleRow());
    assert.ok(detail.publicReportUrl.startsWith('https://evalground.com/'));
    assert.equal(detail.publicReportUsable, false);
  });
});

describe('cleanText / toNumber — the vendor spells "empty" several ways', () => {
  test('folds every empty spelling to null', () => {
    for (const empty of ['', '   ', '-', 'N/A', 'n/a', 'NULL']) {
      assert.equal(cleanText(empty), null, `${empty} should read as empty`);
    }
  });

  test('never returns NaN', () => {
    assert.equal(toNumber('Passed'), null);
    assert.equal(toNumber(''), null);
    assert.equal(toNumber(null), null);
  });

  test('reads numbers however the sheet stored them', () => {
    assert.equal(toNumber('90.49122807'), 90.49122807);
    assert.equal(toNumber(57), 57);
    assert.equal(toNumber('96.49%'), 96.49);
    assert.equal(toNumber('1,024'), 1024);
  });

  test('zero is a number, not an absence', () => {
    assert.equal(toNumber('0'), 0);
    assert.equal(toNumber(0), 0);
  });
});
