// Guard: release — without it a Store version Microsoft accepted is announced twice or never, or a refused version is submitted again by itself (tools/msix-store-watch.mjs; owner, 5 Nov 2026).
// Owner: "when Microsoft accepts a new release version, I'd like to get a message on telegram", then "Auto-send newest". GitHub tags, the stable list, msstore's text and Telegram are fakes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {broken, compareVersions, decide, github, recovered, messageOf, reasonOf, tell} from '../../../../tools/msix-store-watch.mjs';

// What `msstore submission status` printed in runs 41463009597 (Pending) and 41642087630 (Last Published), ANSI colours kept.
const PENDING = 'Retrieving submission status\nFound \x1b[38;5;2mPending Submission\x1b[0m.\nSubmission Status = \x1b[38;5;2mCertification\x1b[0m\n';
const PUBLISHED = 'Could not find a Pending Submission, but found the \x1b[38;5;2mLast Published Submission\x1b[0m.\nSubmission Status = \x1b[38;5;2mPublished\x1b[0m\n';

test('the status text is a verdict: published is live, a Failed or Canceled state is a refusal, the rest waits, a missing line is unknown', () => {
  assert.equal(decide(PENDING).verdict, 'waiting');
  assert.equal(decide(PUBLISHED).verdict, 'live');
  assert.equal(decide('Submission Status = CertificationFailed').verdict, 'failed');
  assert.equal(decide('Submission Status = Canceled').verdict, 'failed');
  assert.equal(decide('Submission Status = PendingPublication').verdict, 'waiting');
  assert.equal(decide('Ops, something does not seem to be right!').verdict, 'unknown', 'a sign-in error is never read as a verdict');
});

test('a refusal carries Microsoft\'s reason in words, and says so plainly when the API gave none', () => {
  const json = JSON.stringify({statusDetails: {errors: [{code: 'Error', details: 'The package declares a capability you did not justify.'}], certificationReports: [{reportUrl: 'https://r/1'}]}});
  assert.match(reasonOf(`Retrieving\n${json}\n`, 'CertificationFailed'), /capability you did not justify.*report https:\/\/r\/1/);
  assert.match(reasonOf('no json here', 'CertificationFailed'), /gave no reason.*CertificationFailed.*Partner Center/);
});

// A fake repo: its tags, its stable releases, the dispatches made, and Telegram (`down` = it refuses).
function world({submitted = ['0.8.86'], announced = [], followed = [], autosent = [], stables = ['0.8.86', '0.9.6', '0.9.4'], down = false, dispatchFails = false} = {}) {
  const tags = new Set([...submitted.map(v => `msstore-submitted-${v}`), ...announced.map(v => `msstore-announced-${v}`), ...followed.map(v => `msstore-followed-${v}`), ...autosent.map(v => `msstore-autosent-${v}`)]);
  const dispatched = [], messages = [];
  const gh = {
    fails: {dispatch: dispatchFails},
    tags: async prefix => [...tags].filter(t => t.startsWith(prefix)).map(t => t.slice(prefix.length)),
    claim: async name => { if (tags.has(name)) return false; tags.add(name); return true; },
    release: async name => { tags.delete(name); },
    stables: async () => [...stables].sort(compareVersions).pop() || '',
    dispatch: async tag => { if (gh.fails.dispatch) throw new Error('GitHub 500'); dispatched.push(tag); },
  };
  const sender = async text => { if (down) return 'ci-alert: not sent (Telegram 502)'; messages.push(text); return 'ci-alert: sent'; };
  return {gh, sender, tags, dispatched, messages, env: (verdict, version = '0.8.86') => ({VERSION: version, VERDICT: verdict, REASON: 'bad capability', GITHUB_REPOSITORY: 'jobadabra/jobadabra', GITHUB_RUN_ID: '9'})};
}

test('accepted: one "live" message, then the newest stable is started once; a second hour changes nothing', async () => {
  const w = world();
  await tell(w.env('live'), w);
  assert.equal(w.messages.length, 2);
  assert.match(w.messages[0], /0\.8\.86 is live in the Microsoft Store/);
  assert.match(w.messages[1], /Sending Jobadabra 0\.9\.6/);
  assert.deepEqual(w.dispatched, ['desktop-v0.9.6']);
  await tell(w.env('live'), w);   // the next hourly run: 0.8.86 is announced, nothing is pending
  assert.equal(w.messages.length, 2, 'exactly once');
  assert.deepEqual(w.dispatched, ['desktop-v0.9.6'], 'the same version is never sent twice');
});

test('refused: the owner hears the reason; the refused version is not sent again, a newer stable is', async () => {
  const same = world({stables: ['0.8.86', '0.8.80']});
  await tell(same.env('failed'), same);
  assert.equal(same.messages.length, 1);
  assert.match(same.messages[0], /did not accept Jobadabra 0\.8\.86.*bad capability.*not sent again by itself/s);
  assert.deepEqual(same.dispatched, [], 'a refusal of X never re-sends X');
  const newer = world();
  await tell(newer.env('failed'), newer);
  assert.deepEqual(newer.dispatched, ['desktop-v0.9.6'], 'a newer stable than the refused one goes out');
});

