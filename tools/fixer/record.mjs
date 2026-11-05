// The record of one AI fixer run: what happened, the steps, the agent's reason, the errors ([hm] 5/7, 5 Nov 2026; owner, 4 Nov 2026: "details about each run. What happened. Some logs, some achievements, errors").
// Why (5 Nov 2026): run 1 ended needs-human and its log said nothing; the record is the one small file (artifact `ai-fixer-record`, file `record.json`, schema v:1) that tools/harness-stats.mjs reads for the admin tab "Agent harness".
//   node record.mjs part --out DIR --dest DIR     in the fix job, after the loop: DIR/loop.json + DIR/brief.json -> DEST/part.json (the reason is scanned like a pull request text)
//   node record.mjs build --part FILE --out DIR   in the record job: the part + the run's facts (env) -> DIR/record.json
// THIS REPOSITORY IS PUBLIC and so is the artifact: the record holds counts, action names, file names, fixed words and ONE scanned sentence (400 characters); never the item, a log or a comment. A reason that leaks is withheld and the record says so.
// Each step also carries `s` (seconds it took), `ok` (false = the action was refused or failed: lost time), the repo `path` it read or edited (a plain file path, else '') and the tokens it wrote, so the tab can draw where the run spent its time (owner, 5 Nov 2026: "the steps he did, where he lost time, how efficient he was").
// Words (agreed with the admin tab): `verdict` = the loop's words (fix, fixed-already, not-reproducible, needs-human, false-positive) or `answer`, else ''; `stop` = the driver's word (STOPS in driver.mjs) or null; `round` 0 = the first run.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {STOPS} from './driver.mjs';
import {leaks} from './leaks.mjs';

export const VERDICTS = ['fix', 'fixed-already', 'not-reproducible', 'needs-human', 'false-positive', 'answer'];
// Why (5 Nov 2026, Gitar on #3194): the engine rule (engine.mjs SONNET_ENGINES) lets two engines answer, so the model is named from the engine that did; an unknown engine names none.
export const MODELS = {claude: 'claude-sonnet-5-5', codex: 'gpt-6.1-sol'};
const REASON_CHARS = 400, FILES = 20, ERRORS = 5;
const one = text => String(text || '').replace(/\s+/g, ' ').trim();

/** The facts only the fix job knows. `loop` = run.mjs's loop.json, `brief` = the item (for the leak scan only), `title` = the scanned pull request title, `files` = changed file names. A reason that may not be public is withheld, and says why in words that never repeat it. */
export function partOf({loop, brief, title = '', files = []}) {
  const errors = [], verdict = VERDICTS.includes(loop.verdict) ? loop.verdict : '';
  let reason = one(verdict === 'fix' ? title : loop.body).slice(0, REASON_CHARS);
  const held = reason ? leaks(reason, brief) : [];
  if (held.length) { errors.push(`the reason was withheld: it held ${held.join(', ')}`); reason = ''; }
  const stopped = String(loop.stopped || '').split(':')[0];
  if (stopped) errors.push(`the loop stopped: ${stopped === 'api' ? 'the broker refused or no Sonnet-level engine answered' : stopped}`);
  const turns = Array.isArray(loop.steps) ? loop.steps : [], n = value => Math.max(0, Math.round(Number(value) || 0));
  return {engine: one(loop.engine).slice(0, 60), model: MODELS[loop.engine] || '', turns: Number(loop.turns) || 0, calls: Number(loop.calls) || 0, tokens_in: Number(loop.tokens_in) || 0, tokens_out: Number(loop.tokens_out) || 0,
    steps: turns.slice(0, 60).map((turn, i) => ({n: i + 1, action: one(turn?.action).slice(0, 20), s: Math.round(n(turn?.ms) / 100) / 10, ok: turn?.ok !== false, path: /^[\w./-]{1,60}$/.test(turn?.path) && !turn.path.includes('..') ? turn.path : '', tout: n(turn?.tout)})), verdict, reason, changed_files: verdict === 'fix' ? files.slice(0, FILES) : [], errors};
}

