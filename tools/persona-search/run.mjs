// --without-eures: paired comparison only; explicitly disable the reader in every engine child.
// --with-eures: paired comparison only; EURES is off by default outside an installed app (src/features.py 'eures'), so its "normal" arm turns it on in every engine child.
// The persona search check: a fictional new user through the app's own path, CV -> strategy draft -> first "Find jobs" -> more presses, with the
// numbers after each press (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md; owner, 18 Oct 2026: finance in Amsterdam, music in
// Berlin, a driver in Nuremberg, and the SRE control). By hand only: it reads live public job sites (never past a login wall), and its AI runs
// on this Mac's Claude Code plan ($0), never an API key. Its folder is <os temp>/jp-persona-<name>[-<tag>]: never the person's app folder,
// Keychain, Notion or Telegram; telemetry and pool sharing are off.
//   python3 tools/persona-search/personas.py <out>            (the CVs: <out>/<name>/cv.pdf)
//   node tools/persona-search/run.mjs <name> <out> [--presses 5] [--tag before] [--fresh] [--draft <draft.json>]
//        [--tape <folder> --record | --replay [--wait-scale 1] [--no-live]] [--judge] [--first-only] [--note <file>] [--change-field <file>]
// --no-prepare: skip the app's preparation after the strategy save (lib/search-prepared.js), so the first search asks its places and kinds of role itself, as before 12 Nov 2026 (a before/after of that change).
// --note: the wizard's "What should the AI know?" text (e.g. "First Officer jobs anywhere in Europe"), given to the strategy draft as a person types it.
// --change-field: a JSON list of role titles; before press 2 they replace the roles through the Strategy page's own edit (lib/strategy-edit.js editLists,
//   which redrafts the old field's words), and the search is marked changed: the owner's path, a field change on an existing install then Find jobs again (26 Oct 2026).
// Each press's row also has its funnel (funnel.py: employers picked, sites and boards read, web searches, jobs listed) for the search robot's alarm.
// --beside: each press as the app runs it, with the job boards that refuse plain reading read beside it in Jobadabra's own headless Chrome (beside.mjs; Playwright's Chromium as
//   the runtime); live only, so never with --replay. Each press's row gets headless_boards: {state, read, jobs, fits, of}.
// --first-only: stop after the first-jobs step (boards read, local jobs listed; ~6 min instead of 20-25): the discover, light run and scout steps are skipped (24 Oct 2026, the beyond-Moldova checks).
// --judge: after each press, how many of the top 10 are right for the persona (judge.py, plan engine only; never on --engine api).
// Writes <out>/<name>/draft.json, run-<press>.log and presses.jsonl (one JSON line per press: tools/persona-search/metrics.py + time).
// --draft: the strategy from an earlier run (no AI), so two runs search for the same thing. --tape (src/search_tape.py, change 0 of the search
// plan): --record keeps every web and AI answer of the search; --replay serves them offline after their recorded time times --wait-scale (1 = as recorded, 0 = no wait, 0.1 = ten times faster), so a change
// is measured on the same sources: nothing leaves the computer, and an AI question the tape lacks goes to the plan and is added (--no-live: it is counted and fails instead, as on CI).
// tools/persona-search/ttfr.py <run-1.log> <data dir>: the seconds to the 1st and 10th relevant job and to the first 70+.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const [name, outArg] = process.argv.slice(2);
const option = (flag, fallback) => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : fallback; };
if (!name || !outArg) { console.error('usage: node tools/persona-search/run.mjs <name> <out> [--presses 5] [--tag t] [--fresh]'); process.exit(2); }
const out = path.resolve(outArg, name), presses = Number(option('--presses', 5)), tag = option('--tag', '');
const dir = path.join(os.tmpdir(), `jp-persona-${name}${tag ? `-${tag}` : ''}`);
if (process.argv.includes('--fresh')) fs.rmSync(dir, {recursive: true, force: true});
fs.mkdirSync(dir, {recursive: true});
fs.copyFileSync(path.join(out, 'cv.pdf'), path.join(dir, 'cv.pdf'));
const tape = option('--tape', '');
// How a tape is replayed (tape/replay.json, written by the heal: {engine, wait_scale}): a tape recorded on the API engine asks other questions than the plan engine would, and its search only repeats at the recorded pace
// (18 Oct 2026: the same tape missed 59 AI requests on the plan engine at wait scale 0, 30 on its own engine). An explicit flag wins; no file = the plan engine, no wait for an offline replay (--no-live), as recorded otherwise.
const how = (() => { try { return tape && process.argv.includes('--replay') ? JSON.parse(fs.readFileSync(path.join(tape, 'replay.json'), 'utf8')) : {}; } catch { return {}; } })();
const waitScale = option('--wait-scale', String(how.wait_scale ?? (process.argv.includes('--no-live') ? 0 : 1)));
const engineName = option('--engine', how.engine || 'cli');
// Why (rf2, 8 Nov 2026; measured on p11 and p17, 5 runs each): at wait scale 0 no thread sleeps, so the recorded waits of calls that ran side by side are added up instead of overlapping (src/search_tape.py _wait), and with JOBADABRA_TAPE_BUDGET=0 the code's own clock then cuts
// every stage somewhere else each run: the same replay gave 5 to 196 web pages missing (p17) and 148 to 183 (p11); at wait scale 1 five runs gave the same number every time (p17 0, p11 551). A replay of the code's own clock needs scale 1.
if (tape && process.argv.includes('--replay') && Number(waitScale) === 0 && process.env.JOBADABRA_TAPE_BUDGET === '0') {
  console.error('--wait-scale 0 with JOBADABRA_TAPE_BUDGET=0: the replay\'s own clock would cut each stage at another place every run. Use --wait-scale 1, or drop JOBADABRA_TAPE_BUDGET=0 to replay the recording\'s clock decisions.');
  process.exit(2);
}
if (process.argv.includes('--beside') && process.argv.includes('--replay')) { console.error('--beside reads live boards in a real browser: not with --replay (a replay stays offline)'); process.exit(2); }
if (process.argv.includes('--speed')) { console.error('--speed is gone (it multiplied the waits, so 20 meant 20x slower): use --wait-scale, 0 = no wait'); process.exit(2); }
if (tape) {   // read by the engine (desktop/lib/pipeline-env.js passes these three on)
  if (process.argv.includes('--record') === process.argv.includes('--replay')) { console.error('--tape needs --record or --replay'); process.exit(2); }
  Object.assign(process.env, {JOBADABRA_SEARCH_TAPE: path.resolve(tape), JOBADABRA_SEARCH_TAPE_MODE: process.argv.includes('--record') ? 'record' : 'replay',
    JOBADABRA_TAPE_WAIT_SCALE: waitScale});
  if (process.argv.includes('--no-live')) process.env.JOBADABRA_TAPE_LIVE = '0';   // CI has no AI account: a question the tape lacks is counted and raises (src/search_tape.py)
  // Why (rf, 8 Nov 2026, gi: "a replay then cannot drift from its recording's model"): the model is part of every AI question's key (src/search_tape.py), and the recording used to be made with
  // JOBADABRA_MODEL_OVERRIDE=claude-haiku-5-5 (every main-tier step on Haiku); a replay without it asked Sonnet and missed 23 AI answers of 50 (p11, 8 Nov). The recording says how it was recorded.
  const recordedFile = path.join(tape, 'recorded.json');
  if (process.argv.includes('--record')) {
    fs.mkdirSync(tape, {recursive: true});
    fs.writeFileSync(recordedFile, JSON.stringify({model_override: process.env.JOBADABRA_MODEL_OVERRIDE || '', eures: process.argv.includes('--with-eures')}) + '\n');   // Why (10 Nov 2026, ys): a tape recorded without EURES holds no EURES page; its replay must not ask for them (an older tape has no field: it was recorded with EURES on)
  } else if (fs.existsSync(recordedFile)) {
    const {model_override: recorded} = JSON.parse(fs.readFileSync(recordedFile, 'utf8')) || {};
    if (typeof recorded !== 'string') { console.error(`${recordedFile} has no model_override: the tape does not say which model it was recorded with`); process.exit(2); }
    if (recorded) process.env.JOBADABRA_MODEL_OVERRIDE = recorded; else delete process.env.JOBADABRA_MODEL_OVERRIDE;
    console.log(`tape: recorded with model override ${recorded || '(none)'}, replayed with it`);
  } else console.log('tape: no recorded.json (recorded before it existed): the model override is the environment\'s');
}

