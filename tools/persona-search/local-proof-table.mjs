// The one table of a local proof (tools/persona-search/local-proof.mjs): one column per run, read from its press row (presses.jsonl: metrics.py, funnel.py, ttfr.py) and run-1.log;
// with --runs N, noise() prints each side's runs, median and range, the boards each run read, and one verdict (gain shown, loss shown, inside the noise, not enough runs).
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const LIMIT = /CliLimitError|usage window is exhausted|usage limit|not signed in on this computer|did not answer twice in a row/;
const AI_CALL = /^\[\d+s\] AI call: (\S+) \([^)]*\): asked at ([\d.]+) s, (?:no slot queue|waited ([\d.]+) s for a slot), answered at ([\d.]+) s \(([\d.]+) s\)/;
const STAGES = /^\[\d+s\] Stages: (.+?) read (\d+)(.*)$/;
const BOARD = /^Job boards found: (.+?) ([\d,]+) job\(s\), ([\d,]+) relevant/;   // as funnel.py BOARD: one board's read
const PROPOSED = /^Job boards (proposed for .+?|of your field): (.+)$/;   // the AI's draw of boards for this run
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
  const boards = {}, proposed = [];
  for (const l of log) {
    const part = l.replace(/^\[\d+s\] (?:⏳ )?/, ''), b = BOARD.exec(part), p = PROPOSED.exec(part);
    if (b) { const [jobs, relevant] = [b[2], b[3]].map(n => Number(n.replace(/,/g, ''))), was = boards[b[1]] || {jobs: 0, relevant: 0};
      boards[b[1]] = {jobs: Math.max(was.jobs, jobs), relevant: Math.max(was.relevant, relevant)}; }   // a board read twice keeps its best read, as funnel.py
    if (p) proposed.push(`${p[1].replace('proposed for ', '')}: ${p[2]}`);
  }
  const lines = f => text(path.join(out, 'tape', f)).split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  // A replayed run (--same-draw): the AI answers it asked live (not on the tape: src/search_tape.py keeps them with live: true) and the pages the tape lacked (missing.jsonl, served as unreachable)
  const tape = fs.existsSync(path.join(out, 'tape')) ? {live: lines('ai.jsonl').filter(a => a.live).map(a => String(a.texts?.[0] ?? '').replace(/\s+/g, ' ').slice(0, 80)),
    pagesMissing: lines('missing.jsonl').filter(m => m.web).length} : null;
  const kinds = {};
  for (const s of row?.sources || []) { const k = (kinds[s.kind || 'other'] ||= {sources: 0, open: 0, listed: 0, fit70: 0}); k.sources++; k.open += s.open || 0; k.listed += s.in_places || 0; k.fit70 += s.fit70 || 0; }
  // Why (gp, 12 Nov 2026): the first matching line was a bare "CliLimitError" and every stop read as the plan's limit; two p10 runs had lost Claude Code for a
  // second while it updated itself. The run's own "AI stopped: <why>" / "AI limit reached: <why>" line (src/ai/cost.py) names the cause, so it comes first.
  const limit = all.split('\n').find(l => /AI (?:stopped|limit reached): /.test(l)) || all.split('\n').find(l => LIMIT.test(l));
  return {label, code, wall: seconds, row, calls, steps, stages, kinds, boards, proposed, tape, limit: limit ? limit.trim().slice(0, 160) : null,
    tail: all.trim().split('\n').at(-1) || ''};
}

/** Why a run does not count (the AI stopped, in the run's own words: the plan's limit, Claude Code missing or signed out; no press row; a crash), or null when it counts. */
export function notCounted(x) {
  return x.limit ? `the AI stopped (${x.limit.replace(/^\[\d+s\] (?:AI stopped: )?/, '').slice(0, 100)})` : !x.row ? `no press row (${x.tail.slice(0, 60)})` : x.row.crashes?.length ? `${x.row.crashes.length} crash(es)` : null;
}

