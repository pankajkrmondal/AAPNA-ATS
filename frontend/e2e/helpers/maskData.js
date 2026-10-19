/**
 * Replaces personal data in every API response before the page sees it, so a
 * screenshot taken against staging shows sample people, not real candidates
 * (user guides, N43).
 *
 *   await maskApiResponses(page);   // before the first page.goto
 *
 * Three passes over each JSON response:
 *   1. values of person keys (Name, candidate_name, EmailID, ContactNumber,
 *      interviewer_name, shortlisted_by, …) get stable sample values — the
 *      same real value always becomes the same sample within a run;
 *   2. every other string has those real names replaced too (AI summaries,
 *      notes and subjects mention the candidate by name), plus any email
 *      address or phone number left in free text;
 *   3. free-text notes are replaced outright.
 *
 * View-only by design: requests are passed through unchanged; only the
 * response the browser receives is rewritten.
 */

const FIRST = ['Asha', 'Ravi', 'Meera', 'Karan', 'Priya', 'Arjun', 'Neha', 'Vikram', 'Divya', 'Rohan', 'Isha', 'Sameer', 'Tara', 'Kabir', 'Ananya', 'Dev'];
const LAST = ['Sharma', 'Verma', 'Iyer', 'Nair', 'Gupta', 'Rao', 'Mehta', 'Das', 'Kapoor', 'Joshi', 'Reddy', 'Bose'];

const NAME_KEYS = /^(name|full_?name|candidate_?name|first_?name|last_?name|user_?name|username|display_?name|interviewer_?name|recruiter_?name|recruiter|shortlisted_?by|uploaded_?by|uploader|created_?by_?name|acted_?by_?name|referrer_?name|referred_?by|vendor_?name|owner_?name|approver_?name|decided_?by|hiring_?manager|manager_?name|raised_?by|requested_?by|confirmed_?by|occurrence_confirmed_by|rejected_?by|modified_?by|owner|[a-z_]+_by|[a-z]+By)$/i;
const EMAIL_KEYS = /(^|_)(email|emailid|email_?id|mail|e_?mail|upn|candidate_email_all|vendor_email|interviewer_email|recipient_email|from|to|cc)$/i;
const PHONE_KEYS = /(contact_?number|phone|mobile|whatsapp)/i;
const FREE_TEXT_KEYS = /^(notes|recruiter_notes|stage_notes|comment|comments|remarks|reason_text|feedback|body_preview|bodypreview|snippet|last_message|message_preview)$/i;
const SKIP_KEYS = /^(stage_?name|template_?name|company_?name|position|position_?applied|role|role_?name|job_?title|title|label|status|key|stage_key|module|source)$/i;

// A plain "name" is a person's only inside a record that also carries an
// email or phone (a candidate, a user); elsewhere it names a template, stage
// or company and is left alone.
const GENERIC_NAME_KEYS = /^(name|full_?name|display_?name|user_?name|username)$/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<![\w.])\+?\d[\d ().-]{8,16}\d(?![\w])/g;

