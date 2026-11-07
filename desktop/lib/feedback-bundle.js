// What "Send feedback" attaches: the app window's screenshot as a small JPEG, and one redacted text of the app's own logs, the last runs and the state that matters for support.
// Pure helpers (files and the clock come in as arguments), so a test can feed a log full of fake secrets and see none survive. Design: docs/superpowers/specs/2026-11-02-feedback-screenshot-logs-design.md
// in jobadabra-web. Why (2 Nov 2026, owner: "sends a screenshot with the app screen. and all the relevant logs"): a Windows tester's setup bug was only seen through a screen share.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAX_LOGS_BYTES = 190 * 1024;   // the site refuses over 200 KB (api/feedback.js); a little room for the note about what was cut
export const MAX_SHOT_BYTES = 1800 * 1024;  // the site's cap is 2 MB, counted on the decoded bytes
export const MAX_DATA_BYTES = 190 * 1024;   // the site's cap for the screen data and for the profile snapshot is 200 KB each (api/feedback.js TEXT_FILES)
export const PROFILE_CHARS = 60000;   // the snapshot's budget for aboutYou (the portrait's own is 12000)
export const APP_LINES = 400, ENGINE_LINES = 150, RUN_COUNT = 5, LINE_CHARS = 500;

const SECRET_SHAPES = [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, /\bsk-[\w-]{16,}/g, /\bntn_\w+/g, /\bsecret_\w{10,}/g, /\bgh[pousr]_\w+/g, /github_pat_\w+/g,
  /GOCSPX-[\w-]+/g, /\b\d{6,12}:AA[\w-]{20,}/g, /\bxox[abprs]-[\w-]+/g, /\bBearer\s+[\w.~+/-]+=*/gi, /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, /\bAIza[\w-]{30,}/g, /\bya29\.[\w-]+/g, /\bAKIA[0-9A-Z]{16}\b/g];
// A name that says it holds a credential, then its value (JSON, header, query or env style). LinkedIn's copied session (li_at, JSESSIONID …) is named here on purpose.
const SECRET_NAME = String.raw`[\w-]*(?:api[_-]?key|token|secret|passw(?:or)?d|cookie|li_at|li_rm|jsessionid|bcookie|lidc|csrf|credential|authorization|private[_-]?key)[\w-]*`;
const PAIR = new RegExp(String.raw`(["']?\b${SECRET_NAME}\b["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)`, 'gi');
const COOKIE_LINE = /^(.*\b(?:set-)?cookie\s*:\s*).*$/gim;
const OPAQUE = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g;
const EMAIL = /[\w.+%-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Secrets, e-mail addresses, link queries and the person's folder name out of any text, line by line. A line is cut to LINE_CHARS (a long line is where a copied text would hide).
 *  Why not telemetry.scrub: it also turns every 8+ digit run into <number>, which would eat the timestamps a log is read by. -> text */
export function redact(text, {home = os.homedir(), lineChars = LINE_CHARS} = {}) {
  let out = String(text ?? '');
  for (const form of new Set([home, home && home.replace(/\\/g, '\\\\'), home && home.replace(/\\/g, '/')])) if (form && form.length > 3) out = out.split(form).join('~');
  // A folder name may hold a space (C:\Users\Ana Fake\…): when a separator follows, everything up to it is the name; else the name ends at the first space.
  for (const [start, name] of [[/([A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/))/gi, String.raw`[^\\/"'<>|:\n]+`], [/(\/(?:Users|home)\/)/g, String.raw`[^/"'<>|:\n]+`]]) {
    out = out.replace(new RegExp(`${start.source}${name}(?=[\\\\/])`, start.flags), '$1…').replace(new RegExp(`${start.source}[^\\s\\\\/"'<>|:]+`, start.flags), '$1…');
  }
  out = out.replace(COOKIE_LINE, '$1<secret>');
  for (const shape of SECRET_SHAPES) out = out.replace(shape, '<secret>');
  out = out.replace(PAIR, (_, name, value) => `${name}${/^["']/.test(value) ? `${value[0]}<secret>${value[0]}` : '<secret>'}`);
  out = out.replace(EMAIL, '<email>').replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1').replace(OPAQUE, '<secret>');
  return out.split('\n').map(line => (line.length > lineChars ? `${line.slice(0, lineChars)}… (+${line.length - lineChars} chars)` : line)).join('\n');
}

// The last `count` lines of a file, oldest first ([] when it is missing or unreadable). Reads at most the last 512 KB.
export function lastLines(file, count) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return []; }
  try {
    const size = fs.fstatSync(fd).size, read = Math.min(size, 512 * 1024), buffer = Buffer.alloc(read);
    fs.readSync(fd, buffer, 0, read, size - read);
    const lines = buffer.toString('utf8').split('\n');
    if (size > read) lines.shift();   // the first one starts before what was read
    return lines.filter(Boolean).slice(-count);
  } catch { return []; } finally { fs.closeSync(fd); }
}

