// Strategy's one "scored using previous search settings" notice (owner, 18 Oct 2026: "one consolidated notice", "count unique affected jobs",
// "saving settings must not silently start a paid re-score", "while running, show progress and prevent duplicate starts", "show the cost only if
// it's calculated", 17 Oct): the words, the one start (its dialog's own button, never twice), no other path that re-scores, and the IPC to the engine.
// tests/test_strategy_outdated.py checks the engine counts each job once.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {dialogLead, noticeTitle, reasonsText} from '../renderer/rescore-words.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const screen = read('renderer/pages/strategy-rescore.js');
const run = read('renderer/pages/rescore-run.js');   // the running state and the one start, shared with Jobs (2 Nov 2026)

test('the notice says how many jobs, once each, and why only when asked', () => {
  assert.equal(noticeTitle(1), '1 job was scored using previous search settings.');
  assert.equal(noticeTitle(12), '12 jobs were scored using previous search settings.');
  assert.equal(reasonsText({method: 4, places: 9}), '4 jobs: an older way of scoring · 9 jobs: other places than your current ones');
  assert.equal(reasonsText({method: 0, places: 1}), '1 job: other places than your current ones');
  assert.match(screen, /Each job is counted once/);
});

test('the dialog gives no invented cost and says applications are left alone', () => {
  assert.match(dialogLead(5), /Cost: not calculated/);
  assert.doesNotMatch(dialogLead(5) + screen, /\$\d|~\$/);
  assert.match(dialogLead(5), /Your applications and their stages are not changed/);
  assert.match(dialogLead(61), /the rest in the next searches/);
});

test('the re-score starts only from a dialog\'s own button, once at a time, until its search ends', () => {
  assert.equal((run.match(/window\.pilot\.rescoreOutdated\(\)/g) || []).length, 1);
  assert.match(run, /dialog\.onclose = \(\) => \{ if \(dialog\.returnValue === 'go'\) runRescore\(count, how\); \};/);
  assert.match(run, /if \(running\) return;/);
  assert.match(screen, /go\.disabled = busy;/);
  assert.match(run, /const searching = startSearch\(\{reason: 'rescore', count: result\.queued\}\);[^\n]*resolves when the search ends/);
  assert.match(run, /\n\s*await searching;/, 'busy until its search ends');
  assert.match(run, /if \(refusal\(await Promise\.race\(\[searching, /, '"Re-scoring now" only when the search was not refused (test/start-refusals.test.js)');
  assert.match(run, /finally \{\s*running = null;/);
});

test('no other path re-scores: saving settings never starts one by itself', () => {
  const renderer = ['renderer/pages/strategy.js', 'renderer/pages/strategy-targets.js', 'renderer/pages/strategy-cards.js', 'renderer/pages/main-goals.js', 'renderer/pages/strategy-suggestions.js', 'renderer/pages/job-preferences.js',
    'renderer/pages/locations-which.js', 'renderer/pages/locations-card.js'];
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

test('the IPC reaches the engine command (tests/test_strategy_outdated.py checks the engine has it)', () => {
  assert.match(read('lib/job-actions-handlers.js'), /ipcMain\.handle\('rescoreOutdated'[\s\S]*?'src\.desktop', 'rescore-outdated'/);
  assert.match(read('preload.cjs'), /rescoreOutdated: call\('rescoreOutdated'\)/);
  assert.match(read('lib/demo.js'), /'rescoreOutdated'/, 'demo mode never re-scores');
});