function createMasker() {
  const people = new Map(); // real lower-cased name → sample name
  let n = 0;
  const sampleName = (real) => {
    const k = real.trim().toLowerCase();
    if (!people.has(k)) {
      const i = n++;
      people.set(k, `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`);
    }
    return people.get(k);
  };
  const emailOwner = new Map(); // real lower-cased email → real name seen beside it
  const sampleEmail = (real) => {
    const key = String(real).trim().toLowerCase();
    const owner = emailOwner.get(key);
    const name = sampleName(owner || key.split('@')[0].replace(/[._-]+/g, ' '));
    return `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`;
  };
  let phoneN = 0;
  const phones = new Map();
  const samplePhone = (real) => {
    if (!phones.has(real)) phones.set(real, `+91 90000 ${String(10000 + phoneN++).slice(-5)}`);
    return phones.get(real);
  };

  const personLike = (obj) => Object.entries(obj).some(([k, v]) => typeof v === 'string'
    && ((EMAIL_KEYS.test(k) && v.includes('@')) || (PHONE_KEYS.test(k) && /\d{6,}/.test(v.replace(/\D/g, ''))) || /^(first|last)_?name$/i.test(k)));
  const isPersonNameKey = (key, inPerson) => NAME_KEYS.test(key) && !SKIP_KEYS.test(key)
    && (!GENERIC_NAME_KEYS.test(key) || inPerson);

  function collect(value, key = '', inPerson = false) {
    if (Array.isArray(value)) { value.forEach((v) => collect(v, key, inPerson)); return; }
    if (value && typeof value === 'object') {
      const person = personLike(value);
      // A name and an email side by side belong to one person: give the
      // sample email the same sample name.
      const entries = Object.entries(value);
      const nameEntry = entries.find(([k, v]) => typeof v === 'string' && isPersonNameKey(k, person) && !/^(first|last)_?name$/i.test(k) && /[A-Za-z]{2}/.test(v) && !v.includes('@'));
      if (nameEntry) {
        for (const [k, v] of entries) {
          if (typeof v === 'string' && EMAIL_KEYS.test(k) && v.includes('@')) {
            for (const one of v.split(/\s*,\s*/)) if (!emailOwner.has(one.toLowerCase())) emailOwner.set(one.toLowerCase(), nameEntry[1]);
          }
        }
      }
      for (const [k, v] of entries) collect(v, k, person);
      return;
    }
    if (typeof value === 'string' && isPersonNameKey(key, inPerson) && /[A-Za-z]{2}/.test(value) && !value.includes('@')) {
      sampleName(value);
    }
  }

  function scrubText(s) {
    let out = s.replace(EMAIL_RE, (m) => sampleEmail(m)).replace(PHONE_RE, (m) => (m.replace(/\D/g, '').length >= 10 ? samplePhone(m) : m));
    for (const [real, fake] of people) {
      if (real.length < 3) continue;
      const esc = real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`\\b${esc}\\b`, 'gi'), fake);
      const [firstReal] = real.split(/\s+/);
      const [firstFake] = fake.split(' ');
      if (firstReal && firstReal.length >= 4) {
        out = out.replace(new RegExp(`\\b${firstReal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), firstFake);
      }
    }
    return out;
  }

  function rewrite(value, key = '', inPerson = false) {
    if (Array.isArray(value)) return value.map((v) => rewrite(v, key, inPerson));
    if (value && typeof value === 'object') {
      const person = personLike(value);
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, k, person);
      return out;
    }
    if (typeof value !== 'string' || value === '') return value;
    if (SKIP_KEYS.test(key)) return scrubText(value);
    if (FREE_TEXT_KEYS.test(key)) return 'Sample note';
    if (EMAIL_KEYS.test(key) && value.includes('@')) return value.split(/\s*,\s*/).map(sampleEmail).join(', ');
    if (PHONE_KEYS.test(key) && /\d{6,}/.test(value.replace(/\D/g, ''))) return samplePhone(value);
    if (/^first_?name$/i.test(key) && /[A-Za-z]/.test(value)) return sampleName(value).split(' ')[0];
    if (/^last_?name$/i.test(key) && /[A-Za-z]/.test(value)) return sampleName(value).split(' ')[1];
    if (isPersonNameKey(key, inPerson) && /[A-Za-z]{2}/.test(value) && !value.includes('@')) return sampleName(value);
    return scrubText(value);
  }

  return (json) => { collect(json); return rewrite(json); };
}

/** Install the response rewrite on every /api call of this page. */
export async function maskApiResponses(page) {
  const mask = createMasker();
  await page.route('**/api/**', async (route) => {
    const response = await route.fetch();
    const type = response.headers()['content-type'] || '';
    if (!type.includes('application/json')) return route.fulfill({ response });
    let body;
    try { body = await response.json(); } catch { return route.fulfill({ response }); }
    return route.fulfill({ response, json: mask(body) });
  });
  // The signed-in user's name in the header comes from localStorage.
  await page.addInitScript(() => {
    try {
      const raw = localStorage.getItem('ats_user');
      if (raw) {
        const u = JSON.parse(raw);
        localStorage.setItem('ats_user', JSON.stringify({ ...u, first_name: 'Sample', last_name: 'Recruiter', username: 'sample.recruiter', email: 'sample.recruiter@example.com' }));
      }
    } catch { /* ignore */ }
  });
}

export { createMasker };
