/**
 * Phase 3 "Do Now" section C — pure helpers.
 * Run: node --test src/tests/unit/sectionC.test.js
 *
 *   N17  Graph attachments, About AAPNA / JD-link blocks
 *   U02c About AAPNA copied into the Shortlist template (one-off script)
 *   N18  candidate field rules, city suggestions
 *   N22  phone helpers, the confirm-your-number block
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  companyBlockHtml, jdLinkHtml, phoneConfirmHtml, appendToBody, insertAfterIntro,
  placeJdLink, hasJdLinkSlot, JD_LINK_TOKEN, JD_LINK_PLACEHOLDER,
} from '../../utils/candidateEmailBlocks.js';
import { firstValidPhone, toIndianE164, maskPhone } from '../../utils/phone.js';
import { validateCandidateFields, describeFieldErrors } from '../../utils/candidateFieldRules.js';
import { rankCities } from '../../services/candidateFormOptions.service.js';
import { buildGraphAttachments } from '../../services/emailNotification.service.js';
import { fmtIstDate } from '../../utils/missingDetails.js';
import { addAboutAapna, resultLine as aboutAapnaLine } from '../../../scripts/move-about-aapna-into-shortlist-template.mjs';

describe('N17 email pieces', () => {
  test('Graph fileAttachment shape; incomplete entries dropped', () => {
    const out = buildGraphAttachments([
      { name: 'JD.pdf', contentType: 'application/pdf', contentBytes: 'QUJD' },
      { name: 'no-bytes.pdf' },
      null,
    ]);
    assert.deepEqual(out, [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'JD.pdf', contentType: 'application/pdf', contentBytes: 'QUJD' }]);
    assert.equal(buildGraphAttachments([{ name: 'x', contentBytes: 'QQ==' }])[0].contentType, 'application/octet-stream');
  });

  test('About AAPNA: escaped, line breaks kept, empty adds nothing', () => {
    assert.equal(companyBlockHtml('   '), '');
    const html = companyBlockHtml('AAPNA <b>Infotech</b>\nNoida');
    assert.match(html, /About AAPNA/);
    assert.match(html, /AAPNA &lt;b&gt;Infotech&lt;\/b&gt;<br>Noida/);
  });

  test('JD link only for http(s) links', () => {
    assert.match(jdLinkHtml('https://x.sharepoint.com/jd.pdf'), /href="https:\/\/x\.sharepoint\.com\/jd\.pdf"/);
    assert.equal(jdLinkHtml('javascript:alert(1)'), '');
    assert.equal(jdLinkHtml(null), '');
  });

  test('JD card: table, title, a button that opens in a new tab, href escaped', () => {
    const html = jdLinkHtml('https://x.sharepoint.com/jd.pdf?a=1&b="2"');
    assert.match(html, /^<table role="presentation"[^>]*>.*<\/table>$/);
    assert.match(html, />Job Description</);
    assert.match(html, /<a href="https:\/\/x\.sharepoint\.com\/jd\.pdf\?a=1&amp;b=&quot;2&quot;" target="_blank"[^>]*>View Job Description<\/a>/);
    assert.doesNotMatch(html, /View the job description:/);
  });

  test('no sign-off: blocks go before </body> of a full document, else at the end', () => {
    assert.equal(appendToBody('<html><body><p>Hi</p></body></html>', '<p>X</p>'), '<html><body><p>Hi</p><p>X</p></body></html>');
    assert.equal(appendToBody('<p>Hi</p>', '', '<p>X</p>'), '<p>Hi</p><p>X</p>');
    assert.equal(appendToBody('<p>Hi</p>', '', ''), '<p>Hi</p>');
  });

  const CARD_DOC = '<html><body><table><tr><td>Intro</td></tr>'
    + '<tr><td style="padding:0 40px"><p>Best regards,</p><p>Team</p></td></tr>'
    + '<tr><td>footer</td></tr></table></body></html>';

  test('full document with a sign-off row: a new card row just above it', () => {
    assert.equal(appendToBody(CARD_DOC, '<p>X</p>'),
      '<html><body><table><tr><td>Intro</td></tr>'
      + '<tr><td style="padding:0 40px 24px 40px;"><p>X</p></td></tr>'
      + '<tr><td style="padding:0 40px"><p>Best regards,</p><p>Team</p></td></tr>'
      + '<tr><td>footer</td></tr></table></body></html>');
  });

  test('full document whose sign-off is outside any row: before </body>', () => {
    const doc = '<html><body><table><tr><td>Intro</td></tr></table><p>Best regards,</p></body></html>';
    assert.equal(appendToBody(doc, '<p>X</p>'), '<html><body><table><tr><td>Intro</td></tr></table><p>Best regards,</p><p>X</p></body></html>');
  });

  test('fragment ending in its own sign-off: blocks go before it', () => {
    assert.equal(appendToBody('<p>Hi</p><p>Best regards,<br>HR</p>', '<p>X</p>'), '<p>Hi</p><p>X</p><p>Best regards,<br>HR</p>');
    assert.equal(appendToBody('<div><p>Hi</p><p>Regards,<br>HR</p></div>', '<p>X</p>'), '<div><p>Hi</p><p>X</p><p>Regards,<br>HR</p></div>');
    // a sign-off far from the end is not the email's sign-off
    const long = `<p>Best regards from the team on this.</p><p>${'x'.repeat(500)}</p>`;
    assert.equal(appendToBody(long, '<p>X</p>'), `${long}<p>X</p>`);
  });

  test('after the intro: right after the marked paragraph, the last marker wins', () => {
    const doc = '<html><body><p data-ats-intro="1">Intro</p><p>Next</p>' + CARD_DOC.slice('<html><body>'.length);
    assert.match(insertAfterIntro(doc, '<p>X</p>'), /<p data-ats-intro="1">Intro<\/p><p>X<\/p><p>Next<\/p>/);
    const split = '<p data-ats-intro="1">One</p><p data-ats-intro="1">Two</p><p>Next</p>';
    assert.equal(insertAfterIntro(split, '<p>X</p>'), '<p data-ats-intro="1">One</p><p data-ats-intro="1">Two</p><p>X</p><p>Next</p>');
    assert.equal(insertAfterIntro(split, '', ''), split);
  });

  test('after the intro, no marker (deleted in the editor): above the sign-off', () => {
    assert.equal(insertAfterIntro(CARD_DOC, '<p>X</p>'), appendToBody(CARD_DOC, '<p>X</p>'));
  });
});

describe('U02c: About AAPNA into the Shortlist template', () => {
  const DOC = '<html><body><table><tr><td>Intro</td></tr>'
    + '<tr><td><p>Best regards,<br/>AAPNA Infotech Recruitment Team</p></td></tr></table></body></html>';

  test('added once, above the sign-off, inside the card', () => {
    const out = addAboutAapna(DOC, 'AAPNA Infotech\nNoida');
    assert.equal(out.changed, true);
    assert.equal(out.reason, 'added');
    assert.ok(out.body.indexOf('About AAPNA') < out.body.indexOf('Best regards'));
    assert.match(out.body, /AAPNA Infotech<br>Noida/);
    assert.equal(out.body.match(/About AAPNA/g).length, 1);
  });

  test('a second run, or a body that already has it, changes nothing', () => {
    const once = addAboutAapna(DOC, 'AAPNA Infotech').body;
    assert.deepEqual(addAboutAapna(once, 'Other text'), { changed: false, body: once, reason: 'already_there' });
    const hrCopy = '<p>About  aapna: we build software.</p><p>Best regards,</p>';
    assert.equal(addAboutAapna(hrCopy, 'AAPNA Infotech').reason, 'already_there');
  });

  test('empty Settings text adds nothing', () => {
    assert.deepEqual(addAboutAapna(DOC, '   '), { changed: false, body: DOC, reason: 'no_text' });
    assert.equal(addAboutAapna(null, '').body, '');
  });

  test('result line per row', () => {
    const row = { id: 2, name: 'Shortlist Notification' };
    assert.match(aboutAapnaLine(row, 'added', false), /would be added .*--apply/);
    assert.match(aboutAapnaLine(row, 'added', true), /^Shortlist Notification \(#2\): About AAPNA added/);
    assert.match(aboutAapnaLine(row, 'already_there', true), /left as is/);
    assert.match(aboutAapnaLine(row, 'no_text', true), /nothing to add/);
  });
});

describe('U02b: the JD card at {{jd_link}}', () => {
  const CARD = '<table><tr><td>JD</td></tr></table>';

  test('a paragraph holding only the token is replaced whole (no table inside a <p>)', () => {
    assert.equal(placeJdLink(`<p>Hi</p><p>${JD_LINK_TOKEN}</p><p>Thanks</p>`, CARD), `<p>Hi</p>${CARD}<p>Thanks</p>`);
    assert.equal(placeJdLink('<p>Hi</p><p style="margin:0">&nbsp;{{ jd_link }}<br></p>', CARD), `<p>Hi</p>${CARD}`);
  });

  test('a token inside text, and the single-brace style', () => {
    assert.equal(placeJdLink(`<p>Read this: ${JD_LINK_TOKEN}</p>`, CARD), `<p>Read this: ${CARD}</p>`);
    assert.equal(placeJdLink('<p>a</p>{jd_link}', CARD), `<p>a</p>${CARD}`);
  });

  test('the preview marker, also after an editor re-serialised it', () => {
    assert.equal(placeJdLink(`<p>Hi</p>${JD_LINK_PLACEHOLDER}<p>Bye</p>`, CARD), `<p>Hi</p>${CARD}<p>Bye</p>`);
    const reserialised = '<p>Hi</p><div style="margin: 14px 0px;" data-ats-jd-link="1">The Job Description card goes here.</div>';
    assert.equal(placeJdLink(reserialised, CARD), `<p>Hi</p>${CARD}`);
    assert.equal(hasJdLinkSlot(reserialised), true);
  });

  test('only the first slot gets the card; the others are removed', () => {
    assert.equal(placeJdLink(`<p>${JD_LINK_TOKEN}</p><p>x</p>${JD_LINK_TOKEN}`, CARD), `${CARD}<p>x</p>`);
  });

  test('no token: as before (appended above the sign-off, or the caller\'s fallback)', () => {
    const doc = '<html><body><table><tr><td>Intro</td></tr><tr><td>Best regards,<br>HR</td></tr></table></body></html>';
    assert.equal(hasJdLinkSlot(doc), false);
    assert.equal(placeJdLink(doc, CARD), appendToBody(doc, CARD));
    assert.match(placeJdLink(doc, CARD), /JD<\/td><\/tr><\/table><\/td><\/tr><tr><td>Best regards/);
    const intro = '<p data-ats-intro="1">Intro</p><p>Next</p>';
    assert.equal(placeJdLink(intro, CARD, { fallback: insertAfterIntro }), `<p data-ats-intro="1">Intro</p>${CARD}<p>Next</p>`);
  });

  test('no card (JD attached, switched off or missing): every slot goes, the rest is untouched', () => {
    assert.equal(placeJdLink(`<p>Hi</p><p>${JD_LINK_TOKEN}</p>`, ''), '<p>Hi</p>');
    assert.equal(placeJdLink(`<p>Hi</p>${JD_LINK_PLACEHOLDER}`, ''), '<p>Hi</p>');
    assert.equal(placeJdLink('<p>Hi</p>', ''), '<p>Hi</p>');
    assert.equal(placeJdLink(null, ''), '');
  });
});

describe('N21 cool-off dates', () => {
  test('IST date reads like the screens: Sep, never Sept', () => {
    assert.equal(fmtIstDate('2026-09-25T06:00:00Z'), '25 Sep 2026');
    assert.equal(fmtIstDate('2026-10-06T20:00:00Z'), '07 Oct 2026');
  });
});

describe('N22 phone', () => {
  test('first valid number, +91 form, masking', () => {
    assert.equal(firstValidPhone('+91 98765 43210, 080-1234'), '9876543210');
    assert.equal(firstValidPhone('12345'), null);
    assert.equal(toIndianE164('098765-43210'), '+919876543210');
    assert.equal(toIndianE164(''), '');
    assert.equal(maskPhone('+91 98765 43210'), '******3210');
    assert.equal(maskPhone(null), '(none)');
  });

  test('confirm-your-number block links to the form', () => {
    const html = phoneConfirmHtml('http://localhost:5174/missing-jd-upload?token=abc');
    assert.match(html, /Confirm your mobile number/);
    assert.match(html, /token=abc/);
  });
});

describe('N18 field rules', () => {
  test('valid values pass; only sent fields are checked', () => {
    assert.deepEqual(validateCandidateFields({
      ContactNumber: '+91 98765 43210', EmailID: 'a@b.co', CTC_LPA: '8', ExpectedCTC_LPA: 12.5,
      TotalExperienceYears: '3', LastCompanyExperienceYears: '1.5', a10th: '88', graduation: 72.5,
    }), []);
    assert.deepEqual(validateCandidateFields({}), []);
  });

  test('each rule has a plain message', () => {
    const errs = validateCandidateFields({
      ContactNumber: '98765', EmailID: 'nope', CTC_LPA: '250', ExpectedCTC_LPA: '12 LPA', a12th: '101',
    });
    assert.deepEqual(errs.map((e) => e.field), ['ContactNumber', 'EmailID', 'CTC_LPA', 'ExpectedCTC_LPA', 'a12th']);
    assert.match(describeFieldErrors(errs), /10-digit mobile number/);
    assert.match(describeFieldErrors(errs), /between 0 and 200/);
    assert.match(describeFieldErrors(errs), /must be a number/);
  });

  test('last-company experience cannot exceed total, using the stored total when only one is sent', () => {
    assert.match(validateCandidateFields({ TotalExperienceYears: '3', LastCompanyExperienceYears: '4' })[0].message, /more than total experience \(3 years\)/);
    assert.equal(validateCandidateFields({ LastCompanyExperienceYears: '4' }, { TotalExperienceYears: '3' }).length, 1);
    // A stored legacy value like "3 years" is not a number: no comparison, no error.
    assert.equal(validateCandidateFields({ LastCompanyExperienceYears: '4' }, { TotalExperienceYears: '3 years' }).length, 0);
  });
});

describe('N18 city suggestions', () => {
  test('every comma part counts; most common first; junk and pin codes dropped', () => {
    const cities = rankCities([
      { location: 'Noida, Uttar Pradesh', n: 10 },
      { location: 'Greater Noida', n: 4 },
      { location: 'noida', n: 5 },
      { location: '201301', n: 50 },
      { location: 'Pune (MH)', n: 3 },
    ]);
    assert.deepEqual(cities, ['Noida', 'Uttar Pradesh', 'Greater Noida', 'Pune']);
    assert.equal(rankCities([{ location: 'A1', n: 1 }, { location: 'Delhi', n: 1 }], 1).length, 1);
  });
});