const lib = file => import(path.join(ROOT, 'desktop', 'lib', file));
const {createStorage} = await lib('storage.js');
const {ensureConfig, python, pipelineEnv} = await lib('pipeline-env.js');
const {searchSteps} = await lib('search-steps.js');
const {run: searchRun} = await lib('pipeline-run.js');
const strategy = await lib('strategy.js');
const {titlesOf} = await lib('target-roles.js');
const claudeCode = await lib('claude-code.js');
const {realClaude} = await import(path.join(ROOT, 'desktop', 'e2e', 'lib', 'real-claude.mjs'));
const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});   // its own folder: nothing reaches the Keychain
ensureConfig(storage);
// Why (12 Nov 2026, owner: "Tests reuse one token"): a local live search borrows a fixed test install id and its kept index token (test-installs.mjs)
const lent = tape ? '' : (await import('./test-installs.mjs')).lend(storage.path('data'));
// --engine api keeps the Messages SDK contract: the PR search check uses the Codex wrapper's relay and placeholder; standalone draws retain their own explicit API key.
const api = engineName === 'api', replayOnly = api && process.argv.includes('--replay') && process.argv.includes('--no-live');   // an offline replay builds the API client but never calls it
// Why (30 Oct 2026, owner; names renamed 1 Nov 2026; heal key removed 3 Nov 2026, owner: "We should not use API Keys at all anymore"): the CI wrapper supplies a broker-only loopback relay, never an API credential; the only keys left are the Free AI draws key and the prompt-case proof's.
const apiKey = process.env.JOBADABRA_PERSONA_CODEX === '1' ? 'codex-relay-placeholder' : process.env.RANDOM_DRAWS_ANTHROPIC_KEY || process.env.PR_PROOF_ANTHROPIC_KEY || (replayOnly ? 'replay-only' : '');
if (api && !apiKey) { console.error('--engine api needs RANDOM_DRAWS_ANTHROPIC_KEY or PR_PROOF_ANTHROPIC_KEY'); process.exit(2); }
if (api) storage.setSecret('ANTHROPIC_API_KEY', apiKey);
storage.saveSettings({aiEngine: api ? 'api' : 'cli', ...(api ? {} : {claudeCode: {path: realClaude() || (process.env.JOBADABRA_TAPE_LIVE === '0' ? process.execPath : '')}}), store: 'sqlite', telemetry: false, shareEmployers: false});

