// The automatic refill's caps (owner, 17 Oct 2026: $0.50 a run, only rows a refill can turn green; the $5 a month cap went on 3 Nov 2026 with the API key). Guards lib/refill.mjs pickRefill worseOnly, the PR gate's dispatch step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {AUTO_RUN_USD, autoRunName, pickRefill} from '../../lib/refill.mjs';

const workflow = name => fs.readFileSync(new URL(`../../../../.github/workflows/${name}`, import.meta.url), 'utf8');
const form = (filled, left) => ({reached: 'form', filled, left});
const asked = (name, now, live = form(9, 7)) => ({name, outcome: now, liveOutcome: live, network: {hit: 2, extra: 2, notRecorded: 0}, firstMiss: {differs: ['user:left_unfilled (lines 2 of 3)']}});

test('the per-run estimate cap is $0.50, and there is no monthly dollar cap to read', () => {
  assert.equal(AUTO_RUN_USD, 0.5);
  assert.doesNotMatch(workflow('replay-refill.yml').split('\n').filter(line => !line.trim().startsWith('#')).join('\n'), /refill-auto\.mjs cap|COST_KEY|AI_COST_PUBLISH_KEY/, 'nothing reads the month back from /ai-cost: broker calls are not dollars there');
});

test('the automatic pick takes only rows whose outcome fell: a refill can change their verdict, not the others', () => {
  const records = [asked('kept', form(9, 7)), asked('better', form(10, 6)), asked('fell', form(8, 8))];
  assert.deepEqual(pickRefill({pins: ['kept', 'better', 'fell'], records, worseOnly: true}).rows.map(row => row.name), ['fell']);
  assert.deepEqual(pickRefill({pins: ['kept', 'better', 'fell'], records}).rows.map(row => row.name), ['better', 'fell', 'kept'], 'by hand: every stale row, as before');
});

test('the refill workflow keeps its per-run estimate cap and alerts when one stops it; no replay starts it', () => {
  const refill = workflow('replay-refill.yml');
  assert.doesNotMatch(workflow('site-replays.yml'), /gh workflow run replay-refill/, 'owner, 17 Oct 2026: no refill trigger from a replay');
  assert.match(refill, /run-name: .*Replay refill/);
  assert.match(refill, /--worse-only --max-usd/);
  assert.match(refill, /refill-auto\.mjs alert/);
  assert.equal(autoRunName(12, 'abcdef0123'), 'Replay refill PR 12 @ abcdef0');
});
