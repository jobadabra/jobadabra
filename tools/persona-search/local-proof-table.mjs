// The one table of a local proof (tools/persona-search/local-proof.mjs): one column per run, read from its press row (presses.jsonl: metrics.py, funnel.py, ttfr.py) and run-1.log.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const LIMIT = /CliLimitError|usage window is exhausted|usage limit|not signed in on this computer|did not answer twice in a row/;
const AI_CALL = /^\[\d+s\] AI call: (\S+) \([^)]*\): asked at ([\d.]+) s, (?:no slot queue|waited ([\d.]+) s for a slot), answered at ([\d.]+) s \(([\d.]+) s\)/;
const STAGES = /^\[\d+s\] Stages: (.+?) read (\d+)(.*)$/;
const LINE = /^\[(\d+)s\] (?:⏳ )?([A-Z][A-Za-z ]{2,30}?)(?::| [\d(])/;   // a step's label: "Job boards:", "Scout:", "⏳ Reading employer job sites: 3 of 15"

const NOT_STEPS = new Set(['Stage', 'Stages', 'Run counts', 'Cronjob run logged', 'Claude Code haiku', 'Claude Code sonnet', 'Time budget', 'AI budget', 'Plan']);   // log lines that are no step of the search
const pct = (list, q) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : null; };
const sec = v => (v == null ? '–' : `${Math.round(v * 10) / 10} s`);

/** One run's numbers: {row, log facts}. A run with no press row reads as failed, with its run.out's last line. */
export function read({out, name, code, seconds, label}) {
  const file = f => path.join(out, name, f), text = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const row = text(file('presses.jsonl')).split('\n').filter(Boolean).map(l => JSON.parse(l))[0] || null;
  const log = text(file('run-1.log')).split('\n'), all = `${text(file('run-1.log'))}\n${text(path.join(out, 'run.out'))}`;
  const calls = log.map(l => AI_CALL.exec(l)).filter(Boolean).map(m => ({step: m[1], waited: Number(m[3] || 0), took: Number(m[5])}));
  const steps = {};
  for (const l of log) {
    const m = LINE.exec(l);
    if (m && !l.includes('AI call:') && !NOT_STEPS.has(m[2])) { const s = (steps[m[2]] ||= [Number(m[1]), Number(m[1])]); s[1] = Number(m[1]); }
  }
  const stages = log.map(l => STAGES.exec(l)).filter(Boolean).map(m => `${m[1]} read ${m[2]}${m[3]}`);
  const kinds = {};
  for (const s of row?.sources || []) { const k = (kinds[s.kind || 'other'] ||= {sources: 0, open: 0, listed: 0, fit70: 0}); k.sources++; k.open += s.open || 0; k.listed += s.in_places || 0; k.fit70 += s.fit70 || 0; }
  const limit = all.split('\n').find(l => LIMIT.test(l));
  return {label, code, wall: seconds, row, calls, steps, stages, kinds, limit: limit ? limit.trim().slice(0, 160) : null,
    tail: all.trim().split('\n').at(-1) || ''};
}