// The log of the last days that has lines: today's file, else the newest day file (app-YYYY-MM-DD.log). -> lines, oldest first
function newestLog(folder, name, count) {
  const today = lastLines(path.join(folder, `${name}.log`), count);
  if (today.length) return today;
  let days = [];
  try { days = fs.readdirSync(folder).filter(file => new RegExp(`^${name}-\\d{4}-\\d{2}-\\d{2}\\.log$`).test(file)).sort().reverse(); } catch { /* no folder */ }
  for (const file of days) { const lines = lastLines(path.join(folder, file), count); if (lines.length) return lines; }
  return [];
}

const fmt = value => (value === undefined || value === null || value === '' ? '-' : String(value));

export const WARN_RUNS = 3, WARN_LINES = 5, WARN_CHARS = 160;
const LINKED = /:\/\/|\bwww\./i;
// The engine's own warning lines, as fixed sentences. Why (#3071, 5 Nov 2026; /code-review: a prefix-only allow-list let `Skipped job 7: Claude Code failed: <the posting's words>` through):
// a line is never sent as it was written. Each shape below BUILDS the sentence from what it names only: a count, an error class, an HTTP status, a few fixed words; the rest of the line (an exception's
// message can quote a posting, a title, an employer, a page or a path) is dropped. A line of no shape, with a link or with a line break is only counted: `+N other warnings not sent`.
const FIXED_WORDS = ['Anthropic API spending limit', 'Claude Code', 'Codex', 'OpenAI', 'key was refused', 'cannot go on', 'not signed in', 'not installed', 'did not answer'];   // the engine's own limit_reason and stopped words (src/ai/cost.py, src/ai/providers/cli_base.py)
const status = text => [...text.matchAll(/\b(?:HTTP(?: Error)?|status|code)[ :]*(\d{3})\b/gi)].slice(0, 1).map(found => `HTTP ${found[1]}`);
const facts = text => [...FIXED_WORDS.filter(word => text.includes(word)), ...status(text)];
// Notion's own reason arrives as data from the app (lib/feedback-run-warnings.js, renderer/notion-reason.js strict): this file imports nothing relative, because the AI-fixer copies it into its token-holding
// snapshot before the AI step (tools/fixer, test/tooling/ci/feedback-ai.test.js); the sanity pattern keeps a stray string from passing as a reason.
const SAFE_REASON = /^[\w .[\]≤≥<>=-]{1,160} \(HTTP \d{3}\)$/;
const storeFacts = (text, reason) => [errorClass(text), reason || status(text)[0]].filter(Boolean);
const errorClass = text => /\b([A-Z]\w*(?:Error|Exception))\b/.exec(text)?.[1];
const withFacts = (head, list) => (list.length ? `${head}: ${list.join(', ')}` : head);
const COUNT = /(\d+)\s+job\(s\)\s+(left for the next check|not read by AI|not scored|not enriched|not ranked|waiting, none scored this run)/i;
const SHAPES = [
  [/^AI (?:limit reached|stopped)\b/i, text => { const left = COUNT.exec(text); return `${withFacts(/^AI stopped/i.test(text) ? 'AI stopped' : 'AI limit reached', facts(text))}${left ? `, ${left[1]} job(s) ${left[2]}` : ''}`; }],
  [/^AI unavailable \(/i, text => { const left = COUNT.exec(text); return `AI unavailable${left ? `, ${left[1]} job(s) ${left[2]}` : ''}`; }],
  [/^\d+\s+job\(s\)\s+(?:waiting|left for the next check|not read by AI|not scored|not enriched|not ranked)\b/i, text => { const left = COUNT.exec(text); return left ? `${left[1]} job(s) ${left[2]}` : ''; }],
  [/^(?:cronjob )?run not (opened|logged) (in|to) (the run history|Notion):/i, (text, reason) => { const where = /^(?:cronjob )?run not (opened|logged) (in|to) (the run history|Notion):/i.exec(text); return withFacts(`run not ${where[1].toLowerCase()} ${where[2]} ${where[3]}`, storeFacts(text, reason)); }],
  [/^Skipped job \S+:/i, text => withFacts('Skipped a job', [errorClass(text), ...facts(text)].filter(Boolean))],
];

/** The warning lines of one run as sent: [sentences, how many lines were held back]. `run.warningLines` comes from the caller (lib/feedback-run-warnings.js). */
function warningsOf(run) {
  const sent = [];
  let held = 0;
  for (const raw of Array.isArray(run.warningLines) ? run.warningLines : []) {
    const text = String(raw && typeof raw === 'object' ? raw.text : raw).trim();
    const reason = raw && typeof raw === 'object' && SAFE_REASON.test(String(raw.reason)) ? String(raw.reason) : '';
    if (!text) continue;
    const shape = /[\r\n]/.test(text) || LINKED.test(text) ? null : SHAPES.find(([pattern]) => pattern.test(text));
    const line = shape ? shape[1](text, reason).slice(0, WARN_CHARS) : '';
    if (!line) { held++; continue; }
    if (!sent.includes(line)) sent.push(line);
  }
  return [sent, held];
}

/** One line per recent run: what kind, how it started, when, whether it worked. The result text only for a run that did not work (it says why); never a job title or company.
 *  For the newest WARN_RUNS runs, whatever their end, the run's warning lines follow it (`   ! <line>`, at most WARN_LINES, each once and cut), then a count of those held back. */
export function runLines(runs, count = RUN_COUNT) {
  return (Array.isArray(runs) ? runs : []).slice(0, count).flatMap((run, index) => {
    const seconds = run.startedAt && run.endedAt ? Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000) : null;
    const state = run.interrupted ? 'interrupted' : run.ok === false ? 'failed' : run.warned ? 'warnings' : run.ok ? 'ok' : 'running';
    const head = `${fmt(run.startedAt)} · ${fmt(run.kind)} · by ${fmt(run.trigger)} · ${state}${seconds != null && Number.isFinite(seconds) ? ` · ${seconds}s` : ''}${state === 'failed' || state === 'interrupted' ? ` · ${String(run.summary || run.result || '').slice(0, 160)}` : ''}`;
    if (index >= WARN_RUNS) return [head];
    const [sent, held] = warningsOf(run);
    return [head, ...sent.slice(0, WARN_LINES).map(line => `   ! ${line}`), ...(sent.length > WARN_LINES ? [`   ! (+${sent.length - WARN_LINES} more)`] : []),
      ...(held ? [`   ! +${held} other warning${held === 1 ? '' : 's'} not sent: they can name a job or an employer`] : [])];
  });
}

