// Lines of a run's log that are warnings (Notion busy, a step skipped or failed…), each once. A count of zero is not
// one: "Enriched 1 of 1 job(s); 0 failed" is a normal report line, not a warning.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {where} from './store-name.js';
import {notionReason} from './notion-reason.js';
const WARNING = /^Warning|\b429\b|Too Many Requests|\b(?:skipped|failed)\b|^AI limit reached|^AI stopped/i;
const ZERO = /\b0 (?:failed|skipped)\b/gi;
const CAP = 180;
// Long API errors are capped, but at a word: "…API usage limits. You will" reads like a broken sentence.
const shorten = text => (text.length <= CAP ? text : `${text.slice(0, CAP).replace(/\s+\S*$/, '')}…`);
export const runWarnings = lines => [...new Set(lines.filter(line => WARNING.test(String(line).replace(ZERO, '')))
  .map(line => shorten(String(line).replace(/^Warning:\s*/i, ''))))];

// Everywhere a run's warnings are recorded: its log (a run on this Mac) and its page's report (lib/run-history.js
// `report` — where a GitHub run's "Warning: …" lines are, its log being one line pointing at its page). Not its
// `result`: that is the row's one-line summary, and a failed run's is just "failed".
// A Find jobs using your browser run says each stopped site in its own card row (renderer/visits-card.js): its progress lines (⏳ step, ✗/✓ site, ▸ row) are not
// warnings again above it (7 Oct 2026: "IWC is not responding: skipped… And 3 more" repeated the rows).
const SITE_ROW = /^\s*(?:⏳|✗|✓|▸)/;
export const runWarningLines = run => runWarnings([
  ...(Array.isArray(run?.log) ? run.log : []),
  ...(Array.isArray(run?.report) ? run.report : []),
].filter(line => run?.kind !== 'visits' || !SITE_ROW.test(String(line))));

