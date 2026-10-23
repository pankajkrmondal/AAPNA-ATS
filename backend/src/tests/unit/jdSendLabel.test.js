/**
 * JD label rules for JDs sent without an MRF (L07). Pure — no database.
 * Run: node --test src/tests/unit/jdSendLabel.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VERSION_LABEL_LENGTH, jdSendDay, isLabelEditable, parseVersionLabelInput, latestJdSendIds, jdSendLabel,
} from '../../utils/jdSendLabel.js';

const dateCol = (day) => new Date(`${day}T00:00:00Z`); // how Prisma returns a DATE column

test('1 · jdSendDay prefers the JD date, else the created day in India time', () => {
  assert.equal(jdSendDay({ version_date: dateCol('2026-10-18'), created_at: new Date('2026-10-15T06:00:00Z') }), '2026-10-18');
  assert.equal(jdSendDay({ version_date: null, created_at: new Date('2026-10-15T06:00:00Z') }), '2026-10-15');
  // 20:00 UTC on 14 Oct is 01:30 on 15 Oct in India.
  assert.equal(jdSendDay({ created_at: new Date('2026-10-14T20:00:00Z') }), '2026-10-15');
  assert.equal(jdSendDay({}), null);
});

test('2 · only rows without an MRF are editable', () => {
  assert.equal(isLabelEditable({ mrf_id: null }), true);
  assert.equal(isLabelEditable({ mrf_id: 212 }), false);
});

test('3 · input: label is trimmed and single-spaced; empty clears; too long is refused', () => {
  assert.deepEqual(parseVersionLabelInput({ version_label: '  v2   Oct  revision ' }), { data: { version_label: 'v2 Oct revision' } });
  assert.deepEqual(parseVersionLabelInput({ version_label: '' }), { data: { version_label: null } });
  assert.deepEqual(parseVersionLabelInput({ version_label: null }), { data: { version_label: null } });
  assert.ok(parseVersionLabelInput({ version_label: 'x'.repeat(MAX_VERSION_LABEL_LENGTH + 1) }).error);
  assert.ok(parseVersionLabelInput({ version_label: 42 }).error);
});

test('4 · input: the date must be a real calendar day; empty clears', () => {
  assert.deepEqual(parseVersionLabelInput({ version_date: '2026-10-18' }), { data: { version_date: dateCol('2026-10-18') } });
  assert.deepEqual(parseVersionLabelInput({ version_date: '' }), { data: { version_date: null } });
  assert.ok(parseVersionLabelInput({ version_date: '2026-02-30' }).error);
  assert.ok(parseVersionLabelInput({ version_date: '18/10/2026' }).error);
  assert.ok(parseVersionLabelInput({}).error, 'an empty body is refused');
});

test('5 · Latest: newest JD date per role, case and spacing ignored; rows with an MRF never count', () => {
  const rows = [
    { id: 1n, role: 'Data Analyst', mrf_id: null, version_date: null, created_at: new Date('2026-09-12T06:00:00Z') },
    { id: 2n, role: 'data  analyst ', mrf_id: null, version_date: dateCol('2026-10-18'), created_at: new Date('2026-10-15T06:00:00Z') },
    { id: 3n, role: 'Data Analyst', mrf_id: 99, version_date: null, created_at: new Date('2026-10-20T06:00:00Z') },
    { id: 4n, role: 'Business Development', mrf_id: null, version_date: null, created_at: new Date('2026-10-03T06:00:00Z') },
  ];
  assert.deepEqual([...latestJdSendIds(rows)].sort(), ['2', '4']);
});

test('6 · Latest: a JD date set earlier than another row\'s created day loses to it', () => {
  const rows = [
    { id: 10n, role: 'QA', mrf_id: null, version_date: dateCol('2026-09-01'), created_at: new Date('2026-10-10T06:00:00Z') },
    { id: 11n, role: 'QA', mrf_id: null, version_date: null, created_at: new Date('2026-09-20T06:00:00Z') },
  ];
  assert.deepEqual([...latestJdSendIds(rows)], ['11']);
});

test('7 · Latest: on the same day the newer row (higher id) wins', () => {
  const rows = [
    { id: 20n, role: 'QA', mrf_id: null, version_date: dateCol('2026-10-18') },
    { id: 21n, role: 'QA', mrf_id: null, version_date: dateCol('2026-10-18') },
  ];
  assert.deepEqual([...latestJdSendIds(rows)], ['21']);
});

test('8 · label text: role · label · date, label optional', () => {
  const fmt = (d) => `<${d}>`;
  assert.equal(jdSendLabel({ role: 'Data Analyst', version_label: 'v2', version_date: dateCol('2026-10-18') }, fmt), 'Data Analyst · v2 · <2026-10-18>');
  assert.equal(jdSendLabel({ role: 'Data Analyst', created_at: new Date('2026-09-12T06:00:00Z') }, fmt), 'Data Analyst · <2026-09-12>');
});
