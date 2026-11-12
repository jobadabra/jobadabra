// Strategy's one "scored using previous search settings" notice (owner, 18 Oct 2026: "one consolidated notice", "count unique affected jobs",
// "saving settings must not silently start a paid re-score", "while running, show progress and prevent duplicate starts", "show the cost only if
// it's calculated", 17 Oct): the words, the one start (its dialog's own button, never twice), no other path that re-scores, and the IPC to the engine.
// tests/unit/ai/test_strategy_outdated.py checks the engine counts each job once.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {callButton, dialogLead, noticeTitle, pressLabel, reasonsText} from '../../../renderer/rescore-words.js';

const read = file => readScreenSource(new URL(`../../../${file}`, import.meta.url), 'utf8');
const screen = read('renderer/pages/strategy-rescore.js');
const run = read('renderer/pages/rescore-run.js');   // the running state and the one start, shared with Jobs (2 Nov 2026)

test('the notice says how many jobs, once each, and why only when asked', () => {
  assert.equal(noticeTitle(1), '1 job was scored using previous search settings.');
  assert.equal(noticeTitle(12), '12 jobs were scored using previous search settings.');
  assert.equal(reasonsText({method: 4, places: 9}), '4 jobs: an older way of scoring · 9 jobs: other places than your current ones');
  assert.equal(reasonsText({method: 0, places: 1}), '1 job: other places than your current ones');
  assert.equal(reasonsText({changed: 3}), '3 jobs: the posting or your Profile changed since the score', 'a Profile edit or a changed posting is an old score too');
  assert.match(screen, /Each job is counted once/);
});

test('the dialog gives no invented cost and says applications are left alone', () => {
  assert.match(dialogLead(5), /Cost: not calculated/);
  assert.doesNotMatch(dialogLead(5) + screen, /\$\d|~\$/);
  assert.match(dialogLead(5), /Your applications and their stages are not changed/);
  assert.match(dialogLead(61), /press Re-score again for the rest/);
  assert.doesNotMatch(dialogLead(5), /press Re-score again/, 'nothing is left over for 5 jobs');
  assert.match(dialogLead(5), /Finding new jobs never re-scores them/, 'a re-score is not a search (owner, 3 Nov 2026)');
});