const beside = process.argv.includes('--beside') ? await (await import('./beside.mjs')).besideFor(storage, dir, searchRun) : null;

const metrics = (script = 'metrics.py', ...args) => JSON.parse(execFileSync(python(), [path.join(ROOT, 'tools', 'persona-search', script), ...args], {cwd: ROOT, env: {
  ...process.env, PYTHONPATH: ROOT, JOBADABRA_NO_DOTENV: '1', JOBADABRA_FOLLOW_APP: '0',
  JOBADABRA_CONFIG_DIR: storage.path('config'), JOBADABRA_DATA_DIR: storage.path('data')}}).toString().trim().split('\n').pop());

function judged() {
  const env = {...process.env, PYTHONPATH: ROOT, JOBADABRA_NO_DOTENV: '1', JOBADABRA_FOLLOW_APP: '0', JOBADABRA_AI_ENGINE: 'cli',
    JOBADABRA_CONFIG_DIR: storage.path('config'), JOBADABRA_DATA_DIR: storage.path('data')};
  for (const key of Object.keys(env)) if (key.startsWith('JOBADABRA_SEARCH_TAPE') || key === 'JOBADABRA_TAPE_WAIT_SCALE' || key === 'JOBADABRA_TAPE_LIVE') delete env[key];
  try {
    return JSON.parse(execFileSync(python(), [path.join(ROOT, 'tools', 'persona-search', 'judge.py'), out, name], {cwd: ROOT, env}).toString().trim().split('\n').pop());
  } catch (error) { console.log(`${name}: top 10 not judged: ${String(error.message).split('\n')[0]}`); return null; }
}