/** The printed table: one column per run (before | after when two). */
export function table(runs) {
  const r = runs.map(read), rows = [];
  const add = (what, f) => rows.push([what, ...r.map(x => { try { const v = f(x); return v == null ? '–' : String(v); } catch { return '–'; } })]);
  add('Code', x => x.label);
  add('Counts?', x => (x.limit ? 'NO: the Claude plan limit was hit' : !x.row ? `NO: no press row (${x.tail.slice(0, 60)})` : x.row.crashes?.length ? `NO: ${x.row.crashes.length} crash(es)` : 'yes'));
  add('Wall clock (search + start-up)', x => (Number.isFinite(x.wall) ? `${x.wall} s (${x.row.seconds} + ${x.wall - x.row.seconds})` : `search ${x.row.seconds} s`));
  add('Jobs listed in your places', x => x.row.in_places);
  add('… scored · fit 70+', x => `${x.row.scored_in_places} · ${x.row.fit70_in_places}`);
  add('1st · 10th job in your places', x => `${x.row.ttfr?.first_in_places_s ?? '–'} s · ${x.row.ttfr?.tenth_in_places_s ?? '–'} s`);
  const kinds = [...new Set(r.flatMap(x => Object.keys(x.kinds)))].sort();
  for (const k of kinds) add(`Listed from ${k} (sources · open → in places · 70+)`, x => (x.kinds[k] ? `${x.kinds[k].sources} · ${x.kinds[k].open} → ${x.kinds[k].listed} · ${x.kinds[k].fit70}` : 0));
  add('Employer sites read · jobs looked at', x => `${x.row.funnel?.employer_sites_read ?? '–'} · ${x.row.funnel?.looked ?? '–'}`);
  add('Job boards read · their jobs · relevant', x => `${x.row.funnel?.boards_read ?? '–'} · ${x.row.funnel?.board_jobs ?? '–'} · ${x.row.funnel?.board_relevant ?? '–'}`);
  add('Web searches · found', x => `${x.row.funnel?.web_searches ?? '–'} · ${x.row.funnel?.web_found ?? '–'}`);
  add('Titles asked by the title step · matched', x => `${x.row.funnel?.titles_asked ?? '–'} · ${x.row.funnel?.matches ?? '–'}`);
  add('AI calls · median · p90', x => `${x.calls.length} · ${sec(pct(x.calls.map(c => c.took), 0.5))} · ${sec(pct(x.calls.map(c => c.took), 0.9))}`);
  add('… waited for a slot > 1 s', x => x.calls.filter(c => c.waited > 1).length);
  const callSteps = [...new Set(r.flatMap(x => x.calls.map(c => c.step)))].sort();
  add('… by step', x => callSteps.map(s => `${s} ${x.calls.filter(c => c.step === s).length}`).filter(s => !s.endsWith(' 0')).join(', '));
  const labels = [...new Set(r.flatMap(x => Object.keys(x.steps)))].sort((a, b) => Math.min(...r.map(x => x.steps[a]?.[0] ?? 1e9)) - Math.min(...r.map(x => x.steps[b]?.[0] ?? 1e9)));
  for (const l of labels.filter(l => r.some(x => x.steps[l] && x.steps[l][1] - x.steps[l][0] >= 5))) add(`  ${l} (first → last line)`, x => (x.steps[l] ? `${x.steps[l][0]} → ${x.steps[l][1]} s` : '–'));
  const width = r.length === 1 ? [52, 60] : [52, ...r.map(() => 34)];
  const fmt = cells => cells.map((c, i) => String(c).slice(0, width[i] + 30).padEnd(width[i])).join(' │ ').trimEnd();
  const lines = [fmt(rows[0]), '─'.repeat(width.reduce((s, w) => s + w + 3, 0)), ...rows.slice(1).map(fmt)];
  for (const x of r) for (const s of x.stages) lines.push(`Stages (${x.label}): ${s}`);
  // Why (11 Nov 2026, as, measured): the same code on p10 listed 46, 60 and 59 jobs in three runs, because the job-board web search found 3 or 5 boards: one run a side cannot judge a small difference
  if (r.length > 1) lines.push('Noise: one run a side. The same code listed 46-60 jobs for p10 (11 Nov 2026, boards and web search vary): a difference under ~15 listed jobs needs 2-3 runs a side.');
  for (const x of r) if (x.limit) lines.push(`\n⛔ NOT COUNTED (${x.label}): ${x.limit}`);
  lines.push('', ...r.map((x, i) => `Run ${i + 1} files: ${runs[i].out}`));
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {   // re-print a table: node local-proof-table.mjs <name> <out folder>...
  const [name, ...outs] = process.argv.slice(2);
  console.log(table(outs.map(out => ({out, name, code: 0, seconds: NaN, label: path.basename(out)}))));
}