// The Anthropic account's spend limit, in any of its wordings (a line cut short still counts when another says it).
const LIMIT = /usage limits?|credit balance|AI limit reached|spending limit|spend limit|no credit left/i;   // the last two: OpenAI's (src/ai/providers/openai_api.py)
export const isSpendingLimit = text => LIMIT.test(String(text || ''));
// What stopped an AI step when it is no limit (cost.stop_line): signed out, not installed, not answering, a refused key. Why (5 Nov 2026, #3059): each read as a limit.
const STOPPED = /^(?:Warning:\s*)?AI stopped: (.+?)(?: \(|, \d+ job\(s\)|$)/i;
/** The cause in a stop line ("AI stopped: Claude Code is not signed in, 3 job(s) left…" -> "Claude Code is not signed in"); '' for any other line. */
export const stopCause = line => STOPPED.exec(String(line).trim())?.[1] || '';
export const STOP_HELP = t('helperState.stopHelp');
const SKIPPED =/^Skipped job (\S+): (.*)$/;
// "N job(s) not read by AI / not scored / left for the next check": the same loss, said three ways by the pipeline.
const UNSCORED = /^(?:AI (?:limit reached|stopped)\b.*?,\s*)?(\d+)\s+job\(s\)\s+(?:left for the next check|not read by AI|not scored|not enriched|not ranked)/i;

// A raw provider error as the sentence it means. The API's own dumping — "BadRequestError: Error code: 400 - {'type':
// 'error', 'error': {'type': 'invalid_request_error', 'message': 'You have reached your specified API usage limits…" —
// is never shown to the owner: the message inside it is, or the fact that the account's spending limit was reached.
// Also the JavaScript SDK's form, "400 {"type":"error","error":{…}}": it reached the CV message as it was (#94, 3 Oct 2026).
const PROVIDER = /\b(?:BadRequestError|APIError|RateLimitError|AuthenticationError|PermissionDeniedError|InternalServerError|APIConnectionError|OverloadedError|Error code: \d{3})\b|^\d{3}\s*\{|["']type["']\s*:\s*["']error["']/i;
const MESSAGE = /['"]message['"]\s*:\s*['"]([^'"]{4,240})/i;
const BACK = /(?:regain access|resets?)[^.\d]{0,40}(\d{4}-\d{2}-\d{2})/i;
// The AI service answering "too many requests" / "overloaded" (429, 529): busy, not a key or permission problem.
export const AI_BUSY = /RateLimitError|OverloadedError|Error code: (?:429|529)\b/i;
// A web service answering with an HTTP error, often with its error page's HTML after it ("HTTPError: HTTP Error 502: <!DOCTYPE html>…"): the owner is told in a sentence, never the markup (#275).
const HTTP = /(?:\b\w*Error:\s*)?HTTP Error (\d{3})\b[^]*$/i;
const HTML = /<!DOCTYPE[^]*$|<html[^]*$/i;
export function httpSentence(code) {
  const status = Number(code);
  if (status === 429) return t('helperState.httpBusy');
  if (status === 401 || status === 403) return t('helperState.httpRefused', {status});
  if (status >= 500) return t('helperState.httpUnavailable', {status});
  return t('helperState.httpError', {status});
}
export function humanError(text, limit = false) {
  const raw = String(text || '').trim();
  if (!PROVIDER.test(raw) && (HTTP.test(raw) || HTML.test(raw))) {
    const code = HTTP.exec(raw)?.[1];
    return raw.replace(HTTP, '').replace(HTML, '').replace(/[:\s]+$/, '').concat(code ? `: ${httpSentence(code)}` : t('helperState.httpErrorPage')).replace(/^: /, '');
  }
  if (!PROVIDER.test(raw)) return raw.replace(/^\w*Error:\s*/, '') || raw;
  const message = (MESSAGE.exec(raw)?.[1] || '').replace(/\s+/g, ' ').trim();
  if (limit || LIMIT.test(raw) || LIMIT.test(message)) {
    const back = (BACK.exec(raw) || BACK.exec(message) || [])[1];
    return t('helperState.anthropicLimit', {back: back ? t('helperState.backOn', {date: back}) : ''});
  }
  if (AI_BUSY.test(raw)) return t('helperState.aiRateLimited');
  return message || t('helperState.aiRefusedCall');
}

// A whole message with a raw error somewhere in it: the app's own words before it are kept, the dump becomes humanError's sentence
// ("Couldn't read your CV: 400 {"type":"error",…}." -> "Couldn't read your CV: the Anthropic API spending limit was reached.").
// core.js message() runs every message slot through it, so a handler that passes an exception's text on is never shown raw (#409).
const DUMP_AT = /\b(?:BadRequestError|APIError|RateLimitError|AuthenticationError|PermissionDeniedError|InternalServerError|APIConnectionError|OverloadedError)\b|\bError code: \d{3}\b|\b\d{3}\s*\{|\{\s*["']type["']\s*:\s*["']error["']|(?:\b\w*Error:\s*)?HTTP Error \d{3}\b|<!DOCTYPE|<html/i;
export function plainError(text) {
  const raw = String(text ?? '');
  const at = raw.search(DUMP_AT);
  if (at < 0) return raw;
  const lead = raw.slice(0, at).replace(/[\s:–-]+$/, '');
  const said = humanError(raw.slice(at));
  const end = /[.!?]$/.test(raw.trim()) && !/[.!?]$/.test(said) ? raw.trim().slice(-1) : '';
  return `${lead ? `${lead}: ` : ''}${said}${end}`;
}

// Warnings as you read them: the same error on many jobs is one line ("Skipped 23 jobs (6, 7, 8, …): the Anthropic API
// spending limit was reached"), the API's raw dumping is a sentence, and the three wordings of "jobs the limit left"
// count once each and add up to one line — not six that say the same thing.
// Known engine warnings as what they mean for you, the exact text staying in the technical log (owner, 6 Oct 2026: "candidate
// source skipped: TimeoutError" and "KeyError: 'watch'" were the box's explanation).
const PLAIN = [
  [/^candidate source skipped: (?:[\w.]+\.)?\w*Timeout\w*\b/i, () => t('helperState.sourceTimeout')],
  [/^candidate source skipped: /i, () => t('helperState.sourceNotChecked')],
  [/^Notion not updated for (.+?): /i, m => t('helperState.notionUpdateFailed', {item: m[1]})],   // about Notion
];
// A line that still ends in a raw exception ("<what>: KeyError: 'watch'"): what failed, and where its details are.
const RAW_EXCEPTION = /^(.{3,80}?):\s*(?:[\w.]+\.)?\w+(?:Error|Exception)\b.*$/;
// The run's own row in the run history (opened at the start, its result saved at the end), said by the engine without the store's name
// ("run not opened in the run history", Notion's "cronjob run not logged to Notion"): the person is told which store and what was not saved (#342).
const RUN_ROW = /^(?:cronjob )?run not (opened|logged) (?:in|to) (?:the run history|Notion):\s*(.*)$/i;   // about Notion: the engine's own wording
function runRowWarning(raw) {
  const m = RUN_ROW.exec(raw);
  if (!m) return null;
  const reason = notionReason(m[2], {strict: false}) || humanError(m[2]);
  return t(m[1].toLowerCase() === 'opened' ? 'helperState.runRowNotOpened' : 'helperState.runRowNotSaved', {store: where(), reason: reason ? `: ${reason}` : ''});
}
export function plainWarning(raw) {
  const row = runRowWarning(raw);
  if (row) return row;
  for (const [pattern, words] of PLAIN) { const m = pattern.exec(raw); if (m) return words(m); }
  return null;
}
// Only for a line nothing else reworded (an HTTP status or the AI provider's error have their own sentences).
const rawException = raw => { const m = RAW_EXCEPTION.exec(raw); return m && !PROVIDER.test(raw) ? t('helperState.internalErrorDetail', {task: m[1].replace(/^./, c => c.toUpperCase())}) : null; };
// The head lines of grouped warnings: the jobs left unscored, with what stopped them. A real limit in the same run keeps the count, and the stop is then its own line.
function leftUnscored(total, stop, limit) {
  const stopSaid = stop && `${stop}. ${STOP_HELP}`;
  const why = stop && !limit ? stopSaid : t('helperState.anthropicLimitPlain');
  return [...(total ? [t('helperState.unscoredJobs', {count: total, why})] : []), ...(stop && (limit || !total) ? [stopSaid] : [])];
}
export function groupWarnings(warnings) {
  const limit = warnings.some(text => LIMIT.test(String(text)));
  const stop = warnings.map(stopCause).find(Boolean);
  const groups = new Map(), order = [], counts = new Set();
  const add = (label, id) => { if (!groups.has(label)) { groups.set(label, []); order.push(label); } if (id) groups.get(label).push(id); };
  for (const text of warnings) {
    const raw = String(text).trim().replace(/^Warning:\s*/i, '');
    const unscored = UNSCORED.exec(raw);
    if (unscored && (stop || limit || LIMIT.test(raw))) { counts.add(Number(unscored[1])); continue; }
    if (stopCause(raw)) continue;
    const skipped = SKIPPED.exec(raw);
    if (skipped) { add(humanError(skipped[2], limit), skipped[1]); continue; }
    const plain = plainWarning(raw);
    if (plain) { add(plain, null); continue; }
    // "check failed: BadRequestError: …" keeps its own words in front of the sentence; a bare dump does not.
    const head = raw.split(/:\s*/)[0];
    const clean = humanError(raw, limit);
    if (clean === raw.replace(/^\w*Error:\s*/, '') && rawException(raw)) { add(rawException(raw), null); continue; }
    add(head && head.length < 60 && !PROVIDER.test(head) && clean !== raw && !clean.startsWith(head) ? `${head}: ${clean}` : clean, null);
  }
  const out = leftUnscored([...counts].reduce((sum, count) => sum + count, 0), stop, limit);
  for (const label of order) {
    const ids = groups.get(label) || [];
    if (!ids.length) { if (!out.includes(label)) out.push(label); continue; }
    out.push(t('helperState.skippedJobs', {count: ids.length, ids: `${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', …' : ''}`, reason: label}));
  }
  return out;
}

// The grouped lines minus those that only say again what the banner's "AI service is busy" sentence says.
// A line the summary above already says word for word is no detail either (#285: one warning was printed as the summary and again under "Hide details").
export const newDetails = (grouped, summary = '') => grouped.filter(line => line !== t('helperState.aiRateLimited') && !/^(?!Skipped )(?:[^:]*: )?the AI service is rate-limited right now$/.test(line) && !String(summary).includes(line.trim()));

// How many jobs the spend limit left unscored: the ones that failed on it, and those the run stopped before.
export function limitedJobs(warnings) {
  if (!warnings.some(text => LIMIT.test(text))) return 0;
  const failed = warnings.filter(text => SKIPPED.test(text) && /BadRequestError|Error code: 400|usage limit/i.test(text)).length;
  const left = warnings.map(text => Number(/(\d+) job\(s\) left/.exec(text)?.[1] || 0)).reduce((a, b) => a + b, 0);
  return failed + left;
}

// The grouped warnings as sentences: each ends before the next starts. `more`: the first one, then how many others there are (the rest is
// one click away under "View N details"). "…: try again And 2 more." ran together (#342).
export function sentences(lines, more = false) {
  const end = text => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);
  if (!lines.length) return '';
  if (more && lines.length > 2) return t('helperState.andMoreSentences', {first: end(lines[0]), count: lines.length - 1});
  return (more ? lines.slice(0, 1) : lines).map(end).join(' ');
}

// A warned step's one line under its name: the first warning, in words (the box above the steps lists them all).
export const stepNote = warnings => sentences(groupWarnings(warnings).slice(0, 1));
