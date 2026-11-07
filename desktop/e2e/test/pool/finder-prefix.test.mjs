// Guard: data — a title tag a reader does not know loses the issue's view in the Finder's matching, lessons and closing (the open issues are the loop's data); every source files with its prefix and each is read back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {LEGACY_TAG, PREFIXES, TAG, prefixOf, stripTag, textOfTitle, titleOf, viewOfTitle} from '../../lib/finder-prefix.mjs';
import {DETECTORS} from '../../lib/selfheal-stats.mjs';
import {issueTitle} from '../../lib/triage-findings.mjs';
import {regressionComment} from '../../lib/triage-match.mjs';

test('every source the Finder files under has its own prefix, and the view and text are read back from each title', () => {
  for (const source of Object.keys(DETECTORS)) assert.ok(PREFIXES[source], `source ${source} has no prefix`);
  assert.equal(new Set(Object.values(PREFIXES)).size, Object.keys(PREFIXES).length, 'two sources share a prefix');
  for (const [source, prefix] of Object.entries(PREFIXES)) {
    const title = issueTitle({source, view: 'jobs', title: 'Applied tile shows 1'});
    assert.equal(title, `[${prefix}] jobs: Applied tile shows 1`);
    assert.equal(viewOfTitle(title), 'jobs', source);
    assert.equal(stripTag(title), 'jobs: Applied tile shows 1');
    assert.equal(textOfTitle(title), 'Applied tile shows 1');
    assert.ok(regressionComment({number: 9, title}, 'run').includes('("jobs: '), `${source}: the regression comment cuts the tag`);
  }
});

test('the owner\'s five names, an old [auto-ui] title and a source the map does not know', () => {
  assert.deepEqual(['code-review', 'ai-review', 'layout-check', 'suite-failure', 'ai-user-agent'].map(prefixOf), ['AI code review', 'AI screenshot', 'Layout check', 'Test step', 'AI persona']);
  assert.equal(viewOfTitle('[auto-ui] settings: Label is clipped'), 'settings', 'an issue filed before the change');
  assert.equal(issueTitle({source: 'something-new', view: 'jobs', title: 'x'}), `[${LEGACY_TAG}] jobs: x`);
  assert.equal(viewOfTitle('jobs: no tag'), '');
  assert.equal(stripTag('No tag at all'), 'No tag at all');
  assert.ok(titleOf('ai-review', 'jobs', 'y'.repeat(300)).length <= 120);
});

test('no reader keeps a tag regex or name list of its own: they all read the title through lib/finder-prefix.mjs', () => {
  const dir = new URL('../../', import.meta.url);
  const files = [...fs.readdirSync(new URL('lib/', dir)).filter(name => name.endsWith('.mjs')).map(name => `lib/${name}`), 'triage.mjs', 'review-eval.mjs', 'code-review-file.mjs'];
  const own = files.filter(file => file !== 'lib/finder-prefix.mjs' && /\\\[\(\?:auto-ui|\\\[auto-ui\\\]|`\[auto-ui\]|'\[auto-ui\]/.test(fs.readFileSync(new URL(file, dir), 'utf8').split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')));   // code lines only: a comment may name the legacy tag
  assert.deepEqual(own, [], 'a file holds its own [auto-ui] tag; use finder-prefix.mjs');
  assert.ok(new RegExp(`^${TAG}`).test('[Test step] jobs: x'));
});