/** Whether a replayed run was proposed the same boards as the recording it replays (`draw`, its read): 'shared', 'draw NOT shared', or 'draw unchecked' when the recording logged no proposed boards. */
export function drawShared(x, draw) {
  if (!draw.proposed.length) return 'draw unchecked (no boards proposed)';   // Why (Gitar on #3848): two empty lists are equal without anything compared
  return [...x.proposed].sort().join('\n') === [...draw.proposed].sort().join('\n') ? 'shared' : 'draw NOT shared';
}
const tapeCell = (x, draw) => (x.tape ? `${drawShared(x, draw)} · ${x.tape.live.length} live · ${x.tape.pagesMissing} off tape` : '–');

/** The printed table: one column per run (before | after when two). */
export function table(runs) {
  const r = runs.map(read), rows = [];
  const add = (what, f) => rows.push([what, ...r.map(x => { try { const v = f(x); return v == null ? '–' : String(v); } catch { return '–'; } })]);
  add('Code', x => x.label);
  add('Counts?', x => (notCounted(x) ? `NO: ${notCounted(x)}` : 'yes'));
  add('Wall clock (search + start-up)', x => (Number.isFinite(x.wall) ? `${x.wall} s (${x.row.seconds} + ${x.wall - x.row.seconds})` : `search ${x.row.seconds} s`));
  add('Jobs listed in your places', x => x.row.in_places);
  add('… scored · fit 70+', x => `${x.row.scored_in_places} · ${x.row.fit70_in_places}`);
  add('1st · 10th job in your places', x => `${x.row.ttfr?.first_in_places_s ?? '–'} s · ${x.row.ttfr?.tenth_in_places_s ?? '–'} s`);
  const kinds = [...new Set(r.flatMap(x => Object.keys(x.kinds)))].sort();
  for (const k of kinds) add(`Listed from ${k} (sources · open → in places · 70+)`, x => (x.kinds[k] ? `${x.kinds[k].sources} · ${x.kinds[k].open} → ${x.kinds[k].listed} · ${x.kinds[k].fit70}` : 0));
  add('Employer sites read · jobs looked at', x => `${x.row.funnel?.employer_sites_read ?? '–'} · ${x.row.funnel?.looked ?? '–'}`);
  if (runs[0].draw) add('Same draw? (boards proposed · AI live · pages off tape)', x => tapeCell(x, runs[0].draw));
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
  // Why (12 Nov 2026, owner, quoted by coordinator sa: "Let's do only 1 live search before and after. not 3 (which are 6)"): one search a side, started together, is a search PR's proof;
  //   its difference is read against the person's usual one (11 Nov 2026, as, measured: the same code on p10 listed 46, 60 and 59 jobs as the web search found 3 or 5 boards)
  if (r.length > 1) lines.push('Rule (one search a side, owner 12 Nov 2026): a loss larger than this person\'s usual run-to-run difference holds the PR (p10: the same code listed 46-60, boards and web search vary); a gain is claimed only with its mechanism proven by a test.');
  // Why (Gitar on #3831): the table reads the engine's log lines (src/ai/call_log.py, src/sources/job_stage.py); a run with a press row but no AI call line read means their format changed, said aloud instead of dashes
  for (const x of r) if (x.row && !x.calls.length) lines.push(`\n⚠️ ${x.label}: no "AI call:" line read from run-1.log: the log format changed (src/ai/call_log.py), so the AI rows are blank; fix local-proof-table.mjs AI_CALL`);
  for (const x of r) if (x.limit) lines.push(`\n⛔ NOT COUNTED (${x.label}): ${x.limit}`);
  lines.push('', ...r.map((x, i) => `Run ${i + 1} files: ${runs[i].out}`));
  return lines.join('\n');
}

