// Reviews the journey's screenshots (artifacts/ui-<view>.png) with AI and writes artifacts/ai-findings.json.
// Job: report health
//   CI: .github/actions/e2e-review runs it once per lane after the suites, with E2E_REVIEW_DIRS (every suite's folder). Every page goes to the AI broker (the Codex plan,
//   lib/broker-client.mjs), 4 at a time; E2E_REVIEW_ENGINE=free asks Workers AI instead (lib/review-free.mjs). No API key: a Mac or a CI without either exits 2 and says so.
// Why (3 Nov 2026, owner: "We should not use API Keys at all anymore. Everything should be around the ai-broker."): the Claude API and Message Batches path, E2E_ANTHROPIC_KEY and the Claude second pass are gone.
// A page that looks the same as the last one judged for the same question (lib/review-cache.mjs: the same prompt, facts and lessons, and lib/png-grid.mjs's
// look) is not asked again: its findings come from the review cache (E2E_REVIEW_CACHE, kept between CI runs), so they are still "seen again".
// Each page is asked with the by-design lessons of its kind of page (lib/review-lessons.mjs, from the closed issues; E2E_REVIEW_LESSONS=0 leaves them out).
// An answer cut off by the token cap is not a clean page: it is listed as not reviewed. Every call's tokens and cost are logged,
// and the totals written to artifacts/ai-review-usage.json.
import fs from 'node:fs';
import path from 'node:path';
import {ARTIFACTS, DESKTOP} from './lib/app.mjs';
import {judgeFamily} from './lib/engine.mjs';
import {aiProvider} from './lib/ai-provider.mjs';
import {askBroker} from './lib/broker-client.mjs';
import {lookStrips} from './lib/png-grid.mjs';
import {prune, questionKey, recall, remember} from './lib/review-cache.mjs';
import {FREE_MODEL, askFree} from './lib/review-free.mjs';
import {fetchLessons, lessonsFor, lessonsText} from './lib/review-lessons.mjs';
import {MODEL, REVIEW_EFFORT, buildRequest, fingerprint, parseFindingsDetailed, usageCost} from './lib/vision.mjs';
import {checklistAsFindingsText, checklistRequest} from './lib/review-checklist.mjs';

