/**
 * Global setup/teardown for playwright.u01.config.js: a short-lived staff
 * session minted by staffSession.mjs (no password, no Turnstile), saved as the
 * run's storageState, and deleted again afterwards.
 *
 * E2E_SESSION_EMAIL names the staff account to sign in as.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '../../../backend');
const helper = path.resolve(here, 'staffSession.mjs');
export const U01_STATE = path.resolve(here, '../.auth/u01-state.json');
const SESSION_FILE = path.resolve(here, '../.auth/u01-session.json');

function runHelper(args) {
  const out = execFileSync(process.execPath, [helper, ...args], { cwd: backendDir, encoding: 'utf8' });
  // Prisma's debug logger shares stdout; the helper's answer is the JSON line.
  const line = out.split(/\r?\n/).reverse().find((l) => l.startsWith('{"'));
  if (!line) throw new Error(`staffSession.mjs gave no answer:\n${out.slice(-500)}`);
  return JSON.parse(line);
}

export default async function globalSetup(config) {
  const email = process.env.E2E_SESSION_EMAIL;
  if (!email) throw new Error('Set E2E_SESSION_EMAIL to the staff account the run signs in as.');
  const { token, sessionId, user } = runHelper(['create', email]);
  const { baseURL } = config.projects[0].use;
  mkdirSync(path.dirname(U01_STATE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify({ sessionId }));
  writeFileSync(U01_STATE, JSON.stringify({
    cookies: [],
    origins: [{
      origin: new URL(baseURL).origin,
      localStorage: [
        { name: 'ats_token', value: token },
        { name: 'ats_user', value: JSON.stringify(user) },
      ],
    }],
  }));

  // Teardown: the session and the saved token are removed whatever happened.
  return async () => {
    try {
      const { sessionId: id } = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
      runHelper(['delete', id]);
    } finally {
      rmSync(SESSION_FILE, { force: true });
      rmSync(U01_STATE, { force: true });
    }
  };
}
