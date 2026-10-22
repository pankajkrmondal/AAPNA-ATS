/**
 * Developer logging & error tracing (N42), against the database. Run one file
 * at a time (NODE_ENV=staging):
 *
 *   node src/tests/run-block.mjs src/tests/integration/errorTrail.test.js
 *
 * Needs prisma/ddl/2026-10-20-error-log.sql applied. Sends NO email: the
 * response check uses a 400 (the developer alert only fires on 5xx), and the
 * error-log checks call the store directly. Everything it writes carries the
 * test's own refs and is deleted by them at the end.
 *
 * What it pins down:
 *   - every response carries x-request-id, and an error body carries the same `ref`;
 *   - a stored error is found by its ref, masked, with its user and route;
 *   - repeats group under one fingerprint with a count;
 *   - a log line written inside the request is found by "Find a ref";
 *   - the retention sweep leaves fresh rows alone.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import prisma from '../../config/database.js';
import logger from '../../config/logger.js';
import { disconnectRedis } from '../../config/redis.js';
import AppError from '../../utils/AppError.js';
import errorHandler from '../../middleware/errorHandler.js';
import { requestContext, runWithContext, newRef } from '../../middleware/requestContext.js';
import { recordError, findErrorsByRef, listErrorGroups, listOccurrences, deleteOlderThan } from '../../services/errorLog.service.js';
import { findLogLinesByRef } from '../../services/logScan.service.js';

const RUN = newRef();
const REF_A = `N42TEST-${RUN}-A`;
const REF_B = `N42TEST-${RUN}-B`;
const TAG = `N42 fixture ${RUN}`;

after(async () => {
  await prisma.rpa_error_log.deleteMany({ where: { request_id: { startsWith: `N42TEST-${RUN}` } } });
  await prisma.$disconnect();
  await disconnectRedis().catch(() => {});
});

describe('request ref on responses', () => {
  test('x-request-id on every response; an error body carries the same ref', async () => {
    const app = express();
    app.use(requestContext);
    app.get('/ok', (_req, res) => res.json({ ok: true }));
    app.get('/bad', () => { throw new AppError('Email is required.', 400); });
    app.use(errorHandler);
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const ok = await fetch(`${base}/ok`);
      assert.match(ok.headers.get('x-request-id'), /^[A-Z2-9]{6}$/);

      const bad = await fetch(`${base}/bad`);
      const body = await bad.json();
      assert.equal(bad.status, 400);
      assert.equal(body.message, 'Email is required.', 'validation messages are unchanged (no ref in the text)');
      assert.equal(body.ref, bad.headers.get('x-request-id'));

      const passed = await fetch(`${base}/ok`, { headers: { 'x-request-id': 'proxy-1234' } });
      assert.equal(passed.headers.get('x-request-id'), 'proxy-1234');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('error store', () => {
  test('a stored error is found by its ref, masked, with route and user', async () => {
    const user = await prisma.rpa_users.findFirst({ select: { id: true } });
    await runWithContext({ requestId: REF_A, userId: user?.id ?? null, route: '/api/pipeline/77/move' }, async () => {
      const err = new Error(`${TAG}: Graph rejected priya.sharma@example.com / +91 98765 43210`);
      err.code = 'N42_FIXTURE';
      const stored = await recordError({ source: 'backend', err, meta: { statusCode: 500, secret: 'must-not-be-stored' } });
      assert.equal(stored, true);
    });

    const rows = await findErrorsByRef(REF_A);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row.message.includes('p***@example.com'), row.message);
    assert.ok(row.message.includes('********3210'), row.message);
    assert.ok(!row.message.includes('priya.sharma'), 'email masked');
    assert.ok(!(row.stack || '').includes('98765'), 'phone masked in the stack too');
    assert.equal(row.route, '/api/pipeline/:id/move');
    assert.equal(row.user_id, user?.id ?? null);
    assert.deepEqual(row.meta, { statusCode: 500 }, 'only whitelisted meta keys are kept');
  });

  test('repeats group under one fingerprint with a count', async () => {
    for (let i = 0; i < 2; i += 1) {
      await runWithContext({ requestId: REF_B, route: '/api/pipeline/88/move' }, async () => {
        const err = new Error(`${TAG}: Graph rejected someone@example.com`);
        err.code = 'N42_FIXTURE';
        await recordError({ source: 'backend', err });
      });
    }
    const groups = await listErrorGroups({ q: TAG, days: 1 });
    // REF_A and REF_B have the same code, route template and top frame.
    const group = groups.find((g) => g.message.includes(TAG));
    assert.ok(group, 'group found by message search');
    assert.equal(group.count, 3);
    const occurrences = await listOccurrences({ fingerprint: group.fingerprint }, 10);
    assert.equal(occurrences.filter((o) => o.request_id.startsWith(`N42TEST-${RUN}`)).length, 3);
  });

  test('the retention sweep keeps rows newer than the cut-off', async () => {
    await deleteOlderThan(30);
    assert.equal((await findErrorsByRef(REF_A)).length, 1);
  });
});

describe('Find a ref in the log files', () => {
  test('a log line written inside the request is found by its ref', async () => {
    const ref = `N42TEST-${RUN}-LOG`;
    await runWithContext({ requestId: ref }, async () => {
      logger.info(`${TAG}: a line inside the request`);
    });
    await new Promise((r) => setTimeout(r, 1500)); // let the file transport flush
    const scan = await findLogLinesByRef(ref);
    assert.ok(scan.lines.some((l) => l.message.includes(TAG) && l.requestId === ref), JSON.stringify(scan).slice(0, 400));
    assert.ok(scan.filesScanned.includes('combined.log'));
  });

  test('junk refs are refused without reading files', async () => {
    const scan = await findLogLinesByRef('../../etc/passwd');
    assert.deepEqual(scan.lines, []);
    assert.deepEqual(scan.filesScanned, []);
  });
});