/** The state that matters for support, as `name: value` lines (values come from the caller: version, OS, AI engine and whether it is ready, store kind, extension paired). */
export function stateLines(state) {
  return Object.entries(state || {}).map(([name, value]) => `${name}: ${fmt(typeof value === 'object' && value ? JSON.stringify(value) : value)}`);
}

/** The whole logs text, redacted, newest lines kept when it is over the cap. -> {text, bytes, parts: [names of the sections]} */
export function buildLogs({folder, runs = [], state = {}, appLines = APP_LINES, engineLines = ENGINE_LINES, home = os.homedir(), max = MAX_LOGS_BYTES}) {
  const head = ['== Support state ==', ...stateLines(state), '', '== Last runs (newest first) ==', ...(runLines(runs).length ? runLines(runs) : ['none yet']), ''];
  const sections = [['app.log', newestLog(folder, 'app', appLines)], ['engine.log', newestLog(folder, 'engine', engineLines)]].filter(([, lines]) => lines.length);
  const parts = ['state', 'runs', ...sections.map(([name]) => name)];
  const body = sections.flatMap(([name, lines]) => [`== ${name} (last ${lines.length} lines) ==`, ...lines, '']);
  let text = redact([...head, ...body].join('\n'), {home});
  const bytes = value => Buffer.byteLength(value);
  if (bytes(text) > max) {   // keep the support state and runs, cut the oldest log lines
    const keep = redact(head.join('\n'), {home});
    const tail = redact(body.join('\n'), {home});
    let lines = tail.split('\n');
    while (lines.length > 1 && bytes(keep) + bytes(lines.join('\n')) + 80 > max) lines = lines.slice(Math.ceil(lines.length / 10));
    text = `${keep}\n(older lines cut: the cap is ${Math.round(max / 1024)} KB)\n${lines.join('\n')}`;
  }
  return {text, bytes: bytes(text), parts};
}

