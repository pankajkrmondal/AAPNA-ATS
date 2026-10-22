/**
 * Unit tests for the CSV writer (pure — no DB, no Express, no config).
 * Run: npm run test:unit
 *
 * These lock in the five defects the old client-side MRF exporter shipped
 * with (missing BOM, "null" cells, unescaped values, no injection guard,
 * BigInt crashes) so they cannot come back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCsv,
  csvFilename,
  stringifyCell,
  formatDate,
  formatDateTime,
} from '../utils/csvExport.js';

const BOM = '\uFEFF';
const cols = [{ header: 'A', key: 'a' }];
/** Body of a single-column, single-row CSV, without BOM/header/terminator. */
const cell = (value) => buildCsv([{ a: value }], cols).slice(BOM.length).split('\r\n')[1];

// ── Document shape ────────────────────────────────────────────────────

test('buildCsv prefixes a UTF-8 BOM so Excel reads it as UTF-8', () => {
  assert.equal(buildCsv([], cols)[0], '\uFEFF');
});

test('buildCsv uses CRLF row terminators and ends with one', () => {
  const csv = buildCsv([{ a: 1 }, { a: 2 }], cols);
  assert.equal(csv, `${BOM}"A"\r\n"1"\r\n"2"\r\n`);
});

test('buildCsv emits a header-only document for zero rows', () => {
  assert.equal(buildCsv([], cols), `${BOM}"A"\r\n`);
  assert.equal(buildCsv(null, cols), `${BOM}"A"\r\n`);
});

test('buildCsv keeps column order and supports dotted paths and value fns', () => {
  const csv = buildCsv(
    [{ nested: { name: 'Acme' }, n: 3 }],
    [
      { header: 'Company', key: 'nested.name' },
      { header: 'Double', value: (r) => r.n * 2 },
      { header: 'Missing', key: 'nope.deep.path' },
    ],
  );
  assert.equal(csv, `${BOM}"Company","Double","Missing"\r\n"Acme","6",""\r\n`);
});

// ── RFC 4180 escaping ─────────────────────────────────────────────────

test('values containing a comma stay in one field', () => {
  assert.equal(cell('a,b'), '"a,b"');
});

test('double quotes are doubled', () => {
  assert.equal(cell('he said "hi"'), '"he said ""hi"""');
});

test('an embedded newline stays inside one field', () => {
  const csv = buildCsv([{ a: 'line1\nline2' }], cols);
  assert.equal(csv, `${BOM}"A"\r\n"line1\nline2"\r\n`);
  // One data row, not two — the quoting is what makes this true.
  assert.equal(csv.split('\r\n').length, 3);
});

test('an embedded CRLF stays inside one field', () => {
  // Asserted on the whole document — a naive split('\r\n') is exactly the
  // mistake this quoting exists to survive.
  assert.equal(buildCsv([{ a: 'line1\r\nline2' }], cols), `${BOM}"A"\r\n"line1\r\nline2"\r\n`);
});

// ── Null / type handling ──────────────────────────────────────────────

test('null and undefined become empty, never the text "null"', () => {
  assert.equal(cell(null), '""');
  assert.equal(cell(undefined), '""');
  assert.equal(buildCsv([{}], cols).slice(BOM.length).split('\r\n')[1], '""');
});

test('BigInt ids serialise instead of throwing', () => {
  assert.equal(cell(10n), '"10"');
  assert.equal(stringifyCell(9007199254740993n), '9007199254740993');
});

test('booleans render as Yes/No, matching the UI', () => {
  assert.equal(cell(true), '"Yes"');
  assert.equal(cell(false), '"No"');
});

test('Prisma Decimal-like objects use their own toString', () => {
  const decimal = { toFixed: () => '7.50', toString: () => '7.5' };
  assert.equal(stringifyCell(decimal), '7.5');
});

test('arrays join with a semicolon and drop empties', () => {
  assert.equal(cell(['Java', 'SQL', null, 'AWS']), '"Java; SQL; AWS"');
});

test('plain objects fall back to JSON', () => {
  assert.equal(cell({ a: 1 }), '"{""a"":1}"');
});

