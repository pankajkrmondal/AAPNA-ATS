/**
 * Duplicate className guard.
 *
 * A JSX element with two `className` attributes keeps only the LAST — React drops the
 * first silently, the page still renders, and whatever the first class encoded is gone.
 * Stage 5.2 shipped this on MrfApprovalAction (the approve/reject colour distinction
 * vanished from a page external approvers act on) and a scripted edit in 5.3
 * reintroduced it four times within the hour, because replacing `style={{...}}` with
 * `className="..."` on an element that already has one produces exactly this.
 *
 * WHY THIS IS A SCANNER AND NOT A REGEX
 * The first version of this check was a regex, and it silently skipped every element
 * whose attributes nested braces three deep — `styles={{ body: { padding: 0 } }}`,
 * which is how every AntD Card in this app sets body padding. It reported two hits and
 * missed two more on the same page. A regex cannot count matched delimiters; this walks
 * them. Attribute values inside braces or quotes are skipped, so nested JSX
 * (`title={<span className=…>}`) never counts as a duplicate.
 */
import fs from 'fs';
import path from 'path';
import { Report } from './lib.mjs';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

/** Attributes of each JSX opening tag in `src`, with braces/quotes balanced. */
function* openingTags(src) {
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<') continue;
    if (!/[A-Za-z]/.test(src[i + 1] || '')) continue;
    let j = i + 1;
    while (j < src.length && /[\w.]/.test(src[j])) j++;
    if (j === i + 1) continue;
    const start = j;
    let depth = 0, quote = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; continue; }
      if (c === '>' && depth === 0) break;
      if (c === '<' && depth === 0) { j = -1; break; }   // not a tag after all
    }
    if (j < 0 || j >= src.length) continue;
    yield { index: i, attrs: src.slice(start, j), tag: src.slice(i, j + 1) };
    i = j;
  }
}

/** Count className= at attribute level only — skip anything inside braces or quotes. */
function topLevelClassNames(attrs) {
  let depth = 0, quote = null, n = 0;
  for (let i = 0; i < attrs.length; i++) {
    const c = attrs[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (depth === 0 && attrs.startsWith('className', i) && /[\s=]/.test(attrs[i + 9] || '')) n++;
  }
  return n;
}

export default async function run() {
  const hits = [];
  for (const f of walk('src').filter((x) => x.endsWith('.jsx'))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const t of openingTags(s)) {
      if (topLevelClassNames(t.attrs) > 1) {
        const line = s.slice(0, t.index).split('\n').length;
        hits.push(f + ':' + line + '  ' + t.tag.slice(0, 90).replace(/\s+/g, ' '));
      }
    }
  }
  const r = new Report('duplicate className');
  r.add('no element carries two className attributes', hits.length === 0,
    hits.length ? '\n    ' + hits.join('\n    ') : `(${countTags()} tags scanned)`);
  return r;
}

function countTags() {
  let n = 0;
  for (const f of walk('src').filter((x) => x.endsWith('.jsx'))) {
    for (const _ of openingTags(fs.readFileSync(f, 'utf8'))) n++;
  }
  return n;
}