// The Strategy page's roles edit (lib/search-tuning-handlers.js 'editTargets'): the old titles out, the new ones in, the search marked changed. -> {from, to}
async function changeField(titles) {
  const before = titlesOf(JSON.parse(storage.readText('config/search.json') || '{}'));
  const notion = () => { throw new Error('a persona install has no Notion'); };
  const result = await strategy.editLists(storage, {roles: {add: titles, remove: before}}, {run: searchRun, ensurePage: notion, writePage: notion});
  if (result.changed?.length) storage.saveSettings({searchChangedAt: new Date().toISOString()});
  console.log(`${name}: field changed from ${before.slice(0, 3).join(', ')} to ${titles.slice(0, 3).join(', ')}`);
  return {from: before.length, to: titles.length};
}

if (!storage.settings().setupDone) {   // the wizard's strategy step: the app's own draft from the CV, kept as the review's "Save" does without Notion
  const started = Date.now(), kept = option('--draft', '');
  const note = option('--note', '') ? fs.readFileSync(option('--note', ''), 'utf8').trim() : '';
  const draft = kept ? JSON.parse(fs.readFileSync(kept, 'utf8')) : await strategy.draft(storage, note ? {anything_else: note} : {}, apiKey, api ? null : claudeCode.client(storage));
  if (!kept || path.resolve(kept) !== path.join(out, 'draft.json')) fs.writeFileSync(path.join(out, 'draft.json'), JSON.stringify(draft, null, 2));
  strategy.keepLocally(storage, draft);
  storage.saveSettings({setupDone: true, cvName: 'cv.pdf'});
  console.log(`${name}: strategy ${kept ? `from ${kept}` : 'drafted'} in ${Math.round((Date.now() - started) / 1000)} s`);
  // As the app does after the wizard's Save (lib/strategy-draft-handlers.js): places and kinds of role are worked out before the first Find jobs, not inside it.
  // Awaited here so every measured person starts the same; in the app a search pressed sooner waits for it (src/search_prepared.py wait). --no-prepare: the search as before.
  if (!process.argv.includes('--no-prepare')) {
    const before = Date.now(), {prepareSearch} = await lib('search-prepared.js');
    const ok = await prepareSearch(storage, searchRun);
    console.log(`${name}: search ${ok ? 'prepared' : 'NOT prepared (the search asks for itself)'} in ${Math.round((Date.now() - before) / 1000)} s`);
  }
  // Why (13 Nov 2026, sa and bl, run 43487528056): the pair's draft step asks the board proposal once (propose.py) so both sides copy this install's answers instead of asking one call each.
  if (process.argv.includes('--propose')) {
    try {
      console.log(execFileSync(python(), [path.join(ROOT, 'tools', 'persona-search', 'propose.py')], {cwd: ROOT, env: {...pipelineEnv(storage), PYTHONPATH: ROOT}}).toString().trim().split('\n').pop());
      fs.writeFileSync(path.join(storage.path('data'), 'proposed.ok'), '');   // the pair's sides read this: no marker, no shared proposal, the pair says so (pair.py side)
    }
    catch (error) { console.log(`${name}: board proposal NOT made (each search asks for itself): ${String(error.message).split('\n')[0]}`); }
  }
}
// What the press searched with (Why 2 Nov 2026, run 41376694937: p1/p5 never started their web search and the artifact could not say why): roles and place words from search.json,
// the countries the engine reads for them (metrics.py --countries: src/places.py countries over places.json, written by the press itself, so it is read again after it).
// Why (13 Nov 2026, #3953): matching places.json by the raw fragment showed countries [] for "sofia|софия" and "krak[oó]w", which the engine reads as Bulgaria and Poland.
// Never throws: a failed countries lookup is one log line and [], so the press row with all its numbers is still written (Gitar on #3962).
function searchSummary(withCountries = true) {
  let search = {}, countries = [];
  try { search = JSON.parse(fs.readFileSync(path.join(storage.path('config'), 'search.json'), 'utf8')); } catch { /* no strategy yet: no roles, no places */ }
  if (withCountries) try { countries = metrics('metrics.py', '--countries').countries || []; } catch (error) { console.log(`${name}: countries not read: ${String(error.message).split('\n')[0]}`); }
  const places = [];
  for (const key of ['top_tier', 'country_wide', 'abroad']) for (const word of search.locations?.[key] || []) if (!places.includes(word)) places.push(word);
  return {roles: (search.role_keywords || []).length, places, ...(withCountries ? {countries} : {})};
}
const failed = [];
/** 'on' or 'off': whether this run's presses read EURES (src/features.py 'eures': --with-eures or JOBADABRA_EURES=1 turn it on, --without-eures off), written on each press row for gate.py. */
const euresMode = () => !process.argv.includes('--without-eures') && (process.argv.includes('--with-eures') || process.env.JOBADABRA_EURES === '1') ? 'on' : 'off';
const done = fs.existsSync(path.join(out, 'presses.jsonl')) ? fs.readFileSync(path.join(out, 'presses.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length : 0;
const fieldFile = option('--change-field', '');
for (let press = done + 1; press <= presses; press++) {
  const changed = press === 2 && fieldFile ? await changeField(JSON.parse(fs.readFileSync(fieldFile, 'utf8'))) : null;
  const before = searchSummary(false);
  console.log(`Search: ${before.roles} roles; places ${before.places.join(', ') || 'none'}`);
  const started = Date.now(), log = fs.createWriteStream(path.join(out, `run-${press}.log`));
  const firstOnly = process.argv.includes('--first-only');
  let calls = 0;
  // The paired benchmark switches only its own engine children; pipelineEnv intentionally drops inherited feature switches.
  const exec = (store, args, onLine, extraEnv = {}, options) => (firstOnly && calls++ > 0 ? Promise.resolve({code: 0})
    : searchRun(store, args, onLine, {...extraEnv, ...(process.argv.includes('--with-eures') ? {JOBADABRA_EURES: '1'} : {}), ...(process.argv.includes('--without-eures') ? {JOBADABRA_DISABLE: [extraEnv.JOBADABRA_DISABLE, 'eures'].filter(Boolean).join(',')} : {})}, options));
  const onLog = line => log.write(`[${Math.round((Date.now() - started) / 1000)}s] ${line}\n`);
  const steps = () => searchSteps(storage, onLog, 'run', press === 1 ? 'first' : 'you', exec);
  const {code} = beside ? await beside.press(steps, onLog) : await steps();
  log.end();
  if (lent) (await import('./test-installs.mjs')).keep(storage.path('data'), lent);
  const crashes = metrics('crashes.py', path.join(out, `run-${press}.log`));   // a Traceback in the log: a step died, its numbers are thin
  const row = {press, started: new Date(started).toISOString(), code, crashes, eures: euresMode(), ...(process.env.JOBADABRA_PERSONA_CODEX === '1' ? {billing: 'subscription'} : {}), seconds: Math.round((Date.now() - started) / 1000), ...metrics(), funnel: metrics('funnel.py', path.join(out, `run-${press}.log`), '--since', new Date(started).toISOString().slice(0, 19)),
    search: searchSummary(),
    ...(changed ? {field_changed: changed} : {}),
    ...(beside ? {headless_boards: beside.last()} : {}),
    ...(press === 1 ? {ttfr: metrics('ttfr.py', path.join(out, 'run-1.log'))} : {})};
  fs.appendFileSync(path.join(out, 'presses.jsonl'), `${JSON.stringify(row)}\n`);
  const verdict = process.argv.includes('--judge') && !api ? judged() : null;   // its own AI call, off the tape: a replay neither records nor needs it
  if (verdict) fs.writeFileSync(path.join(out, `judge-${press}.json`), JSON.stringify(verdict, null, 2));
  const first = row.ttfr ? `; 1st/10th relevant at ${row.ttfr.first_in_places_s ?? '—'}/${row.ttfr.tenth_in_places_s ?? '—'} s, 1st 70+ at ${row.ttfr.first_fit70_s ?? '—'} s` : '';
  if (crashes.length) { failed.push(...crashes); console.log(`PRESS ${name} ${press} FAILED: ${crashes.map(crash => `${crash.step}: ${crash.error}`).join(' | ')}`); }
  console.log(`PRESS ${name} ${press} (EURES: ${process.argv.includes('--with-eures') ? 'on' : 'off'}): ${row.in_places} in places, ${row.scored_in_places} scored, ${row.fit70_in_places} fit 70+ (${row.seconds} s${first})${verdict ? `; top 10: ${verdict.right} of ${verdict.of} right` : ''}`);
}
await beside?.close();
if (failed.length) { console.log(`PERSONA FAILED ${name}: ${failed.length} crash(es), the numbers above are not a clean run`); process.exitCode = 1; }
else console.log(`PERSONA DONE ${name}`);