// E2E_REVIEW_ENGINE=free picks Workers AI; unset, Free AI when CI runs on it.
// CODEX (owner, 28 Oct 2026: every CI AI call on his Codex plan; "Move it anyway"): the provider switch (lib/ai-provider.mjs) says codex for the review, so each page goes to the broker
// (lib/broker-client.mjs) at the tier of its Claude model; no key. A broker "no" leaves that page unreviewed with its reason, never on another provider.
const CODEX = Boolean(process.env.CI) && aiProvider(process.env, 'review').provider === 'codex';
const FREE = !CODEX && (process.env.E2E_REVIEW_ENGINE ? process.env.E2E_REVIEW_ENGINE === 'free' : judgeFamily() === 'free');
if (!CODEX && !(FREE && process.env.CI_FREE_AI_CF_TOKEN)) { console.error(FREE ? 'CI_FREE_AI_CF_TOKEN is needed (the review runs on Free AI).' : 'CI_AI_PROVIDER=codex is needed (the review asks the AI broker; there is no API key).'); process.exit(2); }
const REVIEW_MODEL = FREE ? FREE_MODEL : MODEL;
const MODEL_LABEL = CODEX ? `${MODEL} on Codex` : REVIEW_MODEL;   // the findings file names who looked
// E2E_REVIEW_PROMPT=checklist (CI, owner 26 Oct 2026): the model answers the 10-point checklist (lib/review-checklist.mjs: Haiku 5.5 saw 70% of the judged bugs with it, 49% without).
const CHECKLIST = !FREE && process.env.E2E_REVIEW_PROMPT === 'checklist';
const skill = path.resolve(DESKTOP, '..', '.claude', 'skills', 'ui-look-and-feel', 'SKILL.md');
const rules = fs.existsSync(skill) ? fs.readFileSync(skill, 'utf8').replace(/^---[\s\S]*?---/, '') : '';
const CACHE = process.env.E2E_REVIEW_CACHE || path.join(DESKTOP, 'e2e', '.review-cache');
const all = [];
// The folders to review: one suite's (E2E_ARTIFACTS), or every suite's at once (E2E_REVIEW_DIRS, CI's review job after the suites: all pages in one run).
// E2E_REVIEW_OUT: each folder's findings go to OUT/<folder name>/ beside the pictures they name (the issue filer reads them there); unset, into the folder itself.
const shots = dir => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(name => /^(ui|failed)-.+\.png$/.test(name));
const DIRS = (process.env.E2E_REVIEW_DIRS ? process.env.E2E_REVIEW_DIRS.split(path.delimiter).filter(Boolean) : [ARTIFACTS]).filter(dir => shots(dir).length);
const OUT = process.env.E2E_REVIEW_OUT || '';
// A skipped suite (no token yet) or a suite that stopped early leaves nothing to look at: that is not an error.
if (!DIRS.length) { console.log('No screenshots to review.'); process.exit(0); }
prune(CACHE);
const lessons = process.env.E2E_REVIEW_LESSONS === '0' ? [] : await fetchLessons();
let rejected = 0;
// Which pages the AI really looked at, and which it could not (no credit, rate limit, an outage, a cut-off answer): ui-findings reads this. A page nobody reviewed is not a page that came back clean.
const reviewed = [], unreviewed = [];
const usage = {model: `${MODEL_LABEL}${CHECKLIST ? ' (checklist)' : ''}`, calls: 0, cached: 0, failed: 0, cutOff: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0, lessons: lessons.length};
// The pages the journey photographed, and the window at the moment a step failed (at most two): a failure screenshot shows the whole app, the sidebar and the bottom bar too.
const jobs = DIRS.flatMap(dir => { const names = fs.readdirSync(dir); return [
  ...names.filter(name => /^ui-.+\.png$/.test(name)).sort().map(name => ({dir, view: name.slice(3, -4), png: name, factsFile: path.join(dir, `ui-${name.slice(3, -4)}.json`)})),
  ...names.filter(name => /^failed-.+\.png$/.test(name)).sort().slice(0, 2).map(name => ({dir, view: 'failure-screenshot', png: name, factsFile: ''}))]; })
  .map((job, index) => {
    const facts = job.factsFile && fs.existsSync(job.factsFile) ? JSON.parse(fs.readFileSync(job.factsFile, 'utf8')) : null;
    const png = fs.readFileSync(path.join(job.dir, job.png));
    const ask = model => buildRequest({view: job.view, pngBase64: png.toString('base64'), rules, facts, lessons: lessonsText(lessonsFor(lessons, job.view)), model});
    const request = CHECKLIST ? checklistRequest({view: job.view, pngBase64: png.toString('base64'), facts, lessons: lessonsText(lessonsFor(lessons, job.view)), model: REVIEW_MODEL, effort: REVIEW_EFFORT}) : ask(REVIEW_MODEL);
    let strips = null;
    try { strips = lookStrips(png); } catch { /* a picture we cannot read is asked every time */ }
    return {...job, id: `r${index}`, request, key: questionKey(CODEX ? `${job.view} (codex)` : job.view, request), strips};   // Why (#2431, Gitar; 5 Nov 2026: the Claude API path left, Free AI is the other reviewer): a Codex look never reuses a Free AI one (the request names the Claude model either way)
  });

// One failed call (HTTP): a request we got wrong fails the step; the plan's own limit or a busy service is a warning.
function failed(job, status, detail) {
  usage.failed++;
  const billing = /credit balance|usage limit|spend limit|rate limit/i.test(detail);   // the plan's own limit: a warning, not a product bug
  // An HTTP status or an error type; a 4xx other than 429 means our request is wrong.
  const ours = !billing && (typeof status === 'number' ? status >= 400 && status < 500 && status !== 429
    : ['invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error', 'request_too_large'].includes(status));
  if (ours) { console.log(`::error::AI review of ${job.view} was rejected (${status}): ${detail}`); rejected++; }
  else console.log(`::warning::AI review of ${job.view} failed (${status}): ${String(detail).slice(0, 160)}; skipped`);
  console.log(`- ${job.view}: review failed (${status})`);
  unreviewed.push({dir: job.dir, view: job.view, why: billing ? 'no credit' : String(status)});
}