/**
 * The record from the part (null for a conflict round, which runs no AI or when the fix job never got that far) and the run's facts. `facts`: source, ref, round, started (UTC), now (ms), pr, stop, results {fix, prove, publish}.
 * Invariants: v is 1; every field is a bounded copy; `stop` is a driver word or null; `verdict` is a loop word or ''. Test: desktop/test/tooling/ci/fixer-record.test.js (and harness-stats.mjs reads it unchanged).
 */
export function buildRecord(part, facts) {
  const p = part || partOf({loop: {}, brief: {text: '', files: {}}}), errors = [...p.errors];
  for (const [job, result] of Object.entries(facts.results || {})) if (result === 'failure' || result === 'cancelled') errors.push(`the ${job} job ${result}`);
  const started = Date.parse(facts.started), pr = Number(facts.pr);
  return {v: 1, workflow: 'ai-fixer', started: Number.isFinite(started) ? new Date(started).toISOString().replace(/\.\d+Z$/, 'Z') : '', minutes: Number.isFinite(started) ? Math.max(0, Math.round((facts.now - started) / 6000) / 10) : 0,
    source: String(facts.source || '').slice(0, 12), ref: String(facts.ref || '').slice(0, 40), round: Math.max(0, Number(facts.round) || 0), engine: p.engine, model: p.model, turns: p.turns, calls: p.calls, tokens_in: p.tokens_in, tokens_out: p.tokens_out,
    steps: p.steps, verdict: p.verdict, reason: p.reason, changed_files: p.changed_files, pr: Number.isInteger(pr) && pr > 0 ? pr : null, stop: Object.hasOwn(STOPS, facts.stop) ? facts.stop : null, errors: errors.slice(0, ERRORS)};
}

const flag = (args, name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] || '' : ''; };
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

async function main(argv = process.argv.slice(2), env = process.env, now = Date.now()) {
  const [command, ...args] = argv;
  if (command === 'part') {
    const out = flag(args, '--out'), dest = flag(args, '--dest'), loop = JSON.parse(read(path.join(out, 'loop.json')) || '{}');
    // The files are the checked patch's own (the check step wrote DIR/change.patch), the same list the walls judged.
    const files = loop.verdict === 'fix' && fs.existsSync(path.join(out, 'change.patch')) ? execFileSync('git', ['apply', '--numstat', path.join(out, 'change.patch')], {encoding: 'utf8'}).split('\n').map(line => line.split('\t')[2]).filter(Boolean) : [];
    fs.mkdirSync(dest, {recursive: true});
    fs.writeFileSync(path.join(dest, 'part.json'), JSON.stringify(partOf({loop, brief: JSON.parse(read(path.join(out, 'brief.json')) || '{"text":""}'), title: loop.verdict === 'fix' ? read(path.join(out, 'pr-body.md')).split('\n')[0] : '', files})));
    console.log('record part: written');
  } else if (command === 'build') {
    const out = flag(args, '--out'), partText = read(flag(args, '--part'));
    let part = null;
    try { part = partText ? JSON.parse(partText) : null; } catch { part = null; }
    const record = buildRecord(part, {source: env.SOURCE, ref: env.REF, round: env.ROUND, started: env.STARTED, now, pr: env.PR, stop: env.STOP, results: {fix: env.FIX, prove: env.PROVE, publish: env.PUBLISH}});
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, 'record.json'), JSON.stringify(record));
    console.log(`record: ${record.verdict || 'no verdict'}, ${record.steps.length} step(s), ${record.minutes} min`);   // words and counts only
  } else throw new Error('usage: record.mjs part|build (see the header)');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::ai-fixer record: ${String(error.message).slice(0, 200)}`); process.exit(1); });
