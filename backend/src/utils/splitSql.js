/**
 * Split a SQL script into statements on top-level semicolons, respecting
 * '-- comments', block comments, 'strings' (with '' escapes), "identifiers" and
 * $tag$ dollar-quoted bodies (plpgsql functions). Used by scripts/run-ddl.mjs,
 * which has to execute a DDL file statement by statement inside one
 * transaction (Prisma cannot run a multi-statement string).
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitSql(text) {
  const out = [];
  let cur = '';
  let i = 0;
  const hasCode = (s) => s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim().length > 0;
  while (i < text.length) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    if (two === '--') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      cur += text.slice(i, stop); i = stop; continue;
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      cur += text.slice(i, stop); i = stop; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === c) { if (text[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      cur += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '$') {
      const m = text.slice(i).match(/^\$[A-Za-z_]*\$/);
      if (m) {
        const tag = m[0];
        const end = text.indexOf(tag, i + tag.length);
        const stop = end === -1 ? text.length : end + tag.length;
        cur += text.slice(i, stop); i = stop; continue;
      }
    }
    if (c === ';') {
      if (hasCode(cur)) out.push(cur.trim());
      cur = ''; i++; continue;
    }
    cur += c; i++;
  }
  if (hasCode(cur)) out.push(cur.trim());
  return out;
}

export default splitSql;
