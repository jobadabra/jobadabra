// The evidence bundle an AI tester's "Send feedback" files in tester mode (lib/tester-mode.js): the tester's report, the app window, the log lines of the minutes around the bug, the session record
// and job row, and the versions. Built from the held redacted copy plus the same `redact()` as the real feedback; sent only to the tester route (jobadabra-web shared/bug-bundles.js), never to /api/feedback.
// Pure helpers (files, clock and fetch come in as arguments). Design: docs/superpowers/specs/2026-11-07-ai-tester-bug-reports-design.md.
// Why (7 Nov 2026, owner: bugs filed by AI "with screenshots, logs, state/profile"): a sentence is not enough for another agent to replay a bug. The Profile snapshot and CV text are NOT part of it.
// Guard: desktop/test/unit/main/tester-bundle.test.js (the send never reaches /api/feedback; redaction; caps; the window of minutes).
import path from 'node:path';
import os from 'node:os';
import {redact, lastLines, runLines, stateLines, MAX_LOGS_BYTES, MAX_DATA_BYTES} from './feedback-bundle.js';

export const TESTER_ENDPOINT = 'https://www.jobadabra.top/agent/bundle';
export const SEVERITIES = ['high', 'medium', 'low'];
export const WINDOW_MINUTES = 5;
const LOG_READ_LINES = 20000;   // lastLines reads at most the last 512 KB of a file; this is the line cap on top

/** The tester's report as the site stores it, or why it is refused. `input`: {title, journey, expected, seen, severity, steps (array, or text with a step a line)}. -> {report} | {error} */
export function testerReport(input = {}, at = new Date()) {
  const text = value => String(value ?? '').trim();
  const severity = text(input.severity).toLowerCase();
  if (!SEVERITIES.includes(severity)) return {error: 'Severity is high, medium or low.'};
  const expected = text(input.expected), seen = text(input.seen);
  if (!expected || !seen) return {error: 'Write what you expected and what you saw.'};
  const steps = (Array.isArray(input.steps) ? input.steps : text(input.steps).split('\n')).map(text).filter(Boolean);
  const title = text(input.title) || seen.slice(0, 100);
  return {report: {title, journey: text(input.journey) || 'none', severity, expected, seen, steps, at: at.toISOString()}};
}

/**
 * The lines within `minutes` of `at`. A line's time is its own ISO timestamp (the first token, lib/log.js format), else untimed lines inherit the time of the last timed line above them: engine.log holds the engine's raw output between
 * two timed run markers (lib/engine-log.js), and a wrapped line belongs to the line it wraps. Lines before any timed line are dropped. -> lines, oldest first
 * Why (Gitar on #3406): keeping only timed lines left just the run markers of engine.log and none of what the engine printed.
 */
export function windowLines(lines, at, minutes = WINDOW_MINUTES) {
  const centre = at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(centre)) return [];
  let last = NaN;
  return (Array.isArray(lines) ? lines : []).filter(line => {
    const own = Date.parse(String(line).split(' ', 1)[0]);
    if (Number.isFinite(own)) last = own;
    return Number.isFinite(last) && Math.abs(last - centre) <= minutes * 60000;
  });
}

/**
 * The logs text of a bundle, redacted: the support state, the last runs, then the app and engine log lines within ±5 minutes of `at` (the extension's lines are in app.log among them).
 * Over the cap the oldest lines go. -> {text, bytes, lines: {app, engine}}
 */
