/**
 * Developer logging & error tracing (N42) — the pure parts: the request ref,
 * masking, path templating, error fingerprints, the alert throttle and the
 * job runner (with its storage and email stubbed).
 *
 * Run: timeout 60 node --test src/tests/unit/developerLogging.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newRef, runWithContext, currentRef, getContext, setContextUser, requestContext } from '../../middleware/requestContext.js';
import { maskText, maskValue, templatePath } from '../../utils/logMask.js';
import { createAlertThrottle, ERROR_ALERT_COOLDOWN_MS, JOB_ALERT_COOLDOWN_MS } from '../../utils/alertThrottle.js';
import { fingerprintOf, routeShape } from '../../services/errorLog.service.js';
import { createJobRunner, jobAlertSignature } from '../../utils/jobRunner.js';

// ── Request ref ───────────────────────────────────────────────────────

test('newRef is 6 characters with no look-alike letters', () => {
  for (let i = 0; i < 200; i += 1) {
    const ref = newRef();
    assert.match(ref, /^[A-HJKMNP-Z2-9]{6}$/);
  }
});

test('the ref survives await, timers and nested promises', async () => {
  await runWithContext({ requestId: 'ABC123' }, async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(currentRef(), 'ABC123');
    await Promise.all([1, 2].map(async () => {
      await new Promise((r) => setImmediate(r));
      assert.equal(currentRef(), 'ABC123');
    }));
  });
  assert.equal(currentRef(), null, 'no ref leaks outside the context');
});

test('two overlapping requests keep their own refs', async () => {
  const seen = [];
  await Promise.all(['AAAAAA', 'BBBBBB'].map((ref, i) => runWithContext({ requestId: ref }, async () => {
    await new Promise((r) => setTimeout(r, 10 - i * 5));
    seen.push([ref, currentRef()]);
  })));
  for (const [want, got] of seen) assert.equal(got, want);
});

test('setContextUser adds the user to the running context', async () => {
  await runWithContext({ requestId: 'U1U1U1', userId: null }, async () => {
    setContextUser({ id: 42, role: 'recruiter' });
    await Promise.resolve();
    assert.equal(getContext().userId, 42);
    assert.equal(getContext().role, 'recruiter');
  });
});

test('middleware: makes a ref, echoes it as x-request-id, accepts a sane incoming one', () => {
  const run = (incoming) => {
    const headers = {};
    const req = { method: 'GET', originalUrl: '/api/x?email=a@b.com', get: () => incoming };
    const res = { setHeader: (k, v) => { headers[k] = v; } };
    let inside;
    requestContext(req, res, () => { inside = getContext(); });
    return { req, headers, inside };
  };
  const fresh = run(undefined);
  assert.match(fresh.req.requestId, /^[A-Z2-9]{6}$/);
  assert.equal(fresh.headers['x-request-id'], fresh.req.requestId);
  assert.equal(fresh.inside.requestId, fresh.req.requestId);
  assert.equal(fresh.inside.route, '/api/x', 'query string dropped');

  assert.equal(run('proxy-ref-1234').req.requestId, 'proxy-ref-1234');
  assert.notEqual(run('<script>').req.requestId, '<script>', 'junk incoming id is replaced');
});

// ── Masking ───────────────────────────────────────────────────────────

test('emails are masked to the first letter and domain', () => {
  assert.equal(maskText('sent to priya.sharma@example.com ok'), 'sent to p***@example.com ok');
  assert.equal(maskText('to "a@b.co, z.q@aapnainfotech.com.au"'), 'to "a***@b.co, z***@aapnainfotech.com.au"');
  assert.equal(maskText(maskText('x.y@example.com')), 'x***@example.com', 'masking twice changes nothing');
});

test('Indian mobiles and +-numbers are masked to the last 4 digits', () => {
  assert.equal(maskText('phone 9876543210'), 'phone ******3210');
  assert.equal(maskText('phone +91 98765 43210.'), 'phone ********3210.');
  assert.equal(maskText('call 919876543210'), 'call ********3210');
  assert.equal(maskText('+44 20 7946 0958'), '********0958');
});

test('ids, timestamps and dates are not mistaken for phones', () => {
  for (const s of [
    'epoch 1760000000000',
    'cv 1234567890',
    '2026-10-19 10:20:30',
    'took 120000 ms',
    'item 01ABCDEF2345GHIJ',
  ]) assert.equal(maskText(s), s);
});

test('maskValue masks nested strings and errors without touching the input', () => {
  const input = { to: 'a.b@example.com', nested: { list: ['9876543210', 5] }, when: new Date(0) };
  const out = maskValue(input);
  assert.deepEqual(out.nested.list, ['******3210', 5]);
  assert.equal(out.to, 'a***@example.com');
  assert.ok(out.when instanceof Date);
  assert.equal(input.to, 'a.b@example.com');

  const err = new Error('no candidate x.y@example.com');
  const masked = maskValue({ err }).err;
  assert.equal(masked.message, 'no candidate x***@example.com');
  assert.ok(!masked.stack.includes('x.y@example.com'));
});

test('templatePath replaces ids and drops query strings', () => {
  assert.equal(templatePath('/api/pipeline/123/move?x=a@b.com'), '/api/pipeline/:id/move');
  assert.equal(templatePath('/v1.0/users/pk%40aapna.com/messages/AAMkAD123=/send'), '/v1.0/users/:id/messages/:id/send');
  assert.equal(templatePath('/api/screening/keyword-search'), '/api/screening/keyword-search');
});

test('routeShape keeps labels, keeps the method, and templates only the path', () => {
  assert.equal(routeShape('job:mailboxPoller'), 'job:mailboxPoller');
  assert.equal(routeShape('process:uncaughtException'), 'process:uncaughtException');
  assert.equal(routeShape('GET /api/pipeline/123/move'), 'GET /api/pipeline/:id/move');
  assert.equal(routeShape('POST /api/mrf/:id/close'), 'POST /api/mrf/:id/close');
  assert.equal(routeShape('/pipeline/42?tab=x'), '/pipeline/:id');
  assert.equal(routeShape(''), '');
});

// ── Fingerprints ──────────────────────────────────────────────────────

test('the same error on the same route groups; a different route does not', () => {
  const stack = 'Error: boom\n    at listPipeline (file:///app/src/services/pipeline.service.js:120:11)\n    at node:internal/x';
  const a = fingerprintOf({ source: 'backend', name: 'Error', route: 'GET /api/pipeline/5', stack, message: 'boom 5' });
  const b = fingerprintOf({ source: 'backend', name: 'Error', route: 'GET /api/pipeline/9', stack: stack.replace(':120:11', ':121:3'), message: 'boom 9' });
  const c = fingerprintOf({ source: 'backend', name: 'Error', route: 'GET /api/mrf', stack, message: 'boom' });
  assert.equal(a, b, 'ids and line numbers do not split a group');
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('without a stack, messages that differ only in numbers group together', () => {
  const a = fingerprintOf({ source: 'frontend', route: '/pipeline', message: 'Cannot read 12 of undefined' });
  const b = fingerprintOf({ source: 'frontend', route: '/pipeline', message: 'Cannot read 34 of undefined' });
  assert.equal(a, b);
});

// ── Alert throttle ────────────────────────────────────────────────────

test('throttle: one alert per signature per cooldown', () => {
  const allowed = createAlertThrottle();
  const t0 = 1_000_000;
  assert.equal(allowed('x', ERROR_ALERT_COOLDOWN_MS, t0), true);
  assert.equal(allowed('x', ERROR_ALERT_COOLDOWN_MS, t0 + 1000), false);
  assert.equal(allowed('y', ERROR_ALERT_COOLDOWN_MS, t0 + 1000), true, 'other signatures are independent');
  assert.equal(allowed('x', ERROR_ALERT_COOLDOWN_MS, t0 + ERROR_ALERT_COOLDOWN_MS), true);
});

test('throttle: job cooldown is an hour, and old entries are pruned', () => {
  const store = new Map();
  const allowed = createAlertThrottle(store);
  allowed('job', JOB_ALERT_COOLDOWN_MS, 0);
  assert.equal(allowed('job', JOB_ALERT_COOLDOWN_MS, 30 * 60 * 1000), false);
  assert.equal(allowed('job', JOB_ALERT_COOLDOWN_MS, 60 * 60 * 1000), true);

  for (let i = 0; i < 600; i += 1) allowed(`sig-${i}`, ERROR_ALERT_COOLDOWN_MS, 0);
  allowed('late', ERROR_ALERT_COOLDOWN_MS, 10 * 60 * 1000);
  assert.ok(store.size < 100, `expired entries pruned (size ${store.size})`);
});

// ── Job runner ────────────────────────────────────────────────────────

function stubbedRunner() {
  const calls = { record: [], beat: [], alert: [] };
  const runJob = createJobRunner({
    recordError: async (r) => { calls.record.push(r); return true; },
    writeHeartbeat: async (name, patch) => { calls.beat.push({ name, ...patch }); },
    sendOpsAlert: async (a) => { calls.alert.push(a); return true; },
  });
  return { runJob, calls };
}

test('runJob: a good run returns its result and leaves a success heartbeat', async () => {
  const { runJob, calls } = stubbedRunner();
  let refInside;
  const out = await runJob('demoJob', async () => { refInside = currentRef(); return 7; });
  assert.equal(out, 7);
  assert.match(refInside, /^job-demoJob-[A-Z2-9]{6}$/, 'the run has its own ref');
  assert.equal(calls.record.length, 0);
  assert.equal(calls.alert.length, 0);
  assert.equal(calls.beat.length, 1);
  assert.ok(calls.beat[0].lastOkAt);
  assert.equal(calls.beat[0].lastRef, refInside);
});

test('runJob: a failed run never throws, is stored once, alerted once, and marks the heartbeat', async () => {
  const { runJob, calls } = stubbedRunner();
  const out = await runJob('demoJob', async () => { throw new Error('Graph 503 for candidate 42 (x.y@example.com)'); });
  await new Promise((r) => setImmediate(r));
  assert.equal(out, undefined);
  assert.equal(calls.record.length, 1);
  assert.equal(calls.record[0].source, 'job');
  assert.match(calls.record[0].requestId, /^job-demoJob-/);
  assert.equal(calls.alert.length, 1);
  assert.equal(calls.alert[0].kind, 'job_failure');
  assert.equal(calls.alert[0].ref, calls.record[0].requestId);
  assert.ok(calls.beat[0].lastFailAt);
  assert.ok(!calls.beat[0].lastError.includes('x.y@example.com'), 'heartbeat error text is masked');
});

test('runJob: alert:false stores the failure but sends nothing', async () => {
  const { runJob, calls } = stubbedRunner();
  await runJob('quietJob', async () => { throw new Error('x'); }, { alert: false });
  assert.equal(calls.record.length, 1);
  assert.equal(calls.alert.length, 0);
});

test('job alert signature ignores numbers, so ids do not split one outage into many alerts', () => {
  assert.equal(
    jobAlertSignature('zekoResults', new Error('candidate 12 failed')),
    jobAlertSignature('zekoResults', new Error('candidate 98 failed')),
  );
  assert.notEqual(
    jobAlertSignature('zekoResults', new Error('x')),
    jobAlertSignature('zekoJobs', new Error('x')),
  );
});

// ── Outside-call logging ──────────────────────────────────────────────

test('tracedFetch logs service, templated path, status and time — never query strings or bodies', async () => {
  const { default: logger } = await import('../../config/logger.js');
  const { default: Transport } = await import('winston-transport');
  const { tracedFetch, logExternal } = await import('../../utils/externalCall.js');
  const seen = [];
  const capture = new (class extends Transport {
    log(info, cb) { seen.push(info); cb(); }
  })({ level: 'debug' });
  logger.add(capture);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await runWithContext({ requestId: 'TRACE1' }, () => tracedFetch('zeko', 'https://api.zeko.ai/v1/jobs/991/results?api_key=SECRET&email=a.b@example.com', {
      method: 'POST', body: JSON.stringify({ name: 'Priya', email: 'p@example.com' }),
    }));
    globalThis.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }); };
    await assert.rejects(tracedFetch('graph', 'https://graph.microsoft.com/v1.0/users/x%40y.com/sendMail'));
    await assert.rejects(logExternal('gemini', 'generateContent m1', async () => { throw new Error('429 quota'); }));

    const ext = seen.filter((i) => i.external);
    assert.equal(ext.length, 3);
    const [httpFail, netFail, sdkFail] = ext;
    assert.equal(httpFail.level, 'warn');
    assert.equal(httpFail.external.op, 'POST api.zeko.ai/v1/jobs/:id/results');
    assert.equal(httpFail.external.status, 503);
    assert.equal(httpFail.requestId, 'TRACE1', 'the ref is on the line');
    assert.match(netFail.external.error, /UND_ERR_CONNECT_TIMEOUT/);
    assert.equal(sdkFail.external.service, 'gemini');
    const all = JSON.stringify(ext);
    for (const secret of ['SECRET', 'Priya', 'p@example.com', 'a.b@example.com', 'x%40y.com']) {
      assert.ok(!all.includes(secret), `"${secret}" must not be logged`);
    }
  } finally {
    globalThis.fetch = realFetch;
    logger.remove(capture);
  }
});