// One answered call: count its cost, keep a whole answer for next time, and say when it was cut off (then the page is not reviewed).
function answered(job, message, {usd: freeUsd} = {}) {
  const u = message.usage || {}, usd = freeUsd !== undefined ? freeUsd : usageCost(MODEL, u);
  usage.calls++;
  usage.input += u.input_tokens || 0; usage.cacheWrite += u.cache_creation_input_tokens || 0; usage.cacheRead += u.cache_read_input_tokens || 0; usage.output += u.output_tokens || 0;
  usage.usd += usd || 0;
  console.log(`  ${job.view}: ${u.input_tokens || 0} in, ${u.cache_read_input_tokens || 0} cache read, ${u.cache_creation_input_tokens || 0} cache write, ${u.output_tokens || 0} out${usd == null ? '' : ` = $${usd.toFixed(4)}`}`);
  const said = (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
  const text = CHECKLIST ? checklistAsFindingsText(said) : said;   // the checklist's yes answers, in the review's own findings shape
  if (message.stop_reason !== 'end_turn') {
    usage.cutOff++;
    console.log(`::warning::AI review of ${job.view} stopped early (${message.stop_reason}, ${u.output_tokens || 0} tokens): not reviewed, nothing filed or cleared for it`);
    unreviewed.push({dir: job.dir, view: job.view, why: `answer cut off (${message.stop_reason})`});
    return null;
  }
  if (job.strips) remember(CACHE, job.key, {view: job.view, model: CODEX ? MODEL_LABEL : REVIEW_MODEL, strips: job.strips, text});
  return text;
}

// Free AI's first look (lib/review-free.mjs): the same accounting as a Claude call.
async function free(job) {
  const result = await askFree(job.request);
  if (!result.ok) return failed(job, result.status, result.detail);
  return answered(job, result.message, {usd: result.usd});
}

// The owner's Codex plan through the broker: the same accounting as a Claude call, at no price per page (the plan pays).
async function codex(job) {
  const result = await askBroker(job.request);
  if (!result.ok) return failed(job, result.status, result.detail);
  return answered(job, result.message, {usd: 0});
}

const answers = new Map(), fromCache = new Set(), droppedByShape = [];   // findings the AI raised that the shape rules dropped (lib/vision.mjs), with why
for (const job of jobs) {
  const text = job.strips ? recall(CACHE, job.key, job.strips) : null;
  if (typeof text === 'string') { answers.set(job.id, text); fromCache.add(job.id); usage.cached++; }
}
const pending = jobs.filter(job => !answers.has(job.id));
const PARALLEL = 4;
if (CODEX) {
  for (let at = 0; at < pending.length; at += PARALLEL) {
    const slice = pending.slice(at, at + PARALLEL);
    (await Promise.all(slice.map(job => codex(job)))).forEach((answer, i) => answers.set(slice[i].id, answer));
  }
}
if (FREE) {
  for (let at = 0; at < pending.length; at += PARALLEL) {
    const slice = pending.slice(at, at + PARALLEL);
    (await Promise.all(slice.map(job => free(job)))).forEach((answer, i) => answers.set(slice[i].id, answer));
  }
}

for (const job of jobs) {
  const answer = answers.get(job.id);
  if (typeof answer !== 'string') continue;   // failed or cut off: already listed as not reviewed
  const parsed = parseFindingsDetailed(answer, job.view);
  droppedByShape.push(...parsed.dropped.map(item => ({...item, dir: job.dir})));
  const found = parsed.kept.map(item => ({...item, id: fingerprint(item), file: job.png, dir: job.dir}));   // file: the picture the finding was seen on
  reviewed.push({dir: job.dir, view: job.view});
  console.log(`${found.length ? '!' : '✓'} ${job.view}: ${found.length} finding(s)${fromCache.has(job.id) ? ' (looks the same as the last one judged: not asked again)' : ''}${found.map(item => `\n    [${item.severity}] ${item.title}: ${item.detail}`).join('')}`);
  all.push(...found);
}
// Each folder's own findings file, in the shape it always had (no dir fields); with E2E_REVIEW_OUT, a copy of each picture a finding or a review names goes beside it.
for (const dir of DIRS) {
  const mine = list => list.filter(item => item.dir === dir).map(({dir: _dir, ...item}) => item);
  const to = OUT ? path.join(OUT, path.basename(dir)) : dir;
  fs.mkdirSync(to, {recursive: true});
  if (OUT) for (const job of jobs.filter(item => item.dir === dir)) fs.copyFileSync(path.join(dir, job.png), path.join(to, job.png));
  fs.writeFileSync(path.join(to, 'ai-findings.json'), JSON.stringify({model: usage.model, findings: mine(all), reviewed: mine(reviewed).map(item => item.view), unreviewed: mine(unreviewed), dropped: mine(droppedByShape)}, null, 2));
}
fs.mkdirSync(ARTIFACTS, {recursive: true});
fs.writeFileSync(path.join(ARTIFACTS, 'ai-review-usage.json'), JSON.stringify({...usage, usd: Number(usage.usd.toFixed(4))}, null, 2));
const line = `AI review: ${usage.calls} call(s), ${usage.cached} looked the same (not asked again), ${usage.failed} failed, ${usage.cutOff} cut off; ${usage.input} in + ${usage.cacheRead} cache read + ${usage.cacheWrite} cache write, ${usage.output} out = $${usage.usd.toFixed(4)} (${usage.model}; ${usage.lessons} by-design lesson(s))`;
console.log(`\n${all.length} finding(s) written to ai-findings.json\n${line}${unreviewed.length ? `\nNOT reviewed (${unreviewed.map(item => `${item.view}: ${item.why}`).join(', ')}): no finding is filed or cleared for these pages from this run.` : ''}`);
if (rejected) process.exit(1);
