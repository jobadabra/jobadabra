// Runs the AI user agent's judge exam (lib/agent-judge-set.mjs) through the AI broker: the old judge and the current one on the 11 recorded notes, RUNS times each, and writes the before/after table. Used by .github/workflows/ai-judge-set.yml.
// Job: report health
// Why (5 Nov 2026, owner via mac-32: "Judge first"): a report-only measurement of the judge, never a gate; a broker that refuses ends it with the reason, nothing is scored from a partial answer.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {brokerAsk} from './lib/agent-ask.mjs';
import {RUNS, askBatch, askSet, batchMarkdown, knowledgeOf, loadBatch, loadSet, scoreBatch, scoreRows, tableMarkdown} from './lib/agent-judge-set.mjs';
import {holdingIds} from './lib/agent-notes.mjs';
import {readExpectations} from './lib/agent-memory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), out = process.argv[2] || path.join(here, 'judge-set-out');
const notes = loadSet(path.join(here, 'fixtures/agent-judge-set')), expectations = readExpectations(path.join(here, '../../docs/app-expectations'));
const ask = brokerAsk('mid', {only: 'claude'});
const before = scoreRows(await askSet({ask, notes, expectations, variant: 'before'}));
const afterRows = await askSet({ask, notes, expectations, variant: 'after'});
const after = scoreRows(afterRows);
const table = tableMarkdown(before, after);
// Why (7 Nov 2026, pz, owner via mac-50: "Don't gate filing on the judge alone: it dropped 5 of 7 real ones on 5 Nov. Say what you'd change there, with the numbers"; exam run 42407753226): the tour set again under the production rule, a disagree holds a note only through a rule the note itself cited or a closed verdict (a bare "names a rule id" held real note #9 in 3 of 3 runs), next to the judge alone.
const tourHeld = afterRows.map(row => {
  const note = notes.find(each => each.n === row.n);
  return {n: row.n, label: row.label, disagreed: row.verdicts.filter(v => v === 'disagrees').length, holdingRuns: row.verdicts.filter((v, i) => v === 'disagrees' && holdingIds(note, row.reasons[i], knowledgeOf(note, expectations)).length > 0).length};
});
// Per night the production rule asks once per note, so a note's held share is its holding runs of RUNS; the sum over the notes is what a night would hold on average.
const heldShare = label => tourHeld.filter(row => row.label === label).reduce((sum, row) => sum + row.holdingRuns / RUNS, 0);
const count = label => tourHeld.filter(row => row.label === label).length;
const tourLine = `Tour set under the production rule (a disagree holds a note only through a rule the note cited or a closed verdict), ${RUNS} runs each: real notes held per night ${heldShare('real').toFixed(1)} of ${count('real')} (a judge-alone gate would drop ${tourHeld.filter(row => row.label === 'real' && row.disagreed * 2 > RUNS).length} by majority); false notes held ${heldShare('false').toFixed(1)} of ${count('false')}. Per note (disagreed / holding, of ${RUNS}): ${tourHeld.map(row => `#${row.n} ${row.label[0]} ${row.disagreed}/${row.holdingRuns}`).join(', ')}.`;
// Why (7 Nov 2026, pz): batch 1 of the persona lanes replayed with the old rules, the three new rules, and the closed verdicts, each alone (a recurrence test: the closed verdicts are those of these very notes; the real notes show nothing is over-dropped).
const batch = loadBatch(path.join(here, 'fixtures/agent-judge-set-b1'));
const batchScores = {};
for (const [name, variant] of [['old rules', 'before'], ['+ the 3 new rules', 'rules'], ['+ closed verdicts (own included: the same report again)', 'closed'], ['+ closed verdicts (own left out: a new report)', 'others']]) batchScores[name] = scoreBatch(await askBatch({ask, notes: batch.notes, expectations, lessons: batch.lessons, variant}));
const batchTable = batchMarkdown(batchScores);
fs.mkdirSync(out, {recursive: true});
fs.writeFileSync(path.join(out, 'judge-set.json'), JSON.stringify({before, after, afterRows, tourHeld, batchScores}, null, 1));
fs.writeFileSync(path.join(out, 'judge-set.md'), `${table}\n\n${tourLine}\n\n### Batch 1 of the persona lanes\n\n${batchTable}\n`);
console.log(`${table}\n\n${tourLine}\n\n${batchTable}`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## AI user agent judge exam\n\n${table}\n\n${tourLine}\n\n### Batch 1 of the persona lanes\n\n${batchTable}\n`);
