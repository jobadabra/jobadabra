// Practice mode, main process side (spec 2026-11-07-practice-jobs-design.md, PR 3/4): the launcher (practice/launch.mjs) starts the app with the catcher's ledger file in the
// environment; this reads it for the window's banner and the job drawer's "What would have been sent". Read only from the environment: no setting, no IPC turns it on.
// Why (7 Nov 2026, pj 3/4): a person's app never has the ledger variable, and a packaged build ignores it even when set, so a release can show neither the banner nor the section.
// Guard: desktop/test/guards/safety/practice-isolation.test.js.
import fs from 'node:fs';

/** The catcher's ledger file for this run, or '' when this is not a practice run (no variable, a packaged app, or not the e2e-mode app the launcher starts). */
export function practiceLedger(env = process.env, packaged = false) {
  return !packaged && env.JOBADABRA_E2E === '1' && env.JOBADABRA_PRACTICE_LEDGER ? env.JOBADABRA_PRACTICE_LEDGER : '';
}

const where = url => { try { const parsed = new URL(url); return `${parsed.hostname}${parsed.pathname}`; } catch { return ''; } };

/** The submissions the catcher caught for the job at `url`, newest first: [{at, how, fields: [[name, value]], posted}]. A missing or half-written ledger is no entries. */
export function caughtFor(file, url) {
  if (!file || !where(url)) return [];
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const entries = [];
  for (const line of text.split('\n')) {
    try { const entry = JSON.parse(line); if (`${entry.host}${entry.path}` === where(url)) entries.push({at: entry.at, how: entry.how, fields: entry.fields, posted: !!entry.posted}); } catch { /* a blank or partly written line */ }
  }
  return entries.reverse();
}