test('the re-score starts only from a dialog\'s own button, once at a time, until its search ends', () => {
  assert.equal((run.match(/window\.pilot\.rescoreOutdated\(\)/g) || []).length, 1);
  assert.match(run, /dialog\.onclose = \(\) => \{ if \(dialog\.returnValue === 'go'\) runRescore\(count, how\); \};/);
  assert.match(run, /if \(running\) return;/);
  assert.match(screen, /go\.disabled = busy;/);
  assert.match(run, /const searching = startSearch\(\{reason: 'rescore', count: result\.queued\}\);[^\n]*resolves when the search ends/);
  assert.match(run, /\n\s*await searching;/, 'busy until its search ends');
  assert.match(run, /if \(refusal\(await Promise\.race\(\[searching, /, '"Re-scoring now" only when the search was not refused (test/guards/rules/start-refusals.test.js)');
  assert.match(run, /finally \{\s*running = null;/);
});

test('no other path re-scores: saving settings never starts one by itself', () => {
  const renderer = ['renderer/pages/strategy.js', 'renderer/pages/strategy-targets.js', 'renderer/pages/strategy-cards.js', 'renderer/pages/main-goals.js', 'renderer/pages/strategy-suggestions.js', 'renderer/pages/job-preferences.js',
    'renderer/pages/locations-card.js'];
  for (const file of renderer) assert.doesNotMatch(read(file), /rescoreOutdated|reason: 'rescore'/, `${file} must not start a re-score`);
});

test('the notice is drawn from the fresh read of the saved settings, never the saved copy or the draft', () => {
  assert.match(read('renderer/pages/strategy.js'), /renderStrategy\(\{\.\.\.saved\.result, profile_empty: false, previous: 0, outdated: null\}\)/);
  assert.match(read('renderer/pages/strategy-targets.js'), /drawOutdated\(data\.outdated, loadStrategy\);[^\n]*\n\s*if \(strategyState\.editing\)/);
});

test('only a read writes the shared count; the redraw on rescore-state reads it and never writes it back (Gitar, #3024: an old cached 12 overwrote Jobs\' 0)', () => {
  const source = read('renderer/pages/strategy-rescore.js');
  assert.match(source, /if \(fresh\) noteOutdated\(outdated\);/);
  assert.equal((source.match(/noteOutdated\(/g) || []).length, 1, 'one write, from the read');
  assert.match(source, /addEventListener\('rescore-state', \(\) => \{ if \(\$\('strategy-outdated'\) && shown\) drawOutdated\(null, reloadStrategy, \{fresh: false\}\); \}\)/);
  assert.match(source, /shown = fresh \? outdated : knownOutdated\(\);/);
});

test('the suggestions count stays apart from outdated scores', () => {
  const suggestions = read('renderer/pages/strategy-suggestions.js');
  assert.doesNotMatch(suggestions, /outdated|previous_locations|lastStrategy\?\.previous/);
});

test('the IPC reaches the engine command (tests/unit/ai/test_strategy_outdated.py checks the engine has it)', () => {
  assert.match(read('lib/job-actions-handlers.js'), /ipcMain\.handle\('rescoreOutdated'[\s\S]*?'src\.desktop', 'rescore-outdated'/);
  assert.match(read('preload.cjs'), /rescoreOutdated: call\('rescoreOutdated'\)/);
  assert.match(read('lib/demo.js'), /'rescoreOutdated'/, 'demo mode never re-scores');
});

test('Re-score is its own run, never a Find jobs search (owner, 3 Nov 2026: a job already in the list "should not be handled by find jobs at all")', () => {
  const handler = read('lib/jobs-handlers.js');
  const own = handler.indexOf('pipeline.rescore(storage');
  assert.ok(own > 0 && own < handler.indexOf('pipeline.refresh(storage'), 'a rescore reason is answered by pipeline.rescore before any refresh');
  const tasks = read('lib/pipeline-tasks.js');
  const body = tasks.slice(tasks.indexOf('export function rescore('), tasks.indexOf('export function syncMatches'));
  assert.match(body, /const mode = 'rescore'/);
  assert.doesNotMatch(body, /searchOnce|searchSteps|saveSettings|lastSearchAt|discover|scout/, 'no job boards, no employer pages, no finder, and the last search time stays');
  // the engine side: tests/unit/ai/test_rescore_mode.py (old scores replaced, a never-scored job left to Find jobs), tests/unit/ai/test_score_scope.py (the Find jobs queue)
});

test('no screen still says a Profile change is re-scored by the next searches', () => {
  for (const file of ['renderer/pages/cv-change.js', 'renderer/pages/strategy-review.js', 'renderer/pages/strategy-targets.js', 'renderer/rescore-words.js'])
    assert.doesNotMatch(read(file).replace(/\/\/.*$/gm, ''), /over the next (\$\{\w+\} )?search|rest in the next|queued for a new score/, file);
  assert.doesNotMatch(read('renderer/index.html'), /strategy-stale/, 'the "queued for a new score" line is gone: those jobs are Old score now');
});

test('every Re-score button names what one press does: "Re-score 60 now" past 60, "Re-score N" up to 60 (owner, 3 Nov 2026)', () => {
  assert.equal(pressLabel(1), 'Re-score 1');
  assert.equal(pressLabel(60), 'Re-score 60');
  assert.equal(pressLabel(61), 'Re-score 60 now');
  assert.equal(pressLabel(300), 'Re-score 60 now');
  assert.equal(callButton(300), 'Re-score 60 now', 'the Jobs card says the same as the dialog');
  for (const file of ['renderer/pages/rescore-run.js', 'renderer/pages/score-first.js'])
    assert.match(read(file), /textContent = pressLabel\(count\)/, `${file} draws its button from the one label`);
});

test('a Re-score the app quit in the middle of starts again as a Re-score, never as a Find jobs search (code review, 3 Nov 2026)', () => {
  const resume = read('lib/app-reminders.js');
  const own = resume.indexOf("job.resume.mode === 'rescore') pipeline.rescore(");
  assert.ok(own > 0 && own < resume.indexOf("else if (job.kind === 'search') pipeline.refresh("), 'the rescore mode is answered before the search kind');
});

test('Always on: a Re-score is dispatched to GitHub as mode rescore, never refused (Gitar, #3089: cloud users could not replace old scores)', () => {
  const handler = read('lib/jobs-handlers.js');
  assert.match(handler, /dispatchCloud\('Re-score', \{mode: 'rescore'\}\)/);
  assert.doesNotMatch(handler, /Re-score runs on this Mac/);
});
