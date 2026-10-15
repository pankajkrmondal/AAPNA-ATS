/**
 * Phase 3 "Do Now" section C — pure helpers.
 * Run: node --test src/tests/unit/sectionC.test.js
 *
 *   N17  Graph attachments, About AAPNA / JD-link blocks
 *   N18  candidate field rules, city suggestions
 *   N22  phone helpers, the confirm-your-number block
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { companyBlockHtml, jdLinkHtml, phoneConfirmHtml, appendToBody } from '../../utils/candidateEmailBlocks.js';
import { firstValidPhone, toIndianE164, maskPhone } from '../../utils/phone.js';
import { validateCandidateFields, describeFieldErrors } from '../../utils/candidateFieldRules.js';
import { rankCities } from '../../services/candidateFormOptions.service.js';
import { buildGraphAttachments } from '../../services/emailNotification.service.js';
import { fmtIstDate } from '../../utils/missingDetails.js';

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

  test('blocks go before </body> of a full document, else at the end', () => {
    assert.equal(appendToBody('<html><body><p>Hi</p></body></html>', '<p>X</p>'), '<html><body><p>Hi</p><p>X</p></body></html>');
    assert.equal(appendToBody('<p>Hi</p>', '', '<p>X</p>'), '<p>Hi</p><p>X</p>');
    assert.equal(appendToBody('<p>Hi</p>', '', ''), '<p>Hi</p>');
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