test('non-finite numbers become empty rather than NaN/Infinity', () => {
  assert.equal(cell(NaN), '""');
  assert.equal(cell(Infinity), '""');
});

// ── Dates ─────────────────────────────────────────────────────────────

test('dates format in a fixed timezone, not the server local zone', () => {
  // 2026-08-10T09:02:00Z === 14:32 in Asia/Kolkata (UTC+05:30)
  const d = new Date('2026-08-10T09:02:00Z');
  assert.equal(formatDateTime(d), '2026-08-10 14:32');
  assert.equal(formatDate(d), '2026-08-10');
});

test('a date column formats an ISO string too', () => {
  const csv = buildCsv(
    [{ when: '2026-08-10T09:02:00Z' }],
    [{ header: 'When', key: 'when', type: 'date' }],
  );
  assert.equal(csv, `${BOM}"When"\r\n"2026-08-10"\r\n`);
});

test('unparseable and empty dates become empty, never the epoch', () => {
  assert.equal(formatDate('not a date'), '');
  // new Date(null) is the epoch, not Invalid Date — a null timestamp column
  // must not export as 1970-01-01.
  assert.equal(formatDateTime(null), '');
  assert.equal(formatDateTime(undefined), '');
  assert.equal(formatDate(''), '');
  const csv = buildCsv([{ closed: null }], [{ header: 'Closed At', key: 'closed', type: 'datetime' }]);
  assert.equal(csv, `${BOM}"Closed At"\r\n""\r\n`);
});

// ── CSV injection ─────────────────────────────────────────────────────

test('formula-leading strings are neutralised with an apostrophe', () => {
  assert.equal(cell("=cmd|'/c calc'!A1"), `"'=cmd|'/c calc'!A1"`);
  assert.equal(cell('@SUM(A1:A9)'), `"'@SUM(A1:A9)"`);
  assert.equal(cell('+1+1'), `"'+1+1"`);
  assert.equal(cell('\tTAB'), `"'\tTAB"`);
  assert.equal(cell('-2+3*A1'), `"'-2+3*A1"`);
});

test('a real negative NUMBER is not prefixed — it must stay summable', () => {
  assert.equal(cell(-5), '"-5"');
});

test('phone numbers are NOT uglified by the guard', () => {
  // The apostrophe is visible when Excel opens a CSV, so guarding every value
  // with a leading + would put one on every phone number in every export.
  // Digits and separators cannot reference a cell or call a function.
  assert.equal(cell('+91 8340625432'), '"+91 8340625432"');
  assert.equal(cell('+91-834-062-5432'), '"+91-834-062-5432"');
  assert.equal(cell('(020) 1234-5678'), '"(020) 1234-5678"');
  assert.equal(cell('-5'), '"-5"');
});

test('a sign-led value that is NOT purely numeric is still guarded', () => {
  assert.equal(cell('+91 call me =SUM(A1)'), `"'+91 call me =SUM(A1)"`);
  assert.equal(cell('-cmd|calc'), `"'-cmd|calc"`);
});

test('numeric: true opts a money column out of the guard', () => {
  const csv = buildCsv(
    [{ budget: '-5' }],
    [{ header: 'Budget', key: 'budget', numeric: true }],
  );
  assert.equal(csv, `${BOM}"Budget"\r\n"-5"\r\n`);
});

test('headers are never injection-guarded', () => {
  assert.equal(buildCsv([], [{ header: '=A1', key: 'x' }]), `${BOM}"=A1"\r\n`);
});

// ── Filenames ─────────────────────────────────────────────────────────

test('csvFilename is prefixed, slugged and timestamped', () => {
  const name = csvFilename('MRF Requests', new Date('2026-08-10T09:02:00Z'));
  assert.equal(name, 'AAPNA-ATS_MRF-Requests_2026-08-10-14-32.csv');
});

test('csvFilename strips characters that would break Content-Disposition', () => {
  const name = csvFilename('Screening / MRF #12 "beta"', new Date('2026-08-10T09:02:00Z'));
  assert.match(name, /^AAPNA-ATS_Screening-MRF-12-beta_[\d-]+\.csv$/);
});
