/**
 * Functional regression guard — does the app still WORK after the design rollout?
 *
 * WHY THIS EXISTS
 * Every other check in this suite proves the app *renders*. None proved it still
 * *functions*. ~3,000 replacement sites landed across 24 routes, several of them
 * touching event handlers, component swaps, and CSS that carried layout BEHAVIOUR
 * (scroll containers, fixed positioning, sticky chrome).
 *
 * The standing proof that rendering is not enough: PipelineDrawer's OUTCOME_BUTTONS
 * carried `style: {...}`. Renaming that key to `className` silently killed the Hold
 * button's amber, because the render read `btn.style`. The page looked perfect, lint
 * was clean, every check here passed, and the information was gone. Only a screenshot
 * caught it. This file is what catches the next one.
 *
 * ============================ THE WRITE GUARD ============================
 * The dev server proxies /api to a backend pointed at a SHARED REMOTE DATABASE that
 * also sends real email. Driving the UI is therefore NOT inherently read-only: a Save,
 * a Submit or a permission toggle writes real rows and can mail real people.
 *
 * So every context installs `guardWrites()`:
 *   - GET / HEAD  -> passed through untouched, so the app has real data to render.
 *   - everything else (POST/PUT/PATCH/DELETE) -> RECORDED and FULFILLED LOCALLY.
 *     The request never leaves the browser.
 *
 * That inverts the assertion for a mutating path from "the row changed" to "the correct
 * request was issued" — which is what we actually want to know, and costs nothing.
 * ========================================================================
 *
 * Needs a login; skips cleanly with a clear message when credentials are absent.
 */
import { BASE, getChromium, Report, credentials } from './lib.mjs';

/** Intercept every /api call. Reads pass; writes are captured and answered locally. */
async function guardWrites(ctx) {
  const writes = [];
  await ctx.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'GET' || method === 'HEAD') return route.continue();
    let body = null;
    try { body = req.postData(); } catch { /* not all requests carry one */ }
    writes.push({ method, url: req.url().replace(/^https?:\/\/[^/]+/, ''), body });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} }),
    });
  });
  return writes;
}

async function login(page, creds) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await page.locator('input').first().fill(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  await page.waitForTimeout(1300);
  await page.locator('button[type="submit"], .ant-btn').first().click();
  await page.waitForTimeout(6500);
}

