// Guard: privacy — the key that writes the Admin site's stores never reaches a process list or a log; and a failed read is never mistaken for an empty store (a writer would erase it).
// The stores replace the pinned issues #274, #2736 and #2817 (spec docs/superpowers/specs/2026-11-05-state-issues-to-admin-design.md).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {appendNoise, putState, readState, tryRead} from '../../lib/ci-state.mjs';
import {rankingOf} from '../../lib/triage-match.mjs';

const KEY = 'k-secret-123';
// A curl stand-in that records what it was given, and answers like the site.
function fakeCurl(answer) {
  const seen = [];
  const run = (command, args, options) => {
    seen.push({command, args, input: options.input, config: fs.readFileSync(args[args.indexOf('-K') + 1], 'utf8')});
    return {status: answer.status ?? 0, stdout: answer.stdout ?? ''};
  };
  return {run, seen};
}

test('the key rides in a config file, never in the arguments, and the body goes through stdin', () => {
  process.env.SELFHEAL_PUBLISH_KEY = KEY;
  const curl = fakeCurl({stdout: '{"ok":true}\n200'});
  assert.equal(putState('verdict-audit', {audits: []}, {run: curl.run}), true);
  const [call] = curl.seen;
  assert.ok(!call.args.join(' ').includes(KEY), 'no key in argv');
  assert.match(call.config, new RegExp(`Bearer ${KEY}`));
  assert.equal(call.input, '{"audits":[]}');
  assert.equal(fs.existsSync(call.args[call.args.indexOf('-K') + 1]), false, 'the config file is deleted at once');
});

test('a site that is down or refuses is "not read", never an empty store; no key is "not read" too', () => {
  process.env.SELFHEAL_PUBLISH_KEY = KEY;
  assert.deepEqual(tryRead('noise-register', {run: fakeCurl({status: 7}).run}), {ok: false, value: null});
  assert.deepEqual(tryRead('noise-register', {run: fakeCurl({stdout: 'no\n404'}).run}), {ok: false, value: null});
  assert.deepEqual(tryRead('noise-register', {run: fakeCurl({stdout: 'null\n200'}).run}), {ok: true, value: null}, 'an empty store is a good read');
  assert.equal(readState('noise-register', 'fallback', {run: fakeCurl({status: 28}).run}), 'fallback');
  delete process.env.SELFHEAL_PUBLISH_KEY;
  const none = fakeCurl({});
  assert.equal(appendNoise([{id: 'a'}], {run: none.run}), false);
  assert.equal(none.seen.length, 0, 'without a key nothing is sent');
});

test('the snapshot\'s ranking has the fields the Top issues card draws (jobadabra-web admin/selfheal-cards.js)', () => {
  const issue = {number: 7, title: '[auto-ui] settings: a button', state: 'OPEN', createdAt: '2026-11-03T00:00:00Z', labels: [{name: 'platform:windows'}, {name: 'needs-human'}], comments: [], body: ''};
  const {open, counts, rows} = rankingOf([{issue, priority: 'P2', score: 3}], 'jobadabra/jobadabra', Date.parse('2026-11-05T00:00:00Z'));
  assert.equal(open, 1);
  assert.equal(counts.P2, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['build', 'clean', 'days', 'needsPerson', 'number', 'platform', 'priority', 'score', 'title', 'url']);
  assert.equal(rows[0].url, 'https://github.com/jobadabra/jobadabra/issues/7');
  assert.equal(rows[0].title, 'settings: a button');
  assert.equal(rows[0].needsPerson, true);
});