export function testerLogs({folder, runs = [], state = {}, at, home = os.homedir(), max = MAX_LOGS_BYTES}) {
  const app = windowLines(lastLines(path.join(folder, 'app.log'), LOG_READ_LINES), at), engine = windowLines(lastLines(path.join(folder, 'engine.log'), LOG_READ_LINES), at);
  const head = redact(['== Support state ==', ...stateLines(state), '', '== Last runs (newest first) ==', ...(runLines(runs).length ? runLines(runs) : ['none yet']), ''].join('\n'), {home});
  const sections = [['app.log', app], ['engine.log', engine]];
  const bytes = value => Buffer.byteLength(value);
  const draw = lists => sections.flatMap(([name], index) => (lists[index].length ? [`== ${name} (${lists[index].length} lines within ${WINDOW_MINUTES} minutes of ${new Date(at).toISOString()}) ==`, ...lists[index], ''] : []));
  const lists = [app.map(line => redact(line, {home})), engine.map(line => redact(line, {home}))];
  let body = draw(lists).join('\n');
  while (bytes(head) + bytes(body) + 80 > max && lists.some(list => list.length)) {   // cut the oldest lines of the longer list
    const longer = lists[0].length >= lists[1].length ? 0 : 1;
    lists[longer] = lists[longer].slice(Math.ceil(lists[longer].length / 10));
    body = draw(lists).join('\n');
  }
  const text = `${head}\n${body}`;
  return {text, bytes: bytes(text), lines: {app: lists[0].length, engine: lists[1].length}};
}

// Redacts every string of a value, not the JSON text: `redact` on text can eat a closing quote ("?token=abc" in a url value), and state.json must stay parseable for the twin's replay.
const SECRET_KEY = /api[_-]?key|token|secret|passw(?:or)?d|cookie|credential|authorization|private[_-]?key|li_at|jsessionid/i;   // a field NAMED like a credential is dropped whole, whatever its value looks like
const redactDeep = (value, home) => (typeof value === 'string' ? redact(value, {home}) : Array.isArray(value) ? value.map(item => redactDeep(item, home))
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) && item !== null && typeof item !== 'object' ? '<secret>' : redactDeep(item, home)])) : value);

/** state.json: the session record(s) and the job row as stored, every string redacted, under the cap (valid JSON). `sessions`: terminals public views; `job`: the store's row for the focused session's page, or null. */
export function testerState({sessions = [], job = null}, {home = os.homedir(), max = MAX_DATA_BYTES} = {}) {
  const draw = value => JSON.stringify(redactDeep(value, home), null, 2);
  let text = draw({sessions, job});
  if (Buffer.byteLength(text) > max) text = draw({sessions: sessions.slice(-1), job, note: `cut: the full record was over ${Math.round(max / 1024)} KB`});
  return Buffer.byteLength(text) > max ? JSON.stringify({note: 'cut: over the cap'}) : text;
}

/** env.json: what a reader needs to match the checkout. `mode` is the focused session's saved mode id (check, fill or auto), the word behind the panel's mode chip. */
export const testerEnv = ({version, platform, extensionVersion = null, aiEngine, store, mode = null, source}) =>
  JSON.stringify({source, appVersion: version, extensionVersion: extensionVersion || 'not reported', os: platform, aiEngine, store, sessionMode: mode || 'none'}, null, 2);

/**
 * Sends the bundle. `files` holds text files and JPEG data URLs by their bundle names (logs.txt, state.json, env.json, app.jpg, tab.jpg); a missing one is left out.
 * -> {ok: true, id, url, skipped?} | {ok: false, error: <words>}. The endpoint is the tester route; the caller's key goes only in the Authorization header.
 */
export async function uploadBundle({source, key, report, files = {}}, {fetcher = globalThis.fetch, endpoint = TESTER_ENDPOINT} = {}) {
  const present = Object.fromEntries(Object.entries(files).filter(([, value]) => value));
  try {
    const response = await fetcher(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`}, body: JSON.stringify({source, report, files: present})});
    if (!response.ok) return {ok: false, error: `The bundle was not stored (${response.status}).`};
    const answer = await response.json().catch(() => ({}));
    if (!answer.id) return {ok: false, error: 'The site did not answer with a bundle id.'};
    return {ok: true, id: answer.id, url: answer.url, ...(answer.skipped?.length ? {skipped: answer.skipped} : {})};
  } catch (error) {
    return {ok: false, error: `The bundle was not stored: ${error.message}.`};
  }
}
