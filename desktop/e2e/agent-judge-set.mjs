// Runs the AI user agent's judge exam (lib/agent-judge-set.mjs) through the AI broker: the old judge and the current one on the 11 recorded notes, RUNS times each, and writes the before/after table. Used by .github/workflows/ai-judge-set.yml.
// Job: report health
// Why (5 Nov 2026, owner via mac-32: "Judge first"): a report-only measurement of the judge, never a gate; a broker that refuses ends it with the reason, nothing is scored from a partial answer.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {brokerAsk} from './lib/agent-ask.mjs';
import {askSet, loadSet, scoreRows, tableMarkdown} from './lib/agent-judge-set.mjs';
import {readExpectations} from './lib/agent-memory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), out = process.argv[2] || path.join(here, 'judge-set-out');
const notes = loadSet(path.join(here, 'fixtures/agent-judge-set')), expectations = readExpectations(path.join(here, '../../docs/app-expectations'));
const ask = brokerAsk('mid', {only: 'claude'});
const before = scoreRows(await askSet({ask, notes, expectations, variant: 'before'}));
const afterRows = await askSet({ask, notes, expectations, variant: 'after'});
const after = scoreRows(afterRows);
const table = tableMarkdown(before, after);
fs.mkdirSync(out, {recursive: true});
fs.writeFileSync(path.join(out, 'judge-set.json'), JSON.stringify({before, after, afterRows}, null, 1));
fs.writeFileSync(path.join(out, 'judge-set.md'), `${table}\n`);
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## AI user agent judge exam\n\n${table}\n`);
