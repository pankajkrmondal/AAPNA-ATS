import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_VALUE_COLUMNS, sectionHeading, toFieldValueAoa, toFieldValueRows,
} from '../../utils/fieldValueExport.js';
import { buildCsv } from '../../utils/csvExport.js';
import { columns as roleColumns, roleReportLines, roleReportRows } from '../../exports/roleReport.export.js';
import { columns as mrfDetailColumns, buildDetailRows } from '../../exports/mrfDetail.export.js';

describe('toFieldValueRows (L12)', () => {
  const rows = [
    { section: 'Workflow', field: 'Raise status', value: 'COMPLETED' },
    { section: 'Workflow', field: 'Approval status', value: 'APPROVED' },
    { section: 'Submitted MRF', field: 'Position', value: 'QA' },
  ];

  test('a heading row per section, a blank row between sections, no blank row first', () => {
    assert.deepEqual(toFieldValueRows(rows), [
      { field: 'WORKFLOW', value: '' },
      { field: 'Raise status', value: 'COMPLETED' },
      { field: 'Approval status', value: 'APPROVED' },
      { field: '', value: '' },
      { field: 'SUBMITTED MRF', value: '' },
      { field: 'Position', value: 'QA' },
    ]);
  });

  test('rows without a section get no heading', () => {
    assert.deepEqual(toFieldValueRows([{ field: 'A', value: 1 }]), [{ field: 'A', value: 1 }]);
    assert.deepEqual(toFieldValueRows([]), []);
  });

  test('the XLSX form has the header row first and two cells per row', () => {
    const aoa = toFieldValueAoa(rows);
    assert.deepEqual(aoa[0], ['Field', 'Value']);
    assert.ok(aoa.every((r) => r.length === 2));
  });

  test('the CSV is two columns', () => {
    const csv = buildCsv(toFieldValueRows(rows), FIELD_VALUE_COLUMNS).replace(/^﻿/, '');
    const lines = csv.trim().split(/\r?\n/);
    assert.equal(lines[0], '"Field","Value"');
    assert.equal(lines[1], '"WORKFLOW",""');
    assert.equal(sectionHeading('  Applied by source '), 'APPLIED BY SOURCE');
  });
});

describe('MRF details CSV is Field | Value (L12)', () => {
  test('the export columns are the shared two', () => {
    assert.deepEqual(mrfDetailColumns.map((c) => c.header), ['Field', 'Value']);
  });

  test('its rows become heading + field rows', () => {
    const jdSend = { id: 7n, first_name: 'Meera', last_name: 'Kapoor', email: 'm@example.com', role: 'QA', mrfstatus: 'pending', created_at: new Date('2026-10-01T05:00:00Z') };
    const out = toFieldValueRows(buildDetailRows(jdSend, null));
    assert.equal(out[0].value, '', 'first row is a heading');
    assert.equal(out[0].field, out[0].field.toUpperCase());
    assert.ok(out.every((r) => Object.keys(r).sort().join() === 'field,value'));
  });
});

describe('role report is Field | Value (L12)', () => {
  const detail = {
    position: {
      role: 'Java Developer', ref: 'MRF-118', status: 'Open', opened_at: new Date('2026-10-01T05:00:00Z'), days_open: 22,
      filled: 0, openings: 2, health: { label: 'Watch', reasons: ['No offers yet'] }, shortlist_pct: 12, response_pct: null,
      sources: { website: 3 },
    },
    range: { label: 'Last 7 days' }, previous: { label: 'the 7 days before' },
    summary_text: '14 applied this week.',
    kpis: [{ key: 'applied', value: 14, previous: 9 }],
    source_labels: { website: 'Website' },
    attention: { stuck: [{ candidate_name: 'Priya Nair', stage: 'Tech 1', days: 6 }], feedback: [], offers: [], responded_not_reviewed: 0 },
    series: [{ from: new Date('2026-10-21T05:00:00Z'), sources: { website: 3 }, shortlisted: 1, applied: 3 }],
    activity: { items: [{ at: new Date('2026-10-21T05:00:00Z'), day_only: true, text: 'Shortlisted Priya', by: 'anita' }] },
    upcoming: [],
    milestones: [{ label: 'Opened', at: new Date('2026-10-01T05:00:00Z'), days_after_previous: null }],
  };

  test('the export columns are the shared two', () => {
    assert.deepEqual(roleColumns.map((c) => c.header), ['Field', 'Value']);
  });

  test('each line says its value in full, with the qualifier after it', () => {
    const lines = roleReportLines(detail);
    const find = (f) => lines.find((l) => l.field === f);
    assert.equal(find('Role').value, 'Java Developer · MRF-118');
    assert.equal(find('Applied').value, '14 (previous period 9)');
    assert.equal(find('Shortlist rate').value, '12% (shortlisted ÷ applied)');
    assert.equal(find('Response rate').value, 'responded ÷ applied');
    assert.equal(find('Stuck').value, 'Priya Nair · Tech 1 · 6 days');
    assert.match(lines.find((l) => l.section === 'Daily').value, /^3 applied \(Website 3\); shortlisted 1$/);
    assert.match(lines.find((l) => l.section === 'What happened').value, /^Shortlisted Priya \(by anita\)$/);
  });

  test('the rows the CSV writes are Field | Value with heading rows', () => {
    const rows = roleReportRows(detail);
    assert.deepEqual(rows[0], { field: 'POSITION', value: '' });
    assert.ok(rows.every((r) => Object.keys(r).sort().join() === 'field,value'));
    assert.ok(rows.some((r) => r.field === 'NEEDS ATTENTION'));
  });
});