const median = v => { const s = [...v].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const fact = n => (n <= 1 ? 1 : n * fact(n - 1));
/** The chance that two sides of the SAME code, n and m runs, land fully apart (either way) by luck alone: 2·n!·m!/(n+m)! (every order of the runs equally likely). */
export const apartByLuck = (n, m) => (2 * fact(n) * fact(m)) / fact(n + m);
const LUCK = 0.05;   // Why (12 Nov 2026, sa-pane-ns): the usual 1-in-20 bar, fixed before any result was seen; 2 runs a side are apart by luck 1 time in 3, 4 a side 1 in 35

/**
 * The verdict of side `b` against side `a` on their counted numbers (two arrays). The rule, printed with it:
 * a gain or loss is SHOWN only when the two ranges do not overlap (every run of one side above every run of the other) AND the same code would land that far apart by
 * luck less than 1 time in 20 (apartByLuck). Ranges that overlap or touch are inside the noise for any number of runs (more runs only widen a range); ranges apart
 * on too few runs are inside the noise until K more runs a side, the fewest that could pass the luck bar if they stay apart. One counted run a side: the search PR's proof (the difference, read against
 * the person's usual run-to-run difference). Other counts under 2 a side: not enough runs.
 * `sameDraw` (both sides replayed one recorded draw, --same-draw): when EVERY run of each side lists the same number (no spread on either side), two different numbers are
 * a gain or loss SHOWN and two equal ones no difference, whatever the run count; any spread on either side falls back to the rule above.
 */
export function verdict(a, b, sameDraw = false) {
  // Why (12 Nov 2026, owner, quoted by coordinator sa: "Let's do only 1 live search before and after"): one run a side is a search PR's proof; the luck rule below is for measuring a small effect
  if (a.length === 1 && b.length === 1) return `one run a side: ${b[0] - a[0] >= 0 ? '+' : ''}${b[0] - a[0]} listed (${a[0]} → ${b[0]}); a loss larger than this person's usual run-to-run difference holds the PR, a gain needs its mechanism proven by a test`;
  if (a.length < 2 || b.length < 2) return `not enough runs: ${a.length} and ${b.length} counted runs (2 a side at least)`;
  const [aLo, aHi, bLo, bHi] = [Math.min(...a), Math.max(...a), Math.min(...b), Math.max(...b)];
  // Why (12 Nov 2026, coordinator sa on #3848): the luck rule assumes runs that vary; a replay of one draw repeats exactly (p9: 34 four times), so an exact repeat on both sides is proof by itself
  if (sameDraw && aLo === aHi && bLo === bHi) {
    return aLo === bLo ? `no difference: both sides repeat exactly (${aLo} listed) under the same draw`
      : `${bLo > aLo ? 'gain' : 'loss'} shown: ${bLo > aLo ? '+' : ''}${bLo - aLo} listed (${aLo} → ${bLo}); both sides repeat exactly under the same draw (${a.length} and ${b.length} runs)`;
  }
  if (bLo <= aHi && aLo <= bHi) return `inside the noise: the ranges overlap (${aLo}-${aHi} and ${bLo}-${bHi}); more runs only widen a range, so any effect is smaller than the search's own spread`;
  const luck = apartByLuck(a.length, b.length), way = bLo > aHi ? 'gain' : 'loss';
  if (luck < LUCK) return `${way} shown: ${median(b) - median(a) > 0 ? '+' : ''}${median(b) - median(a)} listed (median), every run apart; the same code lands this far apart 1 time in ${Math.round(1 / luck)}`;
  let k = 1;
  while (apartByLuck(a.length + k, b.length + k) >= LUCK) k++;
  return `inside the noise: the ranges are apart (a possible ${way}), but the same code lands this far apart 1 time in ${Math.round(1 / luck)} with ${a.length} and ${b.length} runs: ${k} more run${k > 1 ? 's' : ''} a side needed`;
}

/** The --runs table: per side each run's listed jobs and boards, the median and range of the counted runs, the boards each run read and the AI proposed, and the verdict of every side against side 1. */
export function noise(sides, name, draw) {
  const s = sides.map(side => ({...side, read: side.runs.map(run => read({...run, name}))}));
  const cell = x => (notCounted(x) ? 'NOT COUNTED' : `${x.row.in_places} · ${x.row.funnel?.boards_read ?? '–'} · ${x.row.funnel?.board_jobs ?? '–'} · ${x.row.funnel?.board_relevant ?? '–'}`);
  const counted = side => side.read.filter(x => !notCounted(x));
  const spread = v => (v.length ? `${median(v)} (${Math.min(...v)}-${Math.max(...v)})` : '–');
  const width = [44, ...s.map(() => 36)], fmt = cells => cells.map((c, i) => String(c).padEnd(width[i])).join(' │ ').trimEnd();
  const rows = [fmt([`${name} · ${Math.max(...s.map(x => x.runs.length))} runs a side`, ...s.map((x, i) => `side ${i + 1}: ${x.label}`.slice(0, 36))]), '─'.repeat(width.reduce((t, w) => t + w + 3, 0))];
  for (let i = 0; i < Math.max(...s.map(x => x.read.length)); i++) rows.push(fmt([`Run ${i + 1}: listed · boards read · jobs · relevant`, ...s.map(x => (x.read[i] ? cell(x.read[i]) : '–'))]));
  if (draw) for (let i = 0; i < Math.max(...s.map(x => x.read.length)); i++) rows.push(fmt([`Run ${i + 1}: same draw? · AI live · pages off tape`, ...s.map(x => (x.read[i] ? tapeCell(x.read[i], draw.read) : '–'))]));
  rows.push(fmt(['Jobs listed in your places: median (range)', ...s.map(x => spread(counted(x).map(r => r.row.in_places)))]));
  rows.push(fmt(['Board jobs relevant: median (range)', ...s.map(x => spread(counted(x).map(r => r.row.funnel?.board_relevant ?? 0)))]));
  rows.push(fmt(['Runs counted', ...s.map(x => `${counted(x).length} of ${x.read.length}`)]));
  for (const x of s) x.read.forEach((r, i) => notCounted(r) && rows.push(`⛔ NOT COUNTED (side ${s.indexOf(x) + 1}, run ${i + 1}): ${notCounted(r)}; left out of the median, not re-run`));
  if (draw) {
    rows.push('', `The shared draw (recorded by side 1's code, not counted: listed ${draw.read.row.in_places}): ${draw.out}`, ...draw.read.proposed.map(p => `  proposed ${p.slice(0, 150)}`));
    for (const [j, x] of s.entries()) x.read.forEach((r, i) => r.tape?.live.forEach(a => rows.push(`  side ${j + 1} run ${i + 1} AI answered live (not on the tape): ${a}`)));
  }
  rows.push('', 'Job boards read (relevant/jobs) and the boards the AI proposed, per run:');
  for (const [j, x] of s.entries()) x.read.forEach((r, i) => {
    rows.push(`  side ${j + 1} run ${i + 1} read: ${Object.entries(r.boards).map(([b, n]) => `${b.replace(/ \(.*$/, '')} ${n.relevant}/${n.jobs}`).join(', ') || 'none'}`);
    for (const p of r.proposed) rows.push(`  side ${j + 1} run ${i + 1} proposed ${p.slice(0, 150)}`);
  });
  rows.push('', 'Rule: on "Jobs listed in your places", a gain or loss is shown only when the two sides\' ranges do not overlap AND the same code would land that far apart by luck under 1 time in 20 (2·n!·m!/(n+m)!); one run a side reads as a search PR\'s proof (owner, 12 Nov 2026): a loss larger than the person\'s usual difference holds it.');
  if (draw) rows.push('Same draw: when every run of each side lists the same number, two different numbers are shown as a gain or loss (and equal ones as no difference) from 2 runs a side; any spread on a side uses the rule above.');
  const base = counted(s[0]).map(r => r.row.in_places);
  // Why (12 Nov 2026, coordinator sa): a run that asked the AI live or missed pages read something the recording lacks, which the replay cannot judge; said on the verdict line itself
  const offTape = j => [...counted(s[0]), ...counted(s[j])].filter(r => r.tape && (r.tape.live.length || r.tape.pagesMissing)).length;
  for (let j = 1; j < s.length; j++) {
    const warn = draw && offTape(j) ? ` · ⚠️ ${offTape(j)} run(s) asked the AI live or read pages the recording lacks: the replay cannot judge that part; run without --same-draw` : '';
    rows.push(`Verdict (side ${j + 1} against side 1): ${verdict(base, counted(s[j]).map(r => r.row.in_places), Boolean(draw))}${warn}`);
  }
  if (s.length === 1) rows.push(`One side: the same code listed ${spread(base)} jobs; no verdict without a second --ref`);
  rows.push('', `Run files (one run's full table: node tools/persona-search/local-proof-table.mjs ${name} <folder>...):`, ...s.flatMap((x, j) => x.runs.map((r, i) => `  side ${j + 1} run ${i + 1}: ${r.out}`)));
  return rows.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {   // re-print a table: node local-proof-table.mjs <name> <out folder>...
  const [name, ...outs] = process.argv.slice(2);
  console.log(table(outs.map(out => ({out, name, code: 0, seconds: NaN, label: path.basename(out)}))));
}