test('a version already submitted or already sent on by the watcher is not started again', async () => {
  const w = world({submitted: ['0.8.86', '0.9.6']});
  await tell(w.env('live', '0.9.6'), w);   // 0.9.6 is the version the status was read for; nothing newer exists
  assert.deepEqual(w.dispatched, []);
  assert.match(w.messages[0], /0\.8\.86 left Microsoft's review before I could read its verdict/, 'the older pending version is not announced with a verdict it did not get');
  assert.match(w.messages[1], /0\.9\.6 is live/);
  assert.ok(w.tags.has('msstore-followed-0.8.86') && w.tags.has('msstore-followed-0.9.6'));
  const claimed = world({autosent: ['0.9.6']});
  await tell(claimed.env('live'), claimed);
  assert.deepEqual(claimed.dispatched, [], 'the claim tag holds a restart off');
});

test('a Telegram refusal is seen, not swallowed: the claim is released so the next hour tries again, and nothing is sent on before the owner knows', async () => {
  const w = world({down: true});
  await assert.rejects(tell(w.env('live'), w), /did not reach Telegram/);
  assert.ok(!w.tags.has('msstore-announced-0.8.86'), 'claim released');
  assert.deepEqual(w.dispatched, []);
  const dispatchDown = world({dispatchFails: true});
  await assert.rejects(tell(dispatchDown.env('live'), dispatchDown), /could not start the Store submit of 0\.9\.6/);
  assert.ok(!dispatchDown.tags.has('msstore-autosent-0.9.6'), 'the submit claim is released too');
});

test('still in review or nothing pending: no message and no submit', async () => {
  const waiting = world();
  assert.deepEqual(await tell(waiting.env('waiting'), waiting), ['nothing to tell: still in review']);
  const none = world({submitted: []});
  await tell(none.env('live'), none);
  assert.deepEqual([none.messages, none.dispatched], [[], []]);
  assert.match(messageOf('failed', {version: '0.8.86', reason: 'x', repo: 'o/r', run: 'u'}), /gh workflow run msix-store\.yml -R o\/r --ref main -f tag=desktop-v0\.8\.86/);
});

test('a failed dispatch is retried next hour without repeating the message', async () => {
  const w = world({dispatchFails: true});
  await assert.rejects(tell(w.env('live'), w), /stays pending/);
  assert.equal(w.messages.length, 1, 'the verdict went out once');
  assert.ok(!w.tags.has('msstore-followed-0.8.86'), 'still pending, so the next hourly run comes back to it');
  w.gh.fails.dispatch = false;
  await tell(w.env('live'), w);
  assert.equal(w.messages.length, 2, 'only the "sending 0.9.6" note was added, not a second verdict');
  assert.deepEqual(w.dispatched, ['desktop-v0.9.6']);
  assert.ok(w.tags.has('msstore-followed-0.8.86'));
});

test('the verdict is for the version the status was read for: a version that is not pending, or a newer one submitted since, is not announced as it', async () => {
  const w = world({submitted: ['0.9.4', '0.9.5']});
  await tell(w.env('live', '0.9.4'), w);   // 0.9.5 was submitted while the Windows job read 0.9.4's status
  assert.match(w.messages[0], /0\.9\.4 is live/);
  assert.ok(!w.tags.has('msstore-announced-0.9.5') && !w.tags.has('msstore-followed-0.9.5'), '0.9.5 stays pending for its own look');
  assert.deepEqual(await tell(w.env('live', '0.9.7'), w), ['nothing to tell: 0.9.7 is not pending']);
});

test('only "already exists" means a held claim: a refused tag creation is an error, not a silent skip', async () => {
  const answer = (status, message) => async () => ({ok: status < 400, status, json: async () => ({message})});
  const env = {GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc', GH_TOKEN: 't'};
  assert.equal(await github(env, answer(422, 'Reference already exists')).claim('msstore-announced-1.0.0'), false);
  assert.equal(await github(env, answer(201, '')).claim('msstore-announced-1.0.0'), true);
  await assert.rejects(github(env, answer(422, 'Repository rule violations found: creations being restricted')).claim('msstore-announced-1.0.0'), /GitHub 422/);
});

test('a failing check tells the owner once per broken streak; a green check ends the streak; a refused send is retried', async () => {
  const w = world();
  w.gh.releaseIfHeld = async name => { w.tags.delete(name); };
  const env = w.env('live');
  await broken(env, w);
  await broken(env, w);   // the next hour, still broken
  assert.equal(w.messages.length, 1, 'once per streak');
  assert.match(w.messages[0], /Store watcher is failing/);
  await recovered(env, w);
  await broken(env, w);
  assert.equal(w.messages.length, 2, 'a new streak tells again');
  const down = world({down: true});
  await assert.rejects(broken(down.env('live'), down), /did not reach Telegram/);
  assert.ok(!down.tags.has('msstore-watch-broken'), 'claim released so the next hour retries');
});