/** The window's picture as a JPEG data URL under the cap: the image is shrunk, then its quality lowered, until it fits. `image` is an Electron NativeImage (or anything with
 *  getSize, resize({width}) and toJPEG(quality)). -> {dataUrl, bytes, width, height} | null when nothing fits or the image is empty. */
export function shotDataUrl(image, {maxBytes = MAX_SHOT_BYTES} = {}) {
  if (!image || image.isEmpty?.()) return null;
  const size = image.getSize();
  for (const width of [1600, 1200, 900, 600]) {
    const scaled = size.width > width ? image.resize({width}) : image;
    for (const quality of [80, 60, 40]) {
      const bytes = scaled.toJPEG(quality);
      if (bytes.length <= maxBytes) { const done = scaled.getSize(); return {dataUrl: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`, bytes: bytes.length, width: done.width, height: done.height}; }
    }
  }
  return null;
}

const bytesOf = value => Buffer.byteLength(value);

// The longest list inside `data` (at most two levels deep): [holder, key] or null. The one a too-big screen halves first.
function longestList(data) {
  let best = null;
  const look = holder => { for (const [key, value] of Object.entries(holder || {})) { if (Array.isArray(value) && value.length > 1 && (!best || value.length > best[0][best[1]].length)) best = [holder, key]; } };
  look(data);
  for (const value of Object.values(data || {})) if (value && typeof value === 'object' && !Array.isArray(value)) look(value);
  return best;
}

/** The screen's data as the redacted JSON text that leaves: {screen, source, data, recentRuns}. Over the cap its longest list is halved (newest first stays) and `cut` says so; a page that
 *  is one long text is cut at the cap. -> {text, bytes, cut}. Why (2 Nov 2026, owner): the same redactor as the logs, because a saved answer or a title can hold an e-mail or a key. */
export function pageText({screen = '', source = '', data = null} = {}, {runs = [], home = os.homedir(), max = MAX_DATA_BYTES} = {}) {
  const body = {screen, source, recentRuns: runLines(runs, 3), data: JSON.parse(JSON.stringify(data ?? {}))};
  let cut = false, text = redact(JSON.stringify(body, null, 1), {home});
  while (bytesOf(text) > max) {
    const found = longestList(body.data);
    if (!found) { text = `${text.slice(0, Math.max(0, max - 200))}\n… (cut: the cap is ${Math.round(max / 1024)} KB)`; cut = true; break; }
    const [holder, key] = found;
    holder[key] = holder[key].slice(0, Math.ceil(holder[key].length / 2));
    body.cut = 'the longest list was shortened to fit the cap'; cut = true;
    text = redact(JSON.stringify(body, null, 1), {home});
  }
  return {text, bytes: bytesOf(text), cut};
}

/** The Profile snapshot as redacted JSON text: the parts aboutYou read (details, CV, what we learned, strategy, history, voice), what it lacked, nothing sensitive (aboutYou drops sensitive and
 *  conflicting answers). -> {text, bytes, parts: [names], cut}. */
export function profileText(bundle, {home = os.homedir(), max = MAX_DATA_BYTES, lineChars} = {}) {
  const body = {note: 'Snapshot of the Profile the person chose to send; sensitive answers are left out.', parts: bundle?.parts || {}, lacked: bundle?.lacked || []};
  let text = redact(JSON.stringify(body, null, 1), {home, lineChars}), cut = false;
  if (bytesOf(text) > max) { text = `${text.slice(0, Math.max(0, max - 200))}\n… (cut: the cap is ${Math.round(max / 1024)} KB)`; cut = true; }
  return {text, bytes: bytesOf(text), parts: Object.keys(body.parts), cut};
}
