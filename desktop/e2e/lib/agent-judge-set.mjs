// The AI user agent's judge exam: 11 recorded notes of one real tour run, each with a settled label (real or false), judged again by a judge variant and scored, so a change to the judge is a number and not a guess.
// Job: report health
// Why (5 Nov 2026, owner via mac-32: "Judge first, then A + B"; tour run 41952722418): the second opinion dropped 5 of 7 real notes, the planted jobs-3 bug among them, and kept 3 of 4 false ones. The exam is the case set of the judge's prompt (the registry tools/prompt-cases.json covers app prompts only, PROMPT_FILE); one run flips some notes, so each note is asked RUNS times and scored by its majority, with the per-run numbers shown beside it.
import fs from 'node:fs';
import path from 'node:path';
import {judgeNote, judgePrompt, judgeSchema} from './agent-judge.mjs';
import {areaOfView, knowledgeFor} from './agent-knowledge.mjs';

export const RUNS = 3;

// The judge as it was before 5 Nov 2026 (the baseline the table compares with): no rules, a plain "is it plausible".
export const BEFORE_SYSTEM = `You are a careful reviewer of bug reports about a desktop job-search app. You see ONE report and, when given, a screenshot of the screen. You did not write the report and you do not know how its author reached it.
Decide only whether the report's argument holds: is what it says was OBSERVED plausible on this screen, and does that differ from what it says was EXPECTED in a way that matters for the person using the app? A report that complains about taste or wording that is fine does not hold.
Answer with the JSON asked for: "verdict" is "agrees" or "disagrees"; "reason" is one sentence.`;
const beforePrompt = note => judgePrompt(note).replace(/^What is known about the app:\n[\s\S]*?\n\nReport: /, 'Report: ');

/** The recorded set: {notes: [{n, view, title, expected, observed, label, cause, image}]} read from `dir` (notes.json and shot-<n>.png). */
export function loadSet(dir) {
  const set = JSON.parse(fs.readFileSync(path.join(dir, 'notes.json'), 'utf8'));
  return set.notes.map(note => ({...note, image: fs.readFileSync(path.join(dir, `shot-${note.n}.png`)).toString('base64')}));
}

/** The area's rules as the actor gets them: the note's screen, first letter capital (the expectation files are Jobs, Focus, Settings...). Rules only, never the field notes, so a note's own label cannot leak into its judgement. */
export const knowledgeOf = (note, expectations) => knowledgeFor([areaOfView(note.view)], {expectations});

/**
 * Asks one judge variant ('before' | 'after') about every note, `runs` times each. `ask` is the broker call on the mid tier (Claude alone). -> [{n, label, verdicts: ['agrees', ...], reasons: [...]}]
 * The before variant is the old system and prompt through the same schema; the after variant is judgeNote as the agent runs it.
 */
export async function askSet({ask, notes, expectations, variant, runs = RUNS}) {
  const rows = [];
  for (const note of notes) {
    const row = {n: note.n, label: note.label, verdicts: [], reasons: []};
    for (let i = 0; i < runs; i++) {
      const opinion = variant === 'before'
        ? await judgeNote({ask: args => ask({...args, system: BEFORE_SYSTEM, messages: [{...args.messages[0], content: args.messages[0].content.map(part => part.type === 'text' ? {...part, text: beforePrompt(note)} : part)}], schema: judgeSchema()}), note, image: note.image})
        : await judgeNote({ask, note, image: note.image, knowledge: knowledgeOf(note, expectations)});
      // Why (5 Nov 2026, Gitar on #3240): a refused or capped broker makes the judge answer 'unavailable', and scoring that as a verdict would print a bad score that is only a refusal; the exam stops there and writes no table.
      if (opinion.verdict === 'unavailable') throw new Error(`judge exam stopped at note ${note.n} (${variant}, run ${i + 1}): ${opinion.reason}`);
      row.verdicts.push(opinion.verdict); row.reasons.push(opinion.reason);
    }
    rows.push(row);
  }
  return rows;
}

const majority = verdicts => { const agrees = verdicts.filter(v => v === 'agrees').length, disagrees = verdicts.filter(v => v === 'disagrees').length; return agrees * 2 > verdicts.length ? 'agrees' : disagrees * 2 > verdicts.length ? 'disagrees' : 'unknown'; };   // a strict majority of all the asks, so one vote beside wrong-shape answers is not a verdict

/** Scores rows: a real note is kept when its majority agrees, a false one is dropped when its majority disagrees; also the same counts per run (the noise). */
export function scoreRows(rows) {
  const real = rows.filter(row => row.label === 'real'), fake = rows.filter(row => row.label === 'false');
  const runs = Math.max(0, ...rows.map(row => row.verdicts.length));
  const perRun = Array.from({length: runs}, (_, i) => ({keptReal: real.filter(row => row.verdicts[i] === 'agrees').length, droppedFalse: fake.filter(row => row.verdicts[i] === 'disagrees').length}));
  return {realTotal: real.length, falseTotal: fake.length, keptReal: real.filter(row => majority(row.verdicts) === 'agrees').length, droppedFalse: fake.filter(row => majority(row.verdicts) === 'disagrees').length, perRun,
    rows: rows.map(row => ({n: row.n, label: row.label, verdict: majority(row.verdicts), verdicts: row.verdicts, right: row.label === 'real' ? majority(row.verdicts) === 'agrees' : majority(row.verdicts) === 'disagrees'}))};
}

/** The before/after table as markdown: the two scores, the per-run counts and every note's majority verdict. */
export function tableMarkdown(before, after) {
  const line = (name, s) => `| ${name} | ${s.keptReal} of ${s.realTotal} | ${s.droppedFalse} of ${s.falseTotal} | ${s.perRun.map(r => `${r.keptReal}/${r.droppedFalse}`).join(', ')} |`;
  const mark = row => `${row.right ? '✅' : '❌'} ${row.verdict}`;
  return ['| Judge | Real notes kept | False notes dropped | Per run (real kept / false dropped) |', '|---|---|---|---|', line('before', before), line('after', after), '',
    '| Note | Label | Before | After |', '|---|---|---|---|', ...after.rows.map((row, i) => `| ${row.n} | ${row.label} | ${mark(before.rows[i])} | ${mark(row)} |`)].join('\n');
}