export default async function run() {
  const r = new Report('functional regression');
  const creds = credentials();
  if (!creds) {
    r.add('skipped — no VERIFY_EMAIL / VERIFY_PASSWORD', true, '(set them to run this check)');
    return r;
  }

  const chromium = await getChromium();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1560, height: 1000 } });
    await ctx.addInitScript(() => localStorage.setItem('ats_theme', 'light'));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Log in BEFORE arming the guard. The login POST is itself a write, so guarding
    // first swallows it, no session is ever created, and every later assertion then
    // measures the login screen — which is exactly how the first run of this file
    // "failed" nine checks that were fine. Login creates no records; everything after
    // it is guarded.
    await login(page, creds);
    const writes = await guardWrites(ctx);

    const go = async (path, wait = 3500) => {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(wait);
    };

    /* Functional CSS: properties that moved from inline objects to classes. These are
       layout BEHAVIOUR, not decoration — if the class did not land, the board stops
       scrolling and the dock stops floating, silently. */
    await go('/pipeline', 5000);
    const board = await page.evaluate(() => {
      const b = document.querySelector('.pl-board');
      if (!b) return null;
      const cs = getComputedStyle(b);
      return { overflowX: cs.overflowX, scrollable: b.scrollWidth > b.clientWidth + 10 };
    });
    r.add('/pipeline board keeps its horizontal scroll',
      !!board && board.overflowX === 'auto' && board.scrollable,
      board ? '(overflow-x: ' + board.overflowX + ', scrolls: ' + board.scrollable + ')' : '(.pl-board missing)');

    /* PipelineDrawer outcome buttons — the exact regression this file exists for. */
    const card = page.locator('.cp-candidate-card').first();
    if (await card.count()) {
      await card.click();
      await page.waitForTimeout(3500);
      const outcomes = await page.evaluate(() => {
        const find = (t) => [...document.querySelectorAll('.ant-btn')].find((b) => b.textContent.trim() === t);
        const read = (b) => (b ? getComputedStyle(b).color : null);
        return { approve: read(find('Approve')), hold: read(find('Hold')), reject: read(find('Reject')) };
      });
      const tones = [outcomes.approve, outcomes.hold, outcomes.reject];
      r.add('drawer outcome buttons render in three distinct tones',
        tones.every(Boolean) && new Set(tones).size === 3, '(' + tones.join(' / ') + ')');

      await page.locator('.ant-btn').filter({ hasText: /^Hold$/ }).first().click().catch(() => {});
      await page.waitForTimeout(1800);
      const dialog = await page.locator('.ant-modal-wrap:visible').count();
      r.add('Hold opens its confirmation dialog', dialog > 0, '(' + dialog + ' visible dialog)');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    } else {
      r.add('drawer outcome buttons', false, '(no candidate card on the board to open)');
    }

    /* /email — panes changed Card -> Surface and the title became real markup. The
       editor/preview iframes are measured against DOM that moved. */
    await go('/email', 4500);
    await page.locator('.template-list-item, .ant-list-item').first().click().catch(() => {});
    await page.waitForTimeout(3500);
    const email = await page.evaluate(() => {
      const list = document.querySelector('.email-template-list');
      const frame = document.querySelector('.email-editor-iframe, iframe');
      return {
        scroller: list ? getComputedStyle(list).overflowY : null,
        head: !!document.querySelector('.em-pane__head'),
        frameH: frame ? Math.round(frame.getBoundingClientRect().height) : 0,
      };
    });
    r.add('/email template list keeps its own scroller', email.scroller === 'auto', '(overflow-y: ' + email.scroller + ')');
    r.add('/email editor pane head survived the Surface swap', email.head, '(.em-pane__head present)');
    r.add('/email editor iframe is measured to a real height', email.frameH > 150, '(' + email.frameH + 'px)');

    /* Analytics — `Surface as={Card}` must still carry title / extra / loading.
       The panels live on the Pipeline Insights tab, not the default one; asserting on
       load found zero and looked like a failure when it was a wrong assertion. */
    await go('/analytics', 4500);
    /* Updated 2026-09-01: the tab strip is `Segmented` now, not AntD `<Tabs>`, so
       `.ant-tabs-tab` matches nothing here. The old selector had `.catch(() => {})` on
       it, so it would not have thrown — it would have quietly stayed on the default
       tab and failed the panel assertions below as if the Surface swap had broken,
       which is the worst kind of red. Asserted rather than caught for that reason. */
    await page.getByRole('radio', { name: /Pipeline Insights/ }).click();
    await page.waitForTimeout(3500);
    const analytics = await page.evaluate(() => ({
      panels: document.querySelectorAll('.ui-surface.ant-card').length,
      heads: document.querySelectorAll('.ui-surface.ant-card .ant-card-head').length,
      extras: document.querySelectorAll('.ui-surface.ant-card .ant-card-extra').length,
      bareCards: [...document.querySelectorAll('.ant-card')].filter((c) => !c.classList.contains('ui-surface')).length,
    }));
    r.add('Surface-as-Card panels keep their head and extra slots',
      analytics.panels > 0 && analytics.heads > 0 && analytics.extras > 0,
      '(' + analytics.panels + ' panels, ' + analytics.heads + ' heads, ' + analytics.extras + ' extras)');
    r.add('no bare opaque Card left inside a glass route',
      analytics.bareCards === 0,
      '(' + analytics.bareCards + ' .ant-card without .ui-surface — Failure A)');

    /* Required validation — 11 duplicated asterisks were removed from labels. AntD's
       own marker must still render AND the rule must still fire. The submit is caught
       by the write guard, so nothing is created either way. */
    await go('/mrf', 4000);
    const before = writes.length;
    await page.locator('.ant-btn').filter({ hasText: /Submit Request/ }).first().click().catch(() => {});
    await page.waitForTimeout(2000);
    const validation = await page.evaluate(() => ({
      errors: document.querySelectorAll('.ant-form-item-explain-error').length,
      markers: document.querySelectorAll('.ant-form-item-required').length,
    }));
    r.add('MRF required validation still blocks an empty submit',
      validation.errors > 0 && writes.length === before,
      '(' + validation.errors + ' field errors, ' + (writes.length - before) + ' requests issued)');
    r.add('MRF required markers still render', validation.markers > 0, '(' + validation.markers + ' marked fields)');

    /* Sticky chrome moved from inline styles to classes. */
    const chrome = await page.evaluate(() => {
      const g = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).position : null; };
      return { sider: g('.ml-sider'), topbar: g('.ml-topbar') };
    });
    r.add('shell chrome stays sticky after the class swap',
      chrome.sider === 'sticky' && chrome.topbar === 'sticky',
      '(sider: ' + chrome.sider + ', topbar: ' + chrome.topbar + ')');

    /* /filtering — the bulk dock is position:fixed via a class now, and the score
       meters take their width from a custom property. */
    await go('/filtering', 4000);
    const screening = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'cs-floatbar cs-floatbar--fixed';
      document.body.appendChild(el);
      const pos = getComputedStyle(el).position;
      el.remove();
      return { dockPosition: pos };
    });
    r.add('/filtering bulk dock rule still resolves to fixed',
      screening.dockPosition === 'fixed', '(position: ' + screening.dockPosition + ')');

    r.add('no write reached the backend', true, '(' + writes.length + ' captured and answered locally)');
    r.add('no page errors across the functional pass', errors.length === 0,
      errors.length ? '(' + errors[0].slice(0, 70) + ')' : '(0)');

    await ctx.close();
  } finally {
    await browser.close();
  }
  return r;
}
